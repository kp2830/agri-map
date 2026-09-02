import type { Geometry } from 'geojson'
import { isSupportedFieldGeometry, requestPolygonStatistics, type DailyObservation } from '../../google/cdseClient.js'
import type { NormalizedFieldProperties } from '../../../types/agricultural.js'
import { meanIgnoringNulls } from './spectralIndices.js'
import { extractHistoricalFeatures } from './historicalFeatures.js'
import type { SunflowerFeatures, SunflowerSpectralFeatures } from './types.js'

/**
 * Whether a satellite feature-extraction backend is actually configured in this environment.
 * Verified directly (repeatedly, across this project's investigation) that none of these exist
 * today. Returns false until real credentials for ONE of the two viable backends below are
 * provisioned — never hardcoded to `true`, and nothing downstream may assume it's `true`
 * without checking.
 *
 * TWO REAL, VIABLE BACKENDS — investigated concretely, not assumed. Prefer Copernicus (B) as
 * the lower-friction option; both are technically sufficient.
 *
 * A) Google Earth Engine
 *    Setup: register a Google Cloud project for Earth Engine at https://earthengine.google.com
 *    (commercial use requires Google's paid/commercial EE tier, a business decision, not a
 *    technical one) → create a service account in that project → grant it the Earth Engine
 *    Resource Viewer role → download its JSON key → set GEE_PROJECT_ID, GEE_SERVICE_ACCOUNT_EMAIL,
 *    GEE_SERVICE_ACCOUNT_KEY (the private key, never committed — same secret-handling posture
 *    as AGRICULTURAL_UNDERSTANDING_API_KEY in server/.env) → install `@google/earthengine` (the
 *    official Node.js EE client) and authenticate with `ee.data.authenticateViaPrivateKey`.
 *
 * B) Copernicus Data Space Ecosystem (CDSE) — https://dataspace.copernicus.eu
 *    ESA's official Sentinel data portal. Self-service registration, no business-approval gate
 *    found in this project's investigation (unlike GEE's commercial tier). Exposes a Sentinel
 *    Hub-compatible Statistical API that computes field-level statistics (mean/median NDVI,
 *    etc.) server-side over a supplied polygon + date range and returns compact JSON — raw
 *    imagery never touches this server, matching this project's memory-safety requirements
 *    (see cellCache.ts's byte-bounded LRU cache for why that matters here).
 *    Setup: register a free account at dataspace.copernicus.eu → create an OAuth client
 *    (Sentinel Hub → User Settings → OAuth clients) → note the client ID and secret → set
 *    CDSE_CLIENT_ID, CDSE_CLIENT_SECRET → exchange them for a bearer token via CDSE's token
 *    endpoint, then POST to the Statistical API
 *    (https://sh.dataspace.copernicus.eu/api/v1/statistics) with the field polygon as the
 *    input geometry, a date range, and an evalscript computing the indices in
 *    spectralIndices.ts. Plain HTTPS REST calls — no heavy client SDK required, unlike GEE.
 *
 * India's ISRO also operates Bhoonidhi (bhoonidhi.nrsc.gov.in), a real regional Sentinel
 * mirror with apparently self-service registration — investigated as a possible third option,
 * but its query/extraction API surface was not verified in this project's investigation, so it
 * is not wired into this check.
 */
export function isSatellitePipelineConfigured(): boolean {
  const geeConfigured = Boolean(process.env.GEE_SERVICE_ACCOUNT_EMAIL && process.env.GEE_SERVICE_ACCOUNT_KEY && process.env.GEE_PROJECT_ID)
  const cdseConfigured = Boolean(process.env.CDSE_CLIENT_ID && process.env.CDSE_CLIENT_SECRET)
  return geeConfigured || cdseConfigured
}

const EMPTY_SPECTRAL = {
  ndviMean: null,
  ndviSlope: null,
  ndviPeakValue: null,
  ndreMean: null,
  ndreSlope: null,
  ndrePeakValue: null,
  ndwiMean: null,
  ndwiPeakValue: null,
  yellowIndexMean: null,
  yellowIndexSlope: null,
  yellowIndexPeakValue: null,
  observationCount: 0,
} as const

const EMPTY_SAR = {
  vvMean: null,
  vhMean: null,
  vvVhRatioMean: null,
  vvVhRatioSlope: null,
  observationCount: 0,
} as const

/**
 * Extracts the real field-level Sunflower feature vector for `geometry` (the actual ALU field
 * polygon — never an arbitrary radius around a point, per the founder's architecture) and the
 * field's own `properties`.
 *
 * Always returns a real object, never `null` — the historical-rotation signal needs no
 * satellite access and is genuinely computed from this field's real AMED monitoring history
 * every time (see historicalFeatures.ts). The spectral/SAR sub-objects are all-null with
 * `observationCount: 0` whenever `isSatellitePipelineConfigured()` is false (true in every
 * environment this code has run in) — an honest "no satellite evidence", not a placeholder
 * pretending observations exist. `daysBeforeBloom` is `null` because no bloom-date source is
 * connected anywhere in this codebase; it must never be assumed to be 30.
 *
 * WHAT A REAL IMPLEMENTATION WOULD DO ONCE `isSatellitePipelineConfigured()` CAN BE TRUE
 * (documented precisely so it can be built without redesigning this module — this is the
 * actual, real integration spec, not a guess):
 *
 * 1. Convert `geometry` (GeoJSON Polygon/MultiPolygon) to an `ee.Geometry` and use it directly
 *    as the reduction region — never a buffered point or bounding box, so observations outside
 *    the real field boundary are excluded.
 * 2. Sentinel-2: query `COPERNICUS/S2_SR_HARMONIZED`, filtered to the target pre-bloom temporal
 *    window and `.filterBounds(geometry)`. Mask clouds using the `SCL` scene-classification band
 *    (excluding classes 3 = cloud shadow, 8/9/10 = cloud medium/high/cirrus) or the companion
 *    `COPERNICUS/S2_CLOUD_PROBABILITY` collection — never treat an unmasked cloudy pixel as a
 *    valid vegetation observation. For each remaining image, compute NDVI/NDRE/NDWI/NDYI (see
 *    spectralIndices.ts for the exact formulas and band assignments) and reduce over `geometry`
 *    with `ee.Reducer.median()` (robust to a handful of residual bad pixels/edge effects, per
 *    the "avoid a tiny number of pixels dominating classification" requirement) to get one
 *    field-level value per index per image date. Record the real per-date value count as
 *    `spectral.observationCount` — never inflate it. `*PeakValue` is simply the max of the real
 *    per-date values across the window (see training/sunflower/temporal_features.py's
 *    `peak_value` for the exact Python-side definition this must match).
 * 3. Sentinel-1: query `COPERNICUS/S1_GRD`, filtered the same way, restricted to a consistent
 *    orbit pass direction (ascending or descending — mixing both introduces spurious backscatter
 *    differences unrelated to the crop) and IW mode. Reduce VV/VH the same way (median over
 *    `geometry`) to get field-level backscatter per date; compute VV/VH and its temporal slope
 *    via `temporalSlope()`. Record the real image count as `sar.observationCount`.
 * 4. Compute `ndviSlope`/`ndreSlope`/`yellowIndexSlope`/`vvVhRatioSlope` via `temporalSlope()`
 *    over the real per-date values from steps 2-3 — never a single-image feature.
 * 5. `daysBeforeBloom`: only computable once a real bloom-date estimate exists for this field —
 *    no such source is connected in this codebase today. Until one exists, this stays `null`.
 * 6. Wrap all of the above so that ANY failure (auth failure, quota, network, malformed
 *    response) results in the spectral/SAR sub-objects falling back to `EMPTY_SPECTRAL`/
 *    `EMPTY_SAR` exactly like the "not configured" case — so a satellite-side outage degrades
 *    to "no Sunflower evidence", never to a crash of the whole field search (the Fallback
 *    Safety precedent this project's earlier memory-exhaustion incident already established:
 *    an enhancement must never become a single point of failure for the base ALU/AMED flow).
 */
/** How far back from "now" the live extraction window looks — a real, defensible 6-month span
 *  structurally analogous to the fixed Apr-Sep 2021 window the exported likeness model's
 *  reference population (the 100 real Slovak positives) was built from, but NOT the same
 *  calendar window — a real 2021 date range cannot be "the current season" for a live request in
 *  any other year. This is a disclosed, real limitation (see
 *  training/data/pilot/methodology_investigation_report_v5.md): the reference population and a
 *  live-scored field are not extracted over identical calendar windows, only structurally
 *  similar-length ones. Revisit once per-field AMED season boundaries are wired through
 *  buildAmedHypotheses (see amedHypotheses.ts) as a closer match. */
const LIVE_EXTRACTION_WINDOW_DAYS = 183

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function aggregateIndex(series: DailyObservation[]): { mean: number | null; peakValue: number | null; observationCount: number } {
  const validValues = series.map((o) => o.mean).filter((v): v is number => v !== null)
  return {
    mean: meanIgnoringNulls(validValues),
    peakValue: validValues.length > 0 ? Math.max(...validValues) : null,
    observationCount: validValues.length,
  }
}

export async function extractSunflowerFeatures(
  geometry: Geometry,
  properties: NormalizedFieldProperties,
  signal?: AbortSignal,
): Promise<SunflowerFeatures> {
  const historical = extractHistoricalFeatures(properties)
  const base = { historical, daysBeforeBloom: null } as const

  if (!isSatellitePipelineConfigured()) {
    return { ...base, spectral: EMPTY_SPECTRAL, sar: EMPTY_SAR }
  }
  if (!isSupportedFieldGeometry(geometry)) {
    console.warn(`[sunflower] unsupported geometry type for CDSE extraction: ${geometry.type}`)
    return { ...base, spectral: EMPTY_SPECTRAL, sar: EMPTY_SAR }
  }

  const end = new Date()
  const start = new Date(end.getTime() - LIVE_EXTRACTION_WINDOW_DAYS * 24 * 60 * 60 * 1000)

  let spectral: SunflowerSpectralFeatures
  try {
    const { dailySeriesByIndex, processingUnitsSpent } = await requestPolygonStatistics(geometry, isoDate(start), isoDate(end), signal)
    const ndvi = aggregateIndex(dailySeriesByIndex.ndvi)
    const ndre = aggregateIndex(dailySeriesByIndex.ndre)
    const ndwi = aggregateIndex(dailySeriesByIndex.ndwi)
    const ndyi = aggregateIndex(dailySeriesByIndex.ndyi)
    spectral = {
      ndviMean: ndvi.mean,
      ndviSlope: null, // the shipped likeness model uses aggregate (mean/peak) features only — see likenessModel.ts
      ndviPeakValue: ndvi.peakValue,
      ndreMean: ndre.mean,
      ndreSlope: null,
      ndrePeakValue: ndre.peakValue,
      ndwiMean: ndwi.mean,
      ndwiPeakValue: ndwi.peakValue,
      yellowIndexMean: ndyi.mean,
      yellowIndexSlope: null,
      yellowIndexPeakValue: ndyi.peakValue,
      observationCount: ndvi.observationCount,
    }
    // Real, non-secret PU accounting for every live extraction — never the credentials
    // themselves, just the API's own reported cost (see cdseClient.ts's x-processingunits-spent
    // header) — so real quota usage from the live map-click path is always visible in logs.
    console.log(`[sunflower] live CDSE extraction: ${ndvi.observationCount} real NDVI observations, ${processingUnitsSpent ?? 'unknown'} PU spent`)
  } catch (error) {
    // Any failure (auth, network, quota, malformed response, aborted request) degrades to "no
    // Sunflower evidence" — matching the "not configured" case exactly — never breaks field
    // analysis. The caller (the sunflower-likelihood route) surfaces the real reason in logs.
    if (error instanceof Error && error.name === 'AbortError') throw error
    console.warn(`[sunflower] CDSE extraction failed, falling back to no-evidence: ${error instanceof Error ? error.message : String(error)}`)
    spectral = EMPTY_SPECTRAL
  }

  return { ...base, spectral, sar: EMPTY_SAR }
}
