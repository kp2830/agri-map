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

export interface CoverageInfo {
  /** 'found_in_area': coverage was within the initial user-selected grid area. 'found_nearby': the search expanded outward to find it. 'not_found': nothing within the user-selected max search radius. */
  status: 'found_in_area' | 'found_nearby' | 'not_found'
  /** Side length (km) of the square area that was searched when this result was produced. */
  searchAreaSideKm: number
  /** Distance (km) from the selected point to the nearest returned field, or null if none found. */
  nearestDistanceKm: number | null
  /** Approximate centroid of the nearest returned field, or null if none found. */
  nearestFieldCentroid: { lat: number; lng: number } | null
  /** The configured maximum search radius (km) — the backend never looks further than this. */
  maxSearchRadiusKm: number
}

export interface FieldsResponse {
  selected: { lat: number; lng: number }
  s2CellIds: string[]
  fieldCollection: NormalizedFieldCollection
  coverage: CoverageInfo
}
