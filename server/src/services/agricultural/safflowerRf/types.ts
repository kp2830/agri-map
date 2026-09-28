export type SafflowerRfUnavailableReason =
  | 'AMED_HIGH_CONFIDENCE' // gate: RF intentionally not run
  | 'OUT_OF_SEASON' // gate: the currently selected month falls outside Safflower's real growing season
  | 'SATELLITE_DATA_UNAVAILABLE'
  | 'PREDICTION_FAILED'

export interface SafflowerRfAvailableResult {
  available: true
  probability: number
  probabilityPercent: number
  modelVersion: string
  source: 'safflower_random_forest'
  labelType: 'weakly_supervised_model'
}

export interface SafflowerRfUnavailableResult {
  available: false
  reason: SafflowerRfUnavailableReason
}

export type SafflowerRfResult = SafflowerRfAvailableResult | SafflowerRfUnavailableResult

export interface CachedSafflowerRfRecord {
  cacheKey: string
  fieldId: string
  modelVersion: string
  featureWindowVersion: string
  computedAtIso: string
  result: SafflowerRfResult
}
