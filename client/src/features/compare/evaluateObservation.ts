import { getAgriculturalFields, getCorianderRf, getFennelRf, getSafflowerRf, getSunflowerRf } from '../../lib/api'
import type { CropObservation, NormalizedFieldFeature } from '../../types/agricultural'
import {
  CORIANDER_MAP_COLOR_THRESHOLD_PERCENT,
  FENNEL_MAP_COLOR_THRESHOLD_PERCENT,
  SAFFLOWER_MAP_COLOR_THRESHOLD_PERCENT,
  SUNFLOWER_MAP_COLOR_THRESHOLD_PERCENT,
  formatCropLabel,
  isRfOverrideActive,
} from '../fields/cropDisplay'
import { predictCropOutlook } from '../fields/cropPrediction'
import type { Evaluation } from './accuracy'
import { amedCropMatches, captureMonthYear, cropCoverage, findFieldAtPoint, type ModelKey } from './compareLogic'

const THRESHOLDS: Record<ModelKey, number> = {
  sunflower: SUNFLOWER_MAP_COLOR_THRESHOLD_PERCENT,
  safflower: SAFFLOWER_MAP_COLOR_THRESHOLD_PERCENT,
  coriander: CORIANDER_MAP_COLOR_THRESHOLD_PERCENT,
  fennel: FENNEL_MAP_COLOR_THRESHOLD_PERCENT,
}

const LABELS: Record<ModelKey, string> = { sunflower: 'Sunflower', safflower: 'Safflower', coriander: 'Coriander', fennel: 'Fennel' }

function runModel(key: ModelKey, field: NormalizedFieldFeature, month: number, signal: AbortSignal) {
  switch (key) {
    case 'sunflower':
      return getSunflowerRf(field, month, signal)
    case 'safflower':
      return getSafflowerRf(field, month, signal)
    case 'coriander':
      return getCorianderRf(field, month, signal)
    case 'fennel':
      return getFennelRf(field, month, signal)
  }
}

/** The label AMED's crop gets in the UI, or null when it named no real crop. */
function usableCropLabel(crop: string | null | undefined): string | null {
  return crop && crop !== 'UNKNOWN_CROP' && crop !== 'NO_PREDICTION' ? formatCropLabel(crop) : null
}

/**
 * Marks one observation right or wrong the same way the detail view does: the predictive model is
 * run for the month the observation was logged (as of today) on the field at the logged point.
 *   - AMED crops: right when the predicted crop is the crop the team logged.
 *   - Our four added crops: only that crop's own model is run, and it is right when that model would
 *     actually override AMED on the main map (probability over its threshold, AMED not confident).
 *   - Any other crop is outside our models, so there is nothing to judge.
 */
export async function evaluateObservation(observation: CropObservation, signal: AbortSignal): Promise<Evaluation> {
  const { month } = captureMonthYear(observation.capturedAt)
  const { coverage, modelKey } = cropCoverage(observation.cropName)
  if (coverage === 'other') return { status: 'unjudged', reason: 'not_covered', predicted: null, month }

  // Same search as the detail view (1 km, trusted only when the area itself has coverage), so results are cached once.
  const fields = await getAgriculturalFields(observation.lat, observation.lng, 1, 10, signal)
  const match = fields.coverage.status === 'found_in_area' ? findFieldAtPoint(fields.fieldCollection, observation.lat, observation.lng) : null
  if (!match) return { status: 'unjudged', reason: 'no_field', predicted: null, month }

  const outlook = predictCropOutlook(match.feature.properties, month, new Date().getFullYear(), 'predictive')
  const predicted = usableCropLabel(outlook?.crop)

  if (coverage === 'amed') {
    if (!predicted) return { status: 'unjudged', reason: 'no_prediction', predicted: null, month }
    return { status: amedCropMatches(observation.cropName, outlook?.crop ?? null) ? 'right' : 'wrong', predicted, month }
  }

  if (!modelKey) return { status: 'unjudged', reason: 'not_covered', predicted: null, month }
  const response = await runModel(modelKey, match.feature, month, signal)
  if (!response.available) {
    // AMED is already confident of another crop, so the main module shows that crop and never runs our model.
    if (response.reason === 'AMED_HIGH_CONFIDENCE') return { status: 'wrong', predicted, detail: 'AMED is confident of another crop', month }
    if (response.reason === 'OUT_OF_SEASON') return { status: 'unjudged', reason: 'out_of_season', predicted, month }
    if (response.reason === 'SATELLITE_DATA_UNAVAILABLE') return { status: 'unjudged', reason: 'no_satellite', predicted, month }
    // Satellite busy / prediction failed: not an answer, so it is retried later instead of being counted.
    throw new Error(`${LABELS[modelKey]} model unavailable: ${response.reason}`)
  }
  const percent = response.probabilityPercent
  const active = isRfOverrideActive(outlook?.confidencePercent ?? null, percent, THRESHOLDS[modelKey])
  const detail = `${LABELS[modelKey]} model ${percent == null ? '' : `${percent}%`}`.trim()
  return active
    ? { status: 'right', predicted: LABELS[modelKey], detail, month }
    : { status: 'wrong', predicted, detail, month }
}
