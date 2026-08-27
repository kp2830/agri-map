export type AluFeatureType = 'field' | 'farm_pond' | 'other_water' | 'dug_well' | 'trees'

export interface CropPrediction {
  crop: string
  confidence: number
}

export interface MonitoringSeason {
  startTimestampSec: number
  endTimestampSec: number
  predictions: CropPrediction[]
}

export interface NormalizedFieldProperties {
  aluType: AluFeatureType
  areaSqM: number
  classConfidence: number
  captureTimestampSec: number
  monitoring: MonitoringSeason[] | null
}

export type NormalizedFieldFeature = GeoJSON.Feature<GeoJSON.Geometry, NormalizedFieldProperties>
export type NormalizedFieldCollection = GeoJSON.FeatureCollection<GeoJSON.Geometry, NormalizedFieldProperties>

export interface FieldsResponse {
  s2CellId: string
  fieldCollection: NormalizedFieldCollection
}
