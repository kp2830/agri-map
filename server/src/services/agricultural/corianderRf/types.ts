export type CorianderRfUnavailableReason =
  | 'AMED_HIGH_CONFIDENCE' // gate: RF intentionally not run
  | 'OUT_OF_SEASON' // gate: the selected month is outside Coriander's real growing season
  | 'SATELLITE_DATA_UNAVAILABLE'
  | 'SATELLITE_BUSY' // CDSE rate-limited / failing: no check possible right now
  | 'PREDICTION_FAILED'

export interface CorianderRfAvailableResult {
  available: true
  probability: number
  probabilityPercent: number
  modelVersion: string
  source: 'coriander_random_forest'
  labelType: 'weakly_supervised_model'
}

export interface CorianderRfUnavailableResult {
  available: false
  reason: CorianderRfUnavailableReason
}

export type CorianderRfResult = CorianderRfAvailableResult | CorianderRfUnavailableResult

export interface CachedCorianderRfRecord {
  cacheKey: string
  fieldId: string
  modelVersion: string
  featureWindowVersion: string
  computedAtIso: string
  result: CorianderRfResult
}
