import type {
  CropObservationsResponse,
  FieldsResponse,
  NormalizedFieldFeature,
  SafflowerRfResponse,
  CorianderRfResponse,
  FennelRfResponse,
  SunflowerLikelihoodResponse,
  SunflowerRfResponse,
} from '../types/agricultural'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL

export async function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, { signal })

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error ?? `Request to ${path} failed with status ${response.status}`)
  }

  return response.json() as Promise<T>
}

async function apiPost<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => null)) as { error?: string } | null
    throw new Error(errorBody?.error ?? `Request to ${path} failed with status ${response.status}`)
  }

  return response.json() as Promise<T>
}

export async function getAgriculturalFields(
  lat: number,
  lng: number,
  gridKm: number,
  maxSearchKm: number,
  signal?: AbortSignal,
): Promise<FieldsResponse> {
  return apiGet<FieldsResponse>(
    `/agriculture/fields?lat=${lat}&lng=${lng}&gridKm=${gridKm}&maxSearchKm=${maxSearchKm}`,
    signal,
  )
}

/** Real-time, per-field, on-demand only — never called for a whole area response. See
 *  cropDisplay.ts's isEligibleForSunflowerCheck for when the caller should invoke this. */
export async function getSunflowerLikelihood(
  feature: NormalizedFieldFeature,
  signal?: AbortSignal,
): Promise<SunflowerLikelihoodResponse> {
  return apiPost<SunflowerLikelihoodResponse>('/agriculture/sunflower-likelihood', { feature }, signal)
}

/** Sunflower RF v0 (India-native, weakly-supervised) — a separate signal from the likeness
 *  model above. Real-time, per-field, on-demand only. `selectedMonth` (1-12) is the month
 *  currently selected in the UI's month selector — the server uses it to gate whether a
 *  prediction is even attempted (Sunflower's fixed training window only represents a real
 *  Feb-June growing cycle; outside that, the endpoint returns `OUT_OF_SEASON` with no CDSE
 *  spend, never a prediction unrelated to the selected month). The server also re-checks the
 *  AMED strong-confidence gate itself, so calling this for a high-confidence field is safe (just
 *  wasted round-trip) — but callers should still gate with isEligibleForSunflowerCheck first,
 *  same as the likeness check above, to avoid the unnecessary request. */
export async function getSunflowerRf(
  feature: NormalizedFieldFeature,
  selectedMonth: number,
  signal?: AbortSignal,
): Promise<SunflowerRfResponse> {
  return trackSatellite(apiPost<SunflowerRfResponse>('/agriculture/sunflower-rf', { feature, selectedMonth }, signal))
}

/** Safflower RF v0 — same shape and same month-gating as Sunflower RF above. See
 *  server/src/services/agricultural/growingSeasonGate.ts for Safflower's real Oct-March
 *  growing-season range. */
export async function getSafflowerRf(
  feature: NormalizedFieldFeature,
  selectedMonth: number,
  signal?: AbortSignal,
): Promise<SafflowerRfResponse> {
  return trackSatellite(apiPost<SafflowerRfResponse>('/agriculture/safflower-rf', { feature, selectedMonth }, signal))
}

/** Coriander RF v0 — same shape and same month-gating as Safflower RF above. See
 *  server/src/services/agricultural/growingSeasonGate.ts for Coriander's Oct-March season. */
export async function getCorianderRf(
  feature: NormalizedFieldFeature,
  selectedMonth: number,
  signal?: AbortSignal,
): Promise<CorianderRfResponse> {
  return trackSatellite(apiPost<CorianderRfResponse>('/agriculture/coriander-rf', { feature, selectedMonth }, signal))
}

/** Fennel RF v0 — same shape and same month-gating as Coriander RF above. See
 *  server/src/services/agricultural/growingSeasonGate.ts for Fennel's Oct-April season. */
export async function getFennelRf(
  feature: NormalizedFieldFeature,
  selectedMonth: number,
  signal?: AbortSignal,
): Promise<FennelRfResponse> {
  return trackSatellite(apiPost<FennelRfResponse>('/agriculture/fennel-rf', { feature, selectedMonth }, signal))
}

/** Decodes a real ALU field ID (a standard Open Location Code) to its center lat/lng — powers
 *  "Search by Field ID". Returns `null` for an invalid/unparseable ID rather than throwing, so
 *  the caller can show a plain "not a valid field ID" message instead of a generic error. */
export async function decodeFieldId(fieldId: string, signal?: AbortSignal): Promise<{ lat: number; lng: number } | null> {
  try {
    return await apiGet<{ lat: number; lng: number }>(`/geo/plus-code/${encodeURIComponent(fieldId.trim())}`, signal)
  } catch {
    return null
  }
}

// Shared "satellite (CDSE) is failing" signal for the four satellite crop checks, read by the
// banner in App.tsx. It is only raised when the satellite is really down: at least
// SATELLITE_MIN_FAILURES failures and no success at all within the last SATELLITE_WINDOW_MS.
// A single failed field (or one model failing while others work) never shows the banner.
const SATELLITE_WINDOW_MS = 2 * 60 * 1000
const SATELLITE_MIN_FAILURES = 3
let satelliteFailureTimes: number[] = []
let lastSatelliteSuccessAt = 0
let satelliteBusyShown = false
const satelliteListeners = new Set<() => void>()

function evaluateSatelliteBusy(): void {
  const now = Date.now()
  satelliteFailureTimes = satelliteFailureTimes.filter((time) => now - time < SATELLITE_WINDOW_MS)
  const next = satelliteFailureTimes.length >= SATELLITE_MIN_FAILURES && now - lastSatelliteSuccessAt >= SATELLITE_WINDOW_MS
  if (next !== satelliteBusyShown) {
    satelliteBusyShown = next
    satelliteListeners.forEach((listener) => listener())
  }
  if (next) setTimeout(evaluateSatelliteBusy, SATELLITE_WINDOW_MS + 50)
}

function recordSatelliteOutcome(ok: boolean): void {
  if (ok) lastSatelliteSuccessAt = Date.now()
  else satelliteFailureTimes.push(Date.now())
  evaluateSatelliteBusy()
}

export function subscribeSatelliteStatus(listener: () => void): () => void {
  satelliteListeners.add(listener)
  return () => { satelliteListeners.delete(listener) }
}

export function getSatelliteBusySnapshot(): boolean {
  return satelliteBusyShown
}

async function trackSatellite<T extends { available: boolean }>(request: Promise<T>): Promise<T> {
  try {
    const response = await request
    const reason = (response as { reason?: string }).reason
    if (response.available) recordSatelliteOutcome(true)
    else if (reason === 'SATELLITE_BUSY') recordSatelliteOutcome(false)
    return response
  } catch (error) {
    if (!(error instanceof DOMException && error.name === 'AbortError')) recordSatelliteOutcome(false)
    throw error
  }
}

/** The team's logged crop observations (production FieldView), for the Compare view. */
export async function getCropObservations(signal?: AbortSignal): Promise<CropObservationsResponse> {
  return apiGet<CropObservationsResponse>('/agriculture/observations', signal)
}
