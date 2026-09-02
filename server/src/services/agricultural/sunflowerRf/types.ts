export type SunflowerRfUnavailableReason =
  | 'AMED_HIGH_CONFIDENCE' // gate: RF intentionally not run
  | 'SATELLITE_DATA_UNAVAILABLE'
  | 'PREDICTION_FAILED'

export interface SunflowerRfAvailableResult {
  available: true
  probability: number
  probabilityPercent: number
  modelVersion: string
  source: 'sunflower_random_forest'
  labelType: 'weakly_supervised_model'
}

export interface SunflowerRfUnavailableResult {
  available: false
  reason: SunflowerRfUnavailableReason
}

export type SunflowerRfResult = SunflowerRfAvailableResult | SunflowerRfUnavailableResult

export interface CachedSunflowerRfRecord {
  cacheKey: string
  fieldId: string
  modelVersion: string
  featureWindowVersion: string
  computedAtIso: string
  result: SunflowerRfResult
}
