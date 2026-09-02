/**
 * Decodes a real WorldCereal CROPTYPE GeoTIFF result near a requested lat/lng.
 *
 * Real, confirmed GeoTIFF layout (26 bands): band 0 = classification (integer class index,
 * 254 = nodata/cloud-masked), band 1 = overall probability, bands 2-25 = per-class probability
 * in CROPTYPE24_CLASSES order, 10m resolution, reprojected to the local UTM zone.
 *
 * Implementation note: the pure-JS `geotiff` npm package (v3.0.5, latest available) was tried
 * first and FAILS to parse these real GDAL/openEO-generated multi-band uint8 GeoTIFFs — its IFD
 * tag parser resolves zero fields for this real file shape (confirmed by testing against the
 * real Kurukshetra result; a genuine upstream limitation, not a config issue on our side).
 * rasterio (Python/GDAL-backed) has no such problem, so this shells out to
 * training/esa/experiments/decode_for_node.py — the same decode logic already validated against
 * every real result in this project (Gadag, the 5-field batch, Kurukshetra) — rather than
 * reimplementing GeoTIFF parsing in TypeScript. This is the one place in the WorldCereal research
 * integration that still depends on the training/esa/.venv Python environment; see
 * training/esa/worldcereal_agrimap_100_field_evaluation.md §21 for the tradeoff this implies if
 * this integration is ever promoted beyond research status (e.g. swap to a GDAL-backed Node
 * binding, or run this as a tiny sidecar Python service).
 */
import { execFile } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import type { WorldCerealPixelResult } from './types.js'

const execFileAsync = promisify(execFile)
const __dirname = dirname(fileURLToPath(import.meta.url))

// server/{src,dist}/services/agricultural/worldcereal/ -> repo root -> training/esa/
// (5 "up" hops in both dev (tsx, running from src/) and prod (compiled to dist/) — same depth)
const ESA_DIR = resolve(__dirname, '../../../../../training/esa')
const PYTHON_BIN = join(ESA_DIR, '.venv/bin/python3')
const DECODE_SCRIPT = join(ESA_DIR, 'experiments/decode_for_node.py')

export class WorldCerealDecoderUnavailableError extends Error {
  constructor(cause: string) {
    super(`WorldCereal GeoTIFF decoder is unavailable: ${cause}. The research training/esa/.venv Python environment must be present locally — see geotiffDecoder.ts's docstring.`)
    this.name = 'WorldCerealDecoderUnavailableError'
  }
}

export interface DecodeOptions {
  /** Pixel radius of the inspection window around the requested point (10m/px). Widen this if
   *  the exact point is cloud-masked — matches the real Kurukshetra case where radius=5 found
   *  zero valid pixels and radius=15 was needed. */
  windowRadiusPx?: number
}

export interface DecodeResult {
  validPixelCount: number
  totalPixelCount: number
  nearestValidPixel: WorldCerealPixelResult | null
}

export async function decodeWorldCerealGeoTiff(tifPath: string, lat: number, lng: number, options: DecodeOptions = {}): Promise<DecodeResult> {
  const windowRadiusPx = options.windowRadiusPx ?? 5
  try {
    const { stdout } = await execFileAsync(PYTHON_BIN, [DECODE_SCRIPT, tifPath, String(lat), String(lng), String(windowRadiusPx)])
    return JSON.parse(stdout.trim()) as DecodeResult
  } catch (error) {
    throw new WorldCerealDecoderUnavailableError(error instanceof Error ? error.message : String(error))
  }
}
