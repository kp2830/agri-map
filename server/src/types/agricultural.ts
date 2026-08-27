/** Landscape feature type as classified by ALU. */
export type AluFeatureType = 'field' | 'farm_pond' | 'other_water' | 'dug_well' | 'trees'

/** A single crop prediction (crop name + confidence) from an AMED monitoring season. */
export interface CropPrediction {
  crop: string
  confidence: number
}

/** One monitored crop season for a field, as returned by AMED. */
export interface MonitoringSeason {
  startTimestampSec: number
  endTimestampSec: number
  predictions: CropPrediction[]
}

/** ALU properties, normalized and, where AMED has matching data, enriched with monitoring seasons. */
export interface NormalizedFieldProperties {
  aluType: AluFeatureType
  areaSqM: number
  classConfidence: number
  captureTimestampSec: number
  /** null when AMED returned no monitoring data for this feature. */
  monitoring: MonitoringSeason[] | null
}

export type NormalizedFieldFeature = GeoJSON.Feature<GeoJSON.Geometry, NormalizedFieldProperties>
export type NormalizedFieldCollection = GeoJSON.FeatureCollection<GeoJSON.Geometry, NormalizedFieldProperties>
