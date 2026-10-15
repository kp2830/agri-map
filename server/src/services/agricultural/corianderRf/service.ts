/**
 * Orchestrates Coriander RF v0: month-in-season gate -> AMED confidence gate -> confusion-crop
 * (Mustard/Wheat/Gram) gate -> cache check -> real CDSE feature extraction -> real RF inference -> cache. Same
 * structure as sunflowerRf/service.ts. This is an ADDITIVE, isolated pathway -- it never modifies
 * AMED, never overrides the AMED crop prediction, and is only reached when the caller (the
 * controller) has already determined AMED is Unknown/low-confidence for this field AND the
 * selected month is one Coriander could plausibly be in the ground for.
 */
import type { MultiPolygon, Polygon } from 'geojson'
import { isCropInSeasonForMonth } from '../growingSeasonGate.js'
import { AMED_STRONG_CONFIDENCE_THRESHOLD, CORIANDER_KNOWN_CONFUSION_CROPS, FEATURE_WINDOW_VERSION, CORIANDER_RF_MODEL_VERSION } from './config.js'
import { extractCorianderRfFeatures, toOrderedVector } from './featureExtraction.js'
import { predictCorianderProbability } from './rfInference.js'
import { buildCacheKey, getCachedRecord, saveRecord } from './resultStore.js'
import type { AmedHypothesis } from '../sunflower/decisionPolicy.js'
import type { CorianderRfResult } from './types.js'

export { AMED_STRONG_CONFIDENCE_THRESHOLD }

const CONFUSION_CROPS = new Set(CORIANDER_KNOWN_CONFUSION_CROPS.map((c) => c.toUpperCase()))

/** Pure gate logic, exported separately so the controller (and tests) can check eligibility
 *  without touching the cache/CDSE/inference machinery.
 *
 *  - Selected month outside Coriander's real growing season -> NOT eligible (checked first --
 *    cheapest check, and the most common reason a prediction should not even be attempted).
 *  - AMED null (Unknown/no usable prediction) -> eligible.
 *  - AMED names one of Coriander's documented confusion crops (Mustard, Wheat, Gram -- see
 *    ./config.ts's CORIANDER_KNOWN_CONFUSION_CROPS) -> NOT eligible, regardless of confidence level,
 *    since all three share Coriander's rabi calendar and a call of any of them is the strongest real
 *    disambiguating signal available.
 *  - Every other crop: eligible only below the 0.80 strong-confidence threshold. */
export function isEligibleForCorianderRf(amedTop: AmedHypothesis | null, selectedMonth: number): { eligible: boolean; reason?: 'OUT_OF_SEASON' | 'AMED_HIGH_CONFIDENCE' } {
  if (!isCropInSeasonForMonth('coriander', selectedMonth)) return { eligible: false, reason: 'OUT_OF_SEASON' }
  if (!amedTop) return { eligible: true }
  if (CONFUSION_CROPS.has(amedTop.crop.toUpperCase())) return { eligible: false, reason: 'AMED_HIGH_CONFIDENCE' }
  if (amedTop.confidence >= AMED_STRONG_CONFIDENCE_THRESHOLD) return { eligible: false, reason: 'AMED_HIGH_CONFIDENCE' }
  return { eligible: true }
}

const inFlight = new Map<string, Promise<CorianderRfResult>>()

/** Real CDSE + RF work happens only here, and only once per (field, model version, feature
 *  window version) for a field that actually succeeds -- cached forever after. A TRANSIENT
 *  failure is deliberately NEVER cached, only a genuine one is -- same reasoning as Sunflower's
 *  own service.ts (see that file's docstring for the real bug this avoids). */
export async function getCorianderRfPrediction(fieldId: string, geometry: Polygon | MultiPolygon, signal?: AbortSignal): Promise<CorianderRfResult> {
  const cacheKey = buildCacheKey(fieldId, CORIANDER_RF_MODEL_VERSION, FEATURE_WINDOW_VERSION)

  const cached = await getCachedRecord(cacheKey)
  if (cached) return cached.result

  const existingInFlight = inFlight.get(cacheKey)
  if (existingInFlight) return existingInFlight

  const computation = (async (): Promise<CorianderRfResult> => {
    const recheck = await getCachedRecord(cacheKey)
    if (recheck) return recheck.result

    let result: CorianderRfResult
    let cacheable = true
    try {
      const features = await extractCorianderRfFeatures(geometry, signal)
      const ordered = toOrderedVector(features)
      if (ordered.some((v) => v === null)) {
        result = { available: false, reason: 'SATELLITE_DATA_UNAVAILABLE' }
      } else {
        try {
          const probability = predictCorianderProbability(ordered as number[])
          result = {
            available: true, probability, probabilityPercent: Math.round(probability * 100),
            modelVersion: CORIANDER_RF_MODEL_VERSION, source: 'coriander_random_forest', labelType: 'weakly_supervised_model',
          }
        } catch (error) {
          console.error('[coriander-rf] prediction failed:', error instanceof Error ? error.message : error)
          result = { available: false, reason: 'PREDICTION_FAILED' }
          cacheable = false
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error
      console.error('[coriander-rf] feature extraction failed (transient -- not cached):', error instanceof Error ? error.message : error)
      result = { available: false, reason: 'SATELLITE_DATA_UNAVAILABLE' }
      cacheable = false
    }

    if (cacheable) {
      await saveRecord({ cacheKey, fieldId, modelVersion: CORIANDER_RF_MODEL_VERSION, featureWindowVersion: FEATURE_WINDOW_VERSION, computedAtIso: new Date().toISOString(), result })
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
