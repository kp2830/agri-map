export type FennelRfUnavailableReason =
  | 'AMED_HIGH_CONFIDENCE' // gate: RF intentionally not run
  | 'OUT_OF_SEASON' // gate: the selected month is outside Fennel's real growing season
  | 'SATELLITE_DATA_UNAVAILABLE'
  | 'SATELLITE_BUSY' // CDSE rate-limited / failing: no check possible right now
  | 'PREDICTION_FAILED'

export interface FennelRfAvailableResult {
  available: true
  probability: number
  probabilityPercent: number
  modelVersion: string
  source: 'fennel_random_forest'
  labelType: 'weakly_supervised_model'
}

export interface FennelRfUnavailableResult {
  available: false
  reason: FennelRfUnavailableReason
}

export type FennelRfResult = FennelRfAvailableResult | FennelRfUnavailableResult

export interface CachedFennelRfRecord {
  cacheKey: string
  fieldId: string
  modelVersion: string
  featureWindowVersion: string
  computedAtIso: string
  result: FennelRfResult
}
