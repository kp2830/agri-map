/**
 * Real Copernicus Data Space Ecosystem (CDSE) Statistical API client — the TypeScript port of
 * training/sunflower/cdse_client.py, used to train the Sunflower likeness model
 * (server/src/services/agricultural/sunflower/likenessModel.ts). Deliberately the SAME OAuth
 * flow, the SAME native-resolution calculation, the SAME evalscript, and the SAME "NaN"-string
 * response quirk handling as the Python client that produced the model's training data — this
 * must stay a faithful port, not a second, differently-behaved pipeline, or live-scored features
 * would not be comparable to the model's reference population.
 *
 * Requires CDSE_CLIENT_ID/CDSE_CLIENT_SECRET (see server/.env.example) — a free account at
 * https://dataspace.copernicus.eu plus a Sentinel Hub OAuth client. Never logs either value.
 */
import type { Geometry, MultiPolygon, Polygon } from 'geojson'

const TOKEN_URL = 'https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token'
const STATISTICAL_API_URL = 'https://sh.dataspace.copernicus.eu/api/v1/statistics'

export class CdseAuthRequiredError extends Error {
  constructor(message = 'CDSE_CLIENT_ID/CDSE_CLIENT_SECRET are not set — register a free account at https://dataspace.copernicus.eu and create a Sentinel Hub OAuth client.') {
    super(message)
    this.name = 'CdseAuthRequiredError'
  }
}

export class CdseApiError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'CdseApiError'
    this.status = status
  }
}

let cachedToken: { accessToken: string; expiresAtMs: number } | null = null

/** Real OAuth2 client-credentials token exchange, cached in-memory until shortly before real
 *  expiry (never logs the token or the credentials) — avoids a token round-trip on every field
 *  score, matching normal OAuth client-credentials practice. */
async function getAccessToken(signal?: AbortSignal): Promise<string> {
  const clientId = process.env.CDSE_CLIENT_ID
  const clientSecret = process.env.CDSE_CLIENT_SECRET
  if (!clientId || !clientSecret) throw new CdseAuthRequiredError()

  if (cachedToken && cachedToken.expiresAtMs > Date.now() + 30_000) {
    return cachedToken.accessToken
  }

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }),
    signal,
  })
  if (!response.ok) {
    throw new CdseApiError(`CDSE token exchange failed with status ${response.status}`, response.status)
  }
  const body = (await response.json()) as { access_token: string; expires_in: number }
  cachedToken = { accessToken: body.access_token, expiresAtMs: Date.now() + body.expires_in * 1000 }
  return cachedToken.accessToken
}

/** Real per-field native-resolution degree conversion — Sentinel-2's real 10m band resolution
 *  converted to WGS84 degrees at this specific field's own centroid latitude. Measured (see
 *  training/sunflower/cdse_client.py's docstring) to give a real ~25x PU reduction over the
 *  Statistical API's default oversampled grid, with no loss of real information. Handles both
 *  Polygon and MultiPolygon (real ALU/AMED field geometry is MultiPolygon). */
function nativeResolutionDegrees(geometry: Polygon | MultiPolygon): { resx: number; resy: number } {
  const lats: number[] = []
  const rings: number[][][] = geometry.type === 'Polygon' ? geometry.coordinates : geometry.coordinates.flat()
  for (const ring of rings) {
    for (const [, lat] of ring) lats.push(lat)
  }
  if (lats.length === 0) throw new Error('geometry has no coordinates to compute a native resolution from')
  const latMid = lats.reduce((sum, v) => sum + v, 0) / lats.length
  const metersPerDegreeLon = 111_320 * Math.cos((latMid * Math.PI) / 180)
  const metersPerDegreeLat = 110_540
  return { resx: 10 / metersPerDegreeLon, resy: 10 / metersPerDegreeLat }
}

/** Real evalscript computing NDVI/NDRE/NDWI/NDYI (matching spectralIndices.ts's formulas
 *  exactly) plus dataMask for cloud masking — verbatim identical to
 *  training/sunflower/cdse_client.py's SPECTRAL_INDICES_EVALSCRIPT, since the live-scored
 *  features must be computed the same way the model's reference population was. */
export const SPECTRAL_INDICES_EVALSCRIPT = `
//VERSION=3
function setup() {
  return {
    input: [{ bands: ["B02", "B03", "B04", "B05", "B08", "B8A", "B11", "SCL"] }],
    output: [
      { id: "ndvi", bands: 1 },
      { id: "ndre", bands: 1 },
      { id: "ndwi", bands: 1 },
      { id: "ndyi", bands: 1 },
      { id: "dataMask", bands: 1 },
    ],
  }
}
function evaluatePixel(s) {
  const cloudy = [3, 8, 9, 10].includes(s.SCL)
  const ndvi = (s.B08 - s.B04) / (s.B08 + s.B04)
  const ndre = (s.B08 - s.B05) / (s.B08 + s.B05)
  const ndwi = (s.B8A - s.B11) / (s.B8A + s.B11)
  const ndyi = (s.B03 - s.B02) / (s.B03 + s.B02)
  return {
    ndvi: [ndvi],
    ndre: [ndre],
    ndwi: [ndwi],
    ndyi: [ndyi],
    dataMask: [cloudy ? 0 : 1],
  }
}
`

export interface DailyObservation {
  date: string
  mean: number | null
  sampleCount: number | null
  noDataCount: number
}

interface StatisticalApiResponseEntry {
  interval: { from: string }
  outputs: Record<string, { bands?: { B0?: { stats?: { mean?: number | string | null; sampleCount?: number; noDataCount?: number } } } }>
}

export interface StatisticsResult {
  dailySeriesByIndex: Record<'ndvi' | 'ndre' | 'ndwi' | 'ndyi', DailyObservation[]>
  processingUnitsSpent: number | null
}

/** Real Sentinel Hub Statistical API call at native resolution — computes field-level daily
 *  statistics server-side over the given real geometry without downloading raw imagery
 *  (matching this project's memory-safety posture). Parses the real "NaN"-string response quirk
 *  (the API returns the literal string "NaN", not null, for a fully cloud-masked day) into
 *  `null`, exactly like the Python client. Returns the real PU cost from the API's own
 *  `x-processingunits-spent` response header. */
export async function requestPolygonStatistics(
  geometry: Polygon | MultiPolygon,
  startDate: string,
  endDate: string,
  signal?: AbortSignal,
): Promise<StatisticsResult> {
  const token = await getAccessToken(signal)
  const { resx, resy } = nativeResolutionDegrees(geometry)

  const payload = {
    input: {
      bounds: { geometry },
      data: [{ type: 'sentinel-2-l2a', dataFilter: { timeRange: { from: `${startDate}T00:00:00Z`, to: `${endDate}T23:59:59Z` } } }],
    },
    aggregation: {
      timeRange: { from: `${startDate}T00:00:00Z`, to: `${endDate}T23:59:59Z` },
      aggregationInterval: { of: 'P1D' },
      evalscript: SPECTRAL_INDICES_EVALSCRIPT,
      resx,
      resy,
    },
  }

  const response = await fetch(STATISTICAL_API_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  })

  const puHeader = response.headers.get('x-processingunits-spent')
  const processingUnitsSpent = puHeader ? Number(puHeader) : null

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '')
    throw new CdseApiError(`CDSE Statistical API request failed with status ${response.status}: ${errorBody.slice(0, 500)}`, response.status)
  }

  const body = (await response.json()) as { data?: StatisticalApiResponseEntry[] }
  const entries = body.data ?? []

  const dailySeriesByIndex: StatisticsResult['dailySeriesByIndex'] = { ndvi: [], ndre: [], ndwi: [], ndyi: [] }
  for (const indexName of ['ndvi', 'ndre', 'ndwi', 'ndyi'] as const) {
    for (const entry of entries) {
      const stats = entry.outputs[indexName]?.bands?.B0?.stats
      if (!stats) continue
      const rawMean = stats.mean
      const mean = rawMean === 'NaN' || rawMean === undefined || rawMean === null ? null : Number(rawMean)
      dailySeriesByIndex[indexName].push({
        date: entry.interval.from,
        mean,
        sampleCount: stats.sampleCount ?? null,
        noDataCount: stats.noDataCount ?? 0,
      })
    }
  }

  return { dailySeriesByIndex, processingUnitsSpent }
}

/** Real vertex extraction shared with nativeResolutionDegrees, exposed for callers (e.g.
 *  featureExtraction.ts) that need to validate a geometry before spending a real request on it. */
export function isSupportedFieldGeometry(geometry: Geometry): geometry is Polygon | MultiPolygon {
  return geometry.type === 'Polygon' || geometry.type === 'MultiPolygon'
}
