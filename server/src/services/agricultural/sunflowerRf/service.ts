/**
 * Orchestrates Sunflower RF v0: month-in-season gate -> AMED confidence gate -> cache check ->
 * real CDSE feature extraction -> real RF inference -> cache. This is an ADDITIVE, isolated
 * pathway — it never modifies AMED, never overrides the AMED crop prediction, and is only reached
 * when the caller (the controller) has already determined AMED is Unknown/low-confidence for
 * this field AND the selected month is one Sunflower could plausibly be in the ground for.
 */
import type { MultiPolygon, Polygon } from 'geojson'
import { isCropInSeasonForMonth } from '../growingSeasonGate.js'
import { AMED_STRONG_CONFIDENCE_THRESHOLD, FEATURE_WINDOW_VERSION, SUNFLOWER_RF_MODEL_VERSION } from './config.js'
import { extractSunflowerRfFeatures, toOrderedVector } from './featureExtraction.js'
import { predictSunflowerProbability } from './rfInference.js'
import { buildCacheKey, getCachedRecord, saveRecord } from './resultStore.js'
import type { AmedHypothesis } from '../sunflower/decisionPolicy.js'
import type { SunflowerRfResult } from './types.js'

export { AMED_STRONG_CONFIDENCE_THRESHOLD }

/**
 * Crops where AMED and Sunflower are real-world confusable enough (both tall, broad-leaved
 * summer row crops with a similar visual/spectral footprint at points in their cycle) that a
 * high-confidence AMED Corn/Maize call is still worth cross-checking against the Sunflower RF
 * -- unlike every other crop, where a strong AMED result is treated as settled. Does not change
 * the 0.8 threshold itself, does not apply to any other crop, and never touches what AMED
 * displays -- this only decides whether the RF also runs alongside it.
 */
const ALWAYS_RUN_FOR_CROPS = new Set(['CORN', 'MAIZE'])

/** Pure gate logic, exported separately so the controller (and tests) can check eligibility
 *  without touching the cache/CDSE/inference machinery.
 *  - Selected month outside Sunflower's real growing season (see growingSeasonGate.ts) -> NOT
 *    eligible. This is the real fix for why Sunflower RF was temporarily hidden from the
 *    frontend (see client/src/lib/featureFlags.ts): the model always evaluates its fixed
 *    April/May/June training window regardless of which month is selected, so a prediction must
 *    never be shown against a month it has no real relationship to.
 *  - AMED null (Unknown/no usable prediction) -> eligible. AMED Corn/Maize -> ALWAYS eligible,
 *    regardless of confidence. Every other crop: eligible only below the 0.80 strong-confidence
 *    threshold (unchanged). */
export function isEligibleForSunflowerRf(amedTop: AmedHypothesis | null, selectedMonth: number): { eligible: boolean; reason?: 'OUT_OF_SEASON' | 'AMED_HIGH_CONFIDENCE' } {
  if (!isCropInSeasonForMonth('sunflower', selectedMonth)) return { eligible: false, reason: 'OUT_OF_SEASON' }
  if (!amedTop) return { eligible: true }
  if (ALWAYS_RUN_FOR_CROPS.has(amedTop.crop.toUpperCase())) return { eligible: true }
  if (amedTop.confidence < AMED_STRONG_CONFIDENCE_THRESHOLD) return { eligible: true }
  return { eligible: false, reason: 'AMED_HIGH_CONFIDENCE' }
}

const inFlight = new Map<string, Promise<SunflowerRfResult>>()

/**
 * Real CDSE + RF work happens only here, and only once per (field, model version, feature
 * window version) for a field that actually succeeds — cached forever after. Concurrent
 * requests for the same never-before-seen field share one in-flight computation rather than
 * each spending CDSE credits. Never throws: every failure path resolves to
 * `{available: false, reason: ...}` so a satellite/model failure can never break the
 * surrounding field-details response.
 *
 * A TRANSIENT failure (the outer catch below — a CDSE network error, an expired/rate-limited
 * token exchange, a timeout) is deliberately NEVER cached, only a genuine one is. Caching a
 * transient failure forever was a real bug found via live testing: a field that hit a
 * momentary CDSE hiccup (e.g. several fields checked in quick succession tripping a rate
 * limit) would return the exact same cached "unavailable" result on every future request for
 * that field, permanently, even though the field's actual satellite data was fine and a retry
 * moments later succeeded for that same field locally. Only two outcomes are safe to persist
 * forever: a genuine successful prediction, and a genuinely missing Sentinel-2 observation for
 * the requested time windows (the `ordered.some(v => v === null)` case below) — both are
 * real, stable properties of the field/imagery, not an artifact of one request's bad luck.
 */
export async function getSunflowerRfPrediction(fieldId: string, geometry: Polygon | MultiPolygon, signal?: AbortSignal): Promise<SunflowerRfResult> {
  const cacheKey = buildCacheKey(fieldId, SUNFLOWER_RF_MODEL_VERSION, FEATURE_WINDOW_VERSION)

  const cached = await getCachedRecord(cacheKey)
  if (cached) return cached.result

  const existingInFlight = inFlight.get(cacheKey)
  if (existingInFlight) return existingInFlight

  const computation = (async (): Promise<SunflowerRfResult> => {
    const recheck = await getCachedRecord(cacheKey)
    if (recheck) return recheck.result

    let result: SunflowerRfResult
    let cacheable = true
    try {
      const features = await extractSunflowerRfFeatures(geometry, signal)
      const ordered = toOrderedVector(features)
      if (ordered.some((v) => v === null)) {
        result = { available: false, reason: 'SATELLITE_DATA_UNAVAILABLE' }
      } else {
        try {
          const probability = predictSunflowerProbability(ordered as number[])
          result = {
            available: true, probability, probabilityPercent: Math.round(probability * 100),
            modelVersion: SUNFLOWER_RF_MODEL_VERSION, source: 'sunflower_random_forest', labelType: 'weakly_supervised_model',
          }
        } catch (error) {
          console.error('[sunflower-rf] prediction failed:', error instanceof Error ? error.message : error)
          result = { available: false, reason: 'PREDICTION_FAILED' }
          cacheable = false
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error
      console.error('[sunflower-rf] feature extraction failed (transient — not cached):', error instanceof Error ? error.message : error)
      result = { available: false, reason: 'SATELLITE_DATA_UNAVAILABLE' }
      cacheable = false
    }

    if (cacheable) {
      await saveRecord({ cacheKey, fieldId, modelVersion: SUNFLOWER_RF_MODEL_VERSION, featureWindowVersion: FEATURE_WINDOW_VERSION, computedAtIso: new Date().toISOString(), result })
    }
    return result
  })()

  inFlight.set(cacheKey, computation)
  try {
    return await computation
  } finally {
    inFlight.delete(cacheKey)
  }
}
