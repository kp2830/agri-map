/**
 * Reads the team's real crop observations (logged with the BeeKind FieldView app's Crop
 * Observation module) from the production export API, so AgriMap can compare what the team saw
 * in the field with what AMED and our crop models say for the same spot.
 *
 * Read-only: only GETs the export endpoint. The observation's crop is the team's own entry
 * (or their accepted AI suggestion) — it is never altered here.
 */
import { readFileSync } from 'node:fs'

const DEFAULT_EXPORT_URL = 'https://api.udyamita.org/field-view/crop-observations/export'
const PAGE_SIZE = 500
/** Safety cap on pages followed in one refresh (500 x 20 = 10,000 observations). */
const MAX_PAGES = 20
const CACHE_TTL_MS = 30 * 1000
const USER_AGENT = 'AgriMap-crop-compare/1.0'

interface ExportRecord {
  id: string
  captured_at: string
  latitude: number
  longitude: number
  growth_stage: string | null
  confirmed_crop_id: string | null
  confirmed_crop_name: string | null
  ai_predicted_crop_name: string | null
  ai_confidence: number | null
  is_ai_predicted: boolean
  /** Only in the bundled demo file, where places are already filled in. */
  place?: ObservationPlace | null
  /** Only in the bundled demo file: the verdict worked out once, so every visitor sees it straight away. */
  evaluation?: Record<string, unknown> | null
}

export interface ObservationPlace {
  state: string | null
  district: string | null
  city: string | null
}

export interface CropObservationDto {
  id: string
  capturedAt: string
  lat: number
  lng: number
  growthStage: string | null
  cropId: string | null
  cropName: string | null
  /** True when the user accepted the app's AI (PlantNet) suggestion rather than picking by hand. */
  aiPredicted: boolean
  aiPredictedCropName: string | null
  aiConfidence: number | null
  place: ObservationPlace | null
  /** Precomputed right/wrong verdict (demo data only). */
  evaluation?: Record<string, unknown>
}

/**
 * Demo mode (OBSERVATIONS_SOURCE=demo): serves a bundled set of made-up observations instead of the
 * production export, so the Compare screens can be shown without real data. Remove the setting to go
 * back to production — nothing else changes. The response says `demo: true` so the UI labels it.
 */
export function isDemoMode(): boolean {
  return process.env.OBSERVATIONS_SOURCE?.trim().toLowerCase() === 'demo'
}

let demoRecords: ExportRecord[] | null = null
function loadDemoRecords(): ExportRecord[] {
  demoRecords ??= JSON.parse(readFileSync(new URL('./demoObservations.json', import.meta.url), 'utf8')) as ExportRecord[]
  return demoRecords
}

function exportUrl(): string {
  return process.env.CROP_OBSERVATIONS_EXPORT_URL?.trim() || DEFAULT_EXPORT_URL
}

// --- Reverse geocoding (state / district / city) -------------------------------------------
// OpenStreetMap Nominatim: free, but limited to 1 request per second, so lookups run one at a
// time in the background and results are cached by location rounded to ~100 m. A failed lookup
// leaves `place` null (shown as unknown) and is retried on a later refresh — never invented.
const placeCache = new Map<string, ObservationPlace>()
const geocodeQueue: Array<{ key: string; lat: number; lng: number }> = []
const queuedKeys = new Set<string>()
let geocodeRunning = false

function placeKey(lat: number, lng: number): string {
  return `${lat.toFixed(3)},${lng.toFixed(3)}`
}

async function reverseGeocode(lat: number, lng: number): Promise<ObservationPlace | null> {
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=12&accept-language=en&lat=${lat}&lon=${lng}`
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(10_000) })
  if (!response.ok) return null
  const body = (await response.json()) as { address?: Record<string, string> }
  const a = body.address
  if (!a) return null
  return {
    state: a.state ?? null,
    district: a.state_district ?? a.county ?? null,
    city: a.city ?? a.town ?? a.village ?? a.suburb ?? null,
  }
}

async function runGeocodeQueue(): Promise<void> {
  if (geocodeRunning) return
  geocodeRunning = true
  try {
    while (geocodeQueue.length > 0) {
      const next = geocodeQueue.shift()!
      queuedKeys.delete(next.key)
      try {
        const place = await reverseGeocode(next.lat, next.lng)
        if (place) placeCache.set(next.key, place)
      } catch {
        // leave uncached; retried on a later refresh
      }
      await new Promise((resolve) => setTimeout(resolve, 1100))
    }
  } finally {
    geocodeRunning = false
  }
}

function enqueueGeocode(lat: number, lng: number): void {
  const key = placeKey(lat, lng)
  if (placeCache.has(key) || queuedKeys.has(key)) return
  queuedKeys.add(key)
  geocodeQueue.push({ key, lat, lng })
}

// --- Export fetch --------------------------------------------------------------------------
let cache: { at: number; records: ExportRecord[] } | null = null

async function fetchAllRecords(signal?: AbortSignal): Promise<ExportRecord[]> {
  const records: ExportRecord[] = []
  let cursor: string | null = null
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL(exportUrl())
    url.searchParams.set('limit', String(PAGE_SIZE))
    if (cursor) url.searchParams.set('after', cursor)
    const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal })
    if (!response.ok) throw new Error(`Crop observation export responded with status ${response.status}`)
    const body = (await response.json()) as { records?: ExportRecord[]; next_cursor?: string | null }
    records.push(...(body.records ?? []))
    cursor = body.next_cursor ?? null
    if (!cursor) break
  }
  return records
}

export async function getCropObservations(signal?: AbortSignal): Promise<{ observations: CropObservationDto[]; fetchedAt: string; demo: boolean }> {
  const demo = isDemoMode()
  if (!demo && (!cache || Date.now() - cache.at > CACHE_TTL_MS)) {
    cache = { at: Date.now(), records: await fetchAllRecords(signal) }
  }
  const records = demo ? loadDemoRecords() : cache!.records

  const observations = records
    .filter((r) => Number.isFinite(r.latitude) && Number.isFinite(r.longitude))
    .map((r): CropObservationDto => {
      const place = r.place ?? placeCache.get(placeKey(r.latitude, r.longitude)) ?? null
      if (!place && !demo) enqueueGeocode(r.latitude, r.longitude)
      return {
        id: r.id,
        capturedAt: r.captured_at,
        lat: r.latitude,
        lng: r.longitude,
        growthStage: r.growth_stage,
        cropId: r.confirmed_crop_id,
        cropName: r.confirmed_crop_name,
        aiPredicted: r.is_ai_predicted,
        aiPredictedCropName: r.ai_predicted_crop_name,
        aiConfidence: r.ai_confidence,
        place,
        ...(r.evaluation ? { evaluation: r.evaluation } : {}),
      }
    })
    .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))

  if (!demo) void runGeocodeQueue()
  return { observations, fetchedAt: new Date(demo ? Date.now() : cache!.at).toISOString(), demo }
}
