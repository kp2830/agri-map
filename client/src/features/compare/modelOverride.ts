import {
  CORIANDER_MAP_COLOR_THRESHOLD_PERCENT,
  FENNEL_MAP_COLOR_THRESHOLD_PERCENT,
  SAFFLOWER_MAP_COLOR_THRESHOLD_PERCENT,
  SUNFLOWER_MAP_COLOR_THRESHOLD_PERCENT,
  isRfOverrideActive,
} from '../fields/cropDisplay'
import type { ModelKey } from './compareLogic'
import type { ObservationComparison } from './useObservationComparison'

const THRESHOLDS: Record<ModelKey, number> = {
  sunflower: SUNFLOWER_MAP_COLOR_THRESHOLD_PERCENT,
  safflower: SAFFLOWER_MAP_COLOR_THRESHOLD_PERCENT,
  coriander: CORIANDER_MAP_COLOR_THRESHOLD_PERCENT,
  fennel: FENNEL_MAP_COLOR_THRESHOLD_PERCENT,
}

const MODEL_KEYS: ModelKey[] = ['sunflower', 'safflower', 'coriander', 'fennel']

export interface ModelOverride {
  key: ModelKey
  percent: number
}

/**
 * The crop one of our four models takes over from AMED for the observed field — the same rule the
 * main predictive module uses (probability over the model's threshold and AMED not confident), and
 * with several qualifying, the strongest one. Null when none does, so the crop stays AMED's.
 */
export function activeModelOverride(data: ObservationComparison): ModelOverride | null {
  let best: ModelOverride | null = null
  for (const key of MODEL_KEYS) {
    const check = data[key]
    if (check.status !== 'done' || !check.response.available) continue
    const percent = check.response.probabilityPercent
    if (!isRfOverrideActive(data.amedPredictive?.confidencePercent ?? null, percent, THRESHOLDS[key])) continue
    if (!best || percent > best.percent) best = { key, percent }
  }
  return best
}
