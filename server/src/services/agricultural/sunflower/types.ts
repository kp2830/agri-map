/**
 * Types for the custom Sunflower classification pathway — a hybrid, field-level pipeline that
 * sits ALONGSIDE AMED (never replacing it): AMED continues to own its existing 12 crop classes;
 * this module exists only to evaluate an additional Sunflower hypothesis when AMED's own result
 * for a field is weak or unknown, using the SAME ALU field polygon as the spatial unit.
 *
 * IMPORTANT — current state (see sunflowerModel.ts / featureExtraction.ts for why): no Google
 * Earth Engine access and no real Indian Sunflower ground-truth data exist in this environment,
 * so `SunflowerModel.predictProbability` always returns `{ available: false }` today. Every type
 * here is real, production-shaped scaffolding for when those two dependencies exist — none of it
 * fabricates a working classifier.
 */

/** A field's own historical AMED monitoring, reused (not duplicated) as the "historical crop
 *  rotation" signal the founder's document calls for. Derived entirely from data the app
 *  already has — see historicalFeatures.ts. */
export interface SunflowerHistoricalFeatures {
  /** Number of real historical AMED monitoring seasons available for this field. */
  seasonCount: number
  /** Whether AMED has ever reported this field as Sunflower. Always false today since AMED has
   *  no Sunflower class — retained for forward compatibility if that ever changes. */
  hasHistoricalSunflowerOccurrence: boolean
  /** The real, distinct AMED-reported crops seen in this field's history (excludes the
   *  UNKNOWN_CROP/NO_PREDICTION sentinels, which are not confirmed labels of anything). */
  distinctHistoricalCrops: string[]
}

/** Real, well-defined vegetation/SAR index values for a field over a temporal window. Every
 *  field is optional/nullable because, honestly, none of them can be populated without a
 *  configured satellite feature-extraction backend (see featureExtraction.ts). A `null` here
 *  must never be silently treated as zero. */
export interface SunflowerSpectralFeatures {
  /** Mean NDVI across the temporal window. */
  ndviMean: number | null
  /** Linear trend (per day) of NDVI across the window — the "growth rate" the founder's
   *  document asks for, not a single-image snapshot. */
  ndviSlope: number | null
  /** Highest real NDVI value observed in the window. Added alongside the pilot's positive-
   *  unlabeled likeness model (see likenessModel.ts) — peak value (not just the whole-window
   *  mean) turned out to carry real, independent signal in the pilot's within-source crop-signal
   *  and India-transfer experiments (see training/data/pilot/methodology_investigation_report*.md). */
  ndviPeakValue: number | null
  ndreMean: number | null
  ndreSlope: number | null
  ndrePeakValue: number | null
  ndwiMean: number | null
  ndwiPeakValue: number | null
  /** See spectralIndices.ts for the exact formula used and why — flagged there as a candidate
   *  pending confirmation against the original founder document, which this session has not had
   *  direct access to (only paraphrased descriptions). */
  yellowIndexMean: number | null
  yellowIndexSlope: number | null
  yellowIndexPeakValue: number | null
  /** Real Sentinel-2 cloud-filtered observation count feeding the above statistics — the basis
   *  for `dataQuality.sentinel2ObservationCount`. Never fabricated to look "complete". */
  observationCount: number
}

export interface SunflowerSarFeatures {
  vvMean: number | null
  vhMean: number | null
  vvVhRatioMean: number | null
  /** Temporal change (per day) in VV/VH — the "structural/temporal SAR signal" the founder's
   *  document asks for. */
  vvVhRatioSlope: number | null
  observationCount: number
}

/** The full real feature vector for one field, at one point in (pre-bloom) time. This is what
 *  `SunflowerModel.predictProbability` actually consumes — never partially fabricated: a
 *  missing signal is `null`/0, not guessed. */
export interface SunflowerFeatures {
  spectral: SunflowerSpectralFeatures
  sar: SunflowerSarFeatures
  historical: SunflowerHistoricalFeatures
  /** Days before the (estimated or known) flowering date this feature snapshot represents.
   *  `null` when no bloom-date estimate exists — see phenology note in featureExtraction.ts;
   *  this must never be assumed to be exactly 30 without a real basis. */
  daysBeforeBloom: number | null
}

/** Honest data-quality metadata surfaced with every prediction — per-field evidence strength,
 *  not a confidence score. Lets the decision policy (and, if ever exposed, the UI) distinguish
 *  "1 cloudy Sentinel-2 pass and nothing else" from "5 clean passes + 4 SAR passes + 3 years of
 *  real history" without needing to inflate or deflate the model's own probability to compensate. */
export interface SunflowerDataQuality {
  sentinel2ObservationCount: number
  sentinel1ObservationCount: number
  historicalSeasonCount: number
  daysBeforeBloom: number | null
  /** 0..1, a simple real completeness score (fraction of the defined feature schema that is
   *  non-null) — NOT a probability, never presented to the user as model confidence. */
  featureCompleteness: number
}

/**
 * The result of evaluating the Sunflower pathway for one field. `available: false` is not an
 * error — it is the honest, expected result whenever real feature extraction or a real trained
 * model isn't available (which is always, today). Callers (the decision policy) must treat an
 * unavailable prediction exactly like "no custom-model evidence", never as "Sunflower is
 * disproven" and never as "assume Sunflower".
 */
export type SunflowerPrediction =
  | {
      available: false
      /** Specific, honest reason — surfaced in logs/diagnostics, never shown to the end user as
       *  if it were a crop fact. E.g. 'gee_not_configured', 'no_trained_model', 'insufficient_observations'. */
      reason: string
    }
  | {
      available: true
      /** The REAL model output — raw or calibrated, whichever `calibration` below identifies.
       *  Never a value invented to look plausible. */
      probability: number
      calibration: 'raw' | 'calibrated'
      modelVersion: string
      featureSchemaVersion: string
      trainingDatasetVersion: string
      dataQuality: SunflowerDataQuality
      /** Which real feature groups actually contributed non-null values to this prediction —
       *  e.g. ['sentinel2_temporal', 'historical_rotation']. Never claims a group was used if
       *  its features were null for this field. */
      evidence: string[]
    }

/**
 * A custom crop-classification model additional to AMED's fixed 12 classes. Designed so more
 * models (Sesame, Mustard-vs-X, etc.) can be added later behind the same interface without
 * rewriting the decision policy or the pipeline that calls it — see decisionPolicy.ts.
 */
export interface CustomCropModel {
  readonly cropName: string
  readonly modelVersion: string
  readonly featureSchemaVersion: string
  /** Never throws for "no data" — returns `{ available: false, reason }` instead, so a missing
   *  dependency degrades gracefully rather than breaking the field analysis (see
   *  server/src/services/agricultural/sunflower/sunflowerModel.ts). `features` is always a real
   *  object (historical data needs no satellite access and is always populated); individual
   *  spectral/SAR sub-fields are null when satellite extraction wasn't possible — the model
   *  decides for itself whether what's present is sufficient, rather than the caller guessing. */
  predictProbability(features: SunflowerFeatures): SunflowerPrediction
}
