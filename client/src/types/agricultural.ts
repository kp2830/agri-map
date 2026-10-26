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

/** A candidate/likelihood signal only — NEVER verified ground truth. `band` is calibrated
 *  against real held-out source-domain (Slovak Sunflower) fields, not against any real Indian
 *  label (none exist). See server/src/services/agricultural/sunflower/likenessModel.ts. */
export interface SunflowerLikeness {
  likeness: number
  mahalanobisLikeness: number
  knnLikeness: number
  band: 'conservative' | 'balanced' | 'exploratory' | 'below_exploratory'
}

export type SunflowerOverrideDecision =
  | { overridden: true; crop: 'SUNFLOWER'; likeness: number; band: SunflowerLikeness['band']; reason: string }
  | { overridden: false; reason: string }

export interface SunflowerLikelihoodResponse {
  likeness: SunflowerLikeness | null
  likenessUnavailableReason: string | null
  dataQuality: { sentinel2ObservationCount: number }
  override: SunflowerOverrideDecision
}

/**
 * Sunflower RF v0 — a SEPARATE, India-native, weakly-supervised model from the EuroCrops-trained
 * likeness model above (server/src/services/agricultural/sunflowerRf/). A model score/likelihood,
 * never verified ground truth — training positives are weak labels from a temporal heuristic
 * (see training/sunflower/kurukshetra_karnal_sunflower_weak_label_report.md), not field-survey-
 * confirmed Sunflower. Never display this as "confirmed" or as a calibrated statistical accuracy.
 */
export type SunflowerRfResponse =
  | {
      available: true
      probability: number
      probabilityPercent: number
      modelVersion: string
      source: 'sunflower_random_forest'
      labelType: 'weakly_supervised_model'
    }
  | { available: false; reason: 'AMED_HIGH_CONFIDENCE' | 'OUT_OF_SEASON' | 'SATELLITE_DATA_UNAVAILABLE' | 'SATELLITE_BUSY' | 'PREDICTION_FAILED' }

/**
 * Safflower RF v0 — same shape and same honesty requirements as Sunflower RF above
 * (server/src/services/agricultural/safflowerRf/). Training positives are weak labels from the
 * Latur, Maharashtra pilot (see training/safflower/score_and_tier.py) — not field-survey-
 * confirmed Safflower, and a visual spot-check of a subset of them found some that look like
 * tree/scrub cover, not cropland. Never display this as "confirmed" or as a calibrated
 * statistical accuracy.
 */
/**
 * Coriander RF v0 — same shape and honesty requirements as the Sunflower and Safflower RF
 * responses above (server/src/services/agricultural/corianderRf/). Positives are 14 real,
 * ground-collected AgriFieldNet fields from one season (rabi 2021-22); a region-transfer check was
 * poor, so this is an experimental signal, never "confirmed Coriander" or a calibrated accuracy.
 */
export type CorianderRfResponse =
  | {
      available: true
      probability: number
      probabilityPercent: number
      modelVersion: string
      source: 'coriander_random_forest'
      labelType: 'weakly_supervised_model'
    }
  | { available: false; reason: 'AMED_HIGH_CONFIDENCE' | 'OUT_OF_SEASON' | 'SATELLITE_DATA_UNAVAILABLE' | 'SATELLITE_BUSY' | 'PREDICTION_FAILED' }

/**
 * Fennel RF v0 — same shape and honesty requirements as the Sunflower, Safflower and Coriander RF responses
 * (server/src/services/agricultural/fennelRf/). Only one confirmed fennel field exists (Kotra, Udaipur); all other
 * positives are weak labels from documented fennel belts, so this is an experimental signal, never "confirmed
 * Fennel" or a calibrated accuracy.
 */
export type FennelRfResponse =
  | {
      available: true
      probability: number
      probabilityPercent: number
      modelVersion: string
      source: 'fennel_random_forest'
      labelType: 'weakly_supervised_model'
    }
  | { available: false; reason: 'AMED_HIGH_CONFIDENCE' | 'OUT_OF_SEASON' | 'SATELLITE_DATA_UNAVAILABLE' | 'SATELLITE_BUSY' | 'PREDICTION_FAILED' }

export type SafflowerRfResponse =
  | {
      available: true
      probability: number
      probabilityPercent: number
      modelVersion: string
      source: 'safflower_random_forest'
      labelType: 'weakly_supervised_model'
    }
  | { available: false; reason: 'AMED_HIGH_CONFIDENCE' | 'OUT_OF_SEASON' | 'SATELLITE_DATA_UNAVAILABLE' | 'SATELLITE_BUSY' | 'PREDICTION_FAILED' }

/** One crop observation logged by the team in the FieldView app (production), with its place name. */
/** A right/wrong verdict on one observation (see features/compare/accuracy.ts). */
export interface ObservationVerdict {
  status: 'right' | 'wrong' | 'unjudged'
  reason?: 'no_field' | 'no_prediction' | 'not_covered' | 'out_of_season' | 'no_satellite'
  /** What the predictive model said (display label), when it said anything. */
  predicted: string | null
  /** Extra line for the row, e.g. the model percentage that decided it. */
  detail?: string
  /** Capture month the model was run for. */
  month: number
}

export interface CropObservation {
  id: string
  capturedAt: string
  lat: number
  lng: number
  growthStage: string | null
  cropId: string | null
  cropName: string | null
  /** True when the user accepted the app's AI suggestion instead of picking the crop by hand. */
  aiPredicted: boolean
  aiPredictedCropName: string | null
  aiConfidence: number | null
  place: { state: string | null; district: string | null; city: string | null } | null
  /** Worked out ahead of time (demo data only); production observations are judged in the browser. */
  evaluation?: ObservationVerdict
}

export interface CropObservationsResponse {
  observations: CropObservation[]
  fetchedAt: string
  /** True when the server is showing made-up demo observations instead of the production ones. */
  demo?: boolean
}
