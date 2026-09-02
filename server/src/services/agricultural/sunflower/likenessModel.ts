import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { AmedHypothesis } from './decisionPolicy.js'
import type { CustomCropModel, SunflowerFeatures, SunflowerPrediction } from './types.js'

/**
 * Positive-unlabeled Sunflower "likeness" scorer — the production port of the research pipeline
 * in training/sunflower/pilot_ensemble_score.py / export_likeness_model.py. Trained ONLY on 100
 * real EuroCrops Slovakia Sunflower fields (no negative class, no fabricated Indian labels — see
 * training/data/pilot/methodology_investigation_report_v4.md for the full derivation).
 *
 * WHAT THIS SCORE IS, EXACTLY (read before wiring this into anything user-facing):
 *   Mahalanobis distance + kNN distance to the 100 real Slovak positives, in standardized
 *   9-feature (NDVI/NDRE/NDWI/NDYI mean+peak, aggregate only — no temporal/slope features; see
 *   the model-selection rationale in export_likeness_model.py) space, converted to a [0,1]
 *   percentile "likeness" against that SAME positive population's own leave-one-field-out score
 *   distribution.
 *
 * WHAT THIS SCORE IS NOT:
 *   - NOT a calibrated probability of "this field IS Sunflower" — no real Indian Sunflower
 *     ground truth exists anywhere in this pipeline to calibrate against. `calibration: 'raw'`
 *     below is the honest label for this, per SunflowerPrediction's own type contract.
 *   - NOT on the same numeric scale as AMED's real confidences. The pilot's own India-side
 *     scores topped out at 0.269 across 250 real fields (median real held-out Slovak positive:
 *     ~0.40) — far below the 0.6-0.95 range typical of a real AMED confidence. Comparing this
 *     score directly against `AmedHypothesis.confidence` in decisionPolicy.ts's existing
 *     probability-vs-probability override logic would make Sunflower functionally unable to
 *     ever win that comparison — not dangerous, but also not useful. decisionPolicy.ts has
 *     deliberately NOT been modified to consume this score directly; see
 *     methodology_investigation_report_v4.md §13 for the integration options this leaves open.
 *   - NOT evidence the top-ranked field IS sunflower vs. e.g. a different vigorously-growing
 *     crop — the pilot found the raw aggregate-index score is measurably confounded with generic
 *     canopy vigor (dense irrigated rice fields ranked anomalously high). Treat any single score
 *     as a candidate signal, not a determination.
 */

interface LikenessModelArtifact {
  modelVersion: string
  featureSchemaVersion: string
  trainingDatasetVersion: string
  methodology: string
  features: readonly string[]
  featureMediansForImputation: Record<string, number>
  scaler: { mean: number[]; scale: number[] }
  mahalanobis: { centroid: number[]; precision: number[][] }
  knn: { k: number; referenceVectorsScaled: number[][] }
  referencePopulationRawStatistics: { mahalanobisDistances: number[]; knnMeanDistances: number[] }
  lofoCalibration: { n_held_out_folds: number; score_distribution: Record<string, number> }
  thresholds: Record<'conservative' | 'balanced' | 'exploratory', { acceptance_rate: number; threshold: number }>
}

const MODEL_PATH = fileURLToPath(new URL('./model/sunflowerLikenessModel.v1.json', import.meta.url))
const MODEL: LikenessModelArtifact = JSON.parse(readFileSync(MODEL_PATH, 'utf-8')) as LikenessModelArtifact

/** The model artifact's own LOFO-calibrated "conservative" threshold — the single source of
 *  truth for the default production override threshold (see overridePolicy.ts). Never
 *  hardcoded a second time elsewhere; overridePolicy.ts derives from this constant, optionally
 *  adjusted by the SUNFLOWER_OVERRIDE_THRESHOLD env var. */
export const DEFAULT_SUNFLOWER_LIKENESS_THRESHOLD = MODEL.thresholds.conservative.threshold

const MIN_REQUIRED_MEAN_INDICES = 2 // at least 2 of {NDVI, NDRE, NDWI, NDYI} mean values must be real, non-null
const MIN_OBSERVATION_COUNT = 3 // fewer real Sentinel-2 passes than this is too thin to trust an aggregate stat

/** Maps SunflowerSpectralFeatures onto the model's exact 9-feature order — MODEL.features is the
 *  source of truth for the order; this function must be kept in sync with it (verified by
 *  server/scripts/verifySunflowerLikeness.ts against the Python reference implementation). */
function toRawFeatureVector(spectral: SunflowerFeatures['spectral']): (number | null)[] {
  const ndreNdviPeakRatio =
    spectral.ndrePeakValue !== null && spectral.ndviPeakValue !== null && spectral.ndviPeakValue !== 0
      ? spectral.ndrePeakValue / spectral.ndviPeakValue
      : null
  return [
    spectral.ndviMean,
    spectral.ndviPeakValue,
    spectral.ndreMean,
    spectral.ndrePeakValue,
    spectral.ndwiMean,
    spectral.ndwiPeakValue,
    spectral.yellowIndexMean, // NDYI — see spectralIndices.ts's ndyiYellowness
    spectral.yellowIndexPeakValue,
    ndreNdviPeakRatio,
  ]
}

function imputeAndStandardize(raw: (number | null)[]): number[] {
  return raw.map((value, i) => {
    const feature = MODEL.features[i]
    const imputed = value ?? MODEL.featureMediansForImputation[feature]
    return (imputed - MODEL.scaler.mean[i]) / MODEL.scaler.scale[i]
  })
}

function mahalanobisDistance(scaled: number[]): number {
  const { centroid, precision } = MODEL.mahalanobis
  const diff = scaled.map((v, i) => v - centroid[i])
  let acc = 0
  for (let i = 0; i < diff.length; i++) {
    let rowDot = 0
    for (let j = 0; j < diff.length; j++) rowDot += precision[i][j] * diff[j]
    acc += diff[i] * rowDot
  }
  return Math.sqrt(Math.max(acc, 0))
}

function knnMeanDistance(scaled: number[]): number {
  const distances = MODEL.knn.referenceVectorsScaled.map((ref) => {
    let sumSq = 0
    for (let i = 0; i < scaled.length; i++) sumSq += (scaled[i] - ref[i]) ** 2
    return Math.sqrt(sumSq)
  })
  distances.sort((a, b) => a - b)
  const k = MODEL.knn.k
  return distances.slice(0, k).reduce((s, d) => s + d, 0) / k
}

/** Percentile rank of `value` within `sortedReference` (ascending), i.e. what fraction of the
 *  reference population has a distance <= value — then inverted so LOWER distance -> HIGHER
 *  likeness, matching the Python `to_likeness` convention exactly. */
function likenessFromDistance(value: number, sortedReference: number[]): number {
  let lo = 0
  let hi = sortedReference.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (sortedReference[mid] <= value) lo = mid + 1
    else hi = mid
  }
  const rank = lo / sortedReference.length
  return 1 - rank
}

export type SunflowerConfidenceBand = 'conservative' | 'balanced' | 'exploratory' | 'below_exploratory'

export interface SunflowerLikenessResult {
  /** [0,1] uncalibrated likeness score — see this module's top-level doc comment for exactly
   *  what this is and is not. */
  likeness: number
  mahalanobisLikeness: number
  knnLikeness: number
  /** Which of the source-domain leave-one-field-out-calibrated bands this score clears, if any.
   *  'conservative' = would have correctly accepted 90% of real held-out Slovak sunflower
   *  fields at this cutoff; 'balanced' = 75%; 'exploratory' = 50%; 'below_exploratory' = did not
   *  clear even the most permissive calibrated cutoff. NOT the same thing as, and NOT to be
   *  confused with, SunflowerDecisionConfig's generic confidenceBands (0.8/0.6) — those assume a
   *  calibrated-probability scale this score does not have. */
  band: SunflowerConfidenceBand
}

export function scoreSunflowerLikeness(spectral: SunflowerFeatures['spectral']): SunflowerLikenessResult | { available: false; reason: string } {
  const raw = toRawFeatureVector(spectral)
  const nonNullMeans = [raw[0], raw[2], raw[4], raw[6]].filter((v) => v !== null).length
  if (nonNullMeans < MIN_REQUIRED_MEAN_INDICES) {
    return { available: false, reason: `insufficient_spectral_indices (${nonNullMeans}/4 index means present, need >= ${MIN_REQUIRED_MEAN_INDICES})` }
  }
  if (spectral.observationCount < MIN_OBSERVATION_COUNT) {
    return { available: false, reason: `insufficient_observations (${spectral.observationCount} real Sentinel-2 passes, need >= ${MIN_OBSERVATION_COUNT})` }
  }

  const scaled = imputeAndStandardize(raw)
  const mahalanobisLikeness = likenessFromDistance(mahalanobisDistance(scaled), MODEL.referencePopulationRawStatistics.mahalanobisDistances)
  const knnLikeness = likenessFromDistance(knnMeanDistance(scaled), MODEL.referencePopulationRawStatistics.knnMeanDistances)
  const likeness = (mahalanobisLikeness + knnLikeness) / 2

  let band: SunflowerConfidenceBand = 'below_exploratory'
  if (likeness >= MODEL.thresholds.conservative.threshold) band = 'conservative'
  else if (likeness >= MODEL.thresholds.balanced.threshold) band = 'balanced'
  else if (likeness >= MODEL.thresholds.exploratory.threshold) band = 'exploratory'

  return { likeness, mahalanobisLikeness, knnLikeness, band }
}

/**
 * Satisfies the existing CustomCropModel interface (see types.ts) for architectural consistency
 * with any future model added behind the same interface — but see this module's top-level doc
 * comment: `probability` here is the uncalibrated likeness score, `calibration: 'raw'` is the
 * honest label for it, and decisionPolicy.ts's decideCrop() has deliberately NOT been changed to
 * consume this as if it were on the same scale as a real AMED confidence.
 */
export const sunflowerLikenessModel: CustomCropModel = {
  cropName: 'SUNFLOWER',
  modelVersion: MODEL.modelVersion,
  featureSchemaVersion: MODEL.featureSchemaVersion,
  predictProbability(features: SunflowerFeatures): SunflowerPrediction {
    const result = scoreSunflowerLikeness(features.spectral)
    if ('available' in result && result.available === false) {
      return { available: false, reason: result.reason }
    }
    const scored = result as SunflowerLikenessResult
    const evidence = ['sentinel2_aggregate_indices']
    if (features.historical.seasonCount > 0) evidence.push('historical_rotation')

    return {
      available: true,
      probability: scored.likeness,
      calibration: 'raw',
      modelVersion: MODEL.modelVersion,
      featureSchemaVersion: MODEL.featureSchemaVersion,
      trainingDatasetVersion: MODEL.trainingDatasetVersion,
      dataQuality: {
        sentinel2ObservationCount: features.spectral.observationCount,
        sentinel1ObservationCount: features.sar.observationCount,
        historicalSeasonCount: features.historical.seasonCount,
        daysBeforeBloom: features.daysBeforeBloom,
        featureCompleteness: toRawFeatureVector(features.spectral).filter((v) => v !== null).length / MODEL.features.length,
      },
      evidence,
    }
  },
}

/**
 * Advisory (non-overriding) display line — the "Soybean (61%) / Sunflower similarity: 73%"
 * pattern from methodology_investigation_report_v4.md §13, offered as an alternative to routing
 * this score through decisionPolicy.ts's probability-vs-probability override comparison (which
 * this module's top-level doc comment explains would be scale-mismatched today). Returns `null`
 * when the score doesn't clear even the most permissive calibrated band — i.e. nothing worth
 * surfacing, matching "don't force every field to say something about Sunflower."
 *
 * This function is NOT wired into any live route or into decideCrop() — it exists so the actual
 * production wiring decision (override vs. side-by-side vs. not-yet) can be made deliberately,
 * once reviewed, rather than defaulted to silently.
 */
export function describeSunflowerEvidence(existing: { crop: string; confidence: number | null } | null, likeness: SunflowerLikenessResult): string | null {
  if (likeness.band === 'below_exploratory') return null

  const pct = Math.round(likeness.likeness * 100)
  const bandLabel = likeness.band === 'conservative' ? 'strong' : likeness.band === 'balanced' ? 'moderate' : 'weak'
  const existingLine = existing && existing.confidence !== null ? `${existing.crop} (${Math.round(existing.confidence * 100)}%)` : existing ? existing.crop : 'Unknown'
  return `${existingLine} — Sunflower similarity: ${pct}% (${bandLabel}, uncalibrated; see evidence.sunflowerLikeness)`
}

/** Trivial adapter so this module's output can be compared against a real AmedHypothesis in
 *  demonstration/verification code without importing decisionPolicy's full override logic. */
export function toAmedHypothesisShape(likeness: SunflowerLikenessResult): AmedHypothesis {
  return { crop: 'SUNFLOWER', confidence: likeness.likeness }
}
