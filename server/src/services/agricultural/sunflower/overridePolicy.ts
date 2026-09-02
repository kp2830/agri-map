import type { AmedHypothesis } from './decisionPolicy.js'
import type { SunflowerConfidenceBand, SunflowerLikenessResult } from './likenessModel.js'
import { DEFAULT_SUNFLOWER_LIKENESS_THRESHOLD } from './likenessModel.js'

/**
 * The SIMPLE threshold-based override this feature actually needs — deliberately NOT
 * decisionPolicy.ts's decideCrop(), which does a margin comparison assuming Sunflower's
 * probability is on the same numeric scale as a real AMED confidence (0.4-0.95). The exported
 * likeness score tops out far lower (max observed across the 250-field pilot: 0.485) — comparing
 * it head-to-head against AMED's confidence would make it functionally unable to ever win, so
 * this uses a source-domain-calibrated absolute threshold instead (see likenessModel.ts's
 * `thresholds`, derived from real leave-one-field-out testing on the 100 Slovak positives).
 *
 * decideCrop() is left completely untouched — it remains available for a future richer
 * reconciliation if the scale question is resolved deliberately (see
 * training/data/pilot/methodology_investigation_report_v4.md §13).
 */
export interface SunflowerOverrideConfig {
  /** Global kill switch — when false, this override never fires regardless of score. */
  enabled: boolean
  /** An AMED prediction at or above this confidence is "high-confidence" and is NEVER
   *  reconsidered, matching decisionPolicy.ts's amedStrongConfidenceThreshold semantics exactly
   *  (same constant, reused — not a second, possibly-drifting copy). */
  amedStrongConfidenceThreshold: number
  /** The likeness score (0-1, uncalibrated — see likenessModel.ts) required to override an
   *  Unknown/low-confidence AMED result. Defaults to the model artifact's own LOFO-calibrated
   *  "conservative" threshold (real, derived — not picked arbitrarily); overridable via the
   *  SUNFLOWER_OVERRIDE_THRESHOLD env var for tuning without redeploying the model artifact. */
  threshold: number
}

function readThresholdOverrideFromEnv(): number | null {
  const raw = process.env.SUNFLOWER_OVERRIDE_THRESHOLD
  if (raw === undefined) return null
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : null
}

export const DEFAULT_SUNFLOWER_OVERRIDE_CONFIG: SunflowerOverrideConfig = {
  enabled: true,
  amedStrongConfidenceThreshold: 0.8, // matches DEFAULT_SUNFLOWER_DECISION_CONFIG in config.ts
  threshold: readThresholdOverrideFromEnv() ?? DEFAULT_SUNFLOWER_LIKENESS_THRESHOLD,
}

export interface SunflowerOverrideInput {
  /** AMED's current top prediction for this field, if any — null means Unknown/no prediction. */
  amedTop: AmedHypothesis | null
  /** Whether amedTop comes from a season AMED currently, actively observes — mirrors
   *  decisionPolicy.ts's SunflowerDecisionInput.amedIsCurrentlyObserved exactly. */
  amedIsCurrentlyObserved: boolean
  /** null when the likeness model had insufficient real data (see likenessModel.ts's
   *  MIN_REQUIRED_MEAN_INDICES/MIN_OBSERVATION_COUNT gates) or satellite extraction failed —
   *  never a fabricated score. */
  likeness: SunflowerLikenessResult | null
}

export type SunflowerOverrideDecision =
  | { overridden: true; crop: 'SUNFLOWER'; likeness: number; band: SunflowerConfidenceBand; reason: string }
  | { overridden: false; reason: string }

/**
 * "If AMED is Unknown/low-confidence AND the Sunflower likeness clears the configured
 * threshold, show Sunflower instead. Otherwise, and ALWAYS when AMED is confidently observed,
 * keep the existing AMED result unchanged." Exactly the rule described in the product
 * requirement — nothing more elaborate.
 */
export function decideSunflowerOverride(input: SunflowerOverrideInput, config: SunflowerOverrideConfig = DEFAULT_SUNFLOWER_OVERRIDE_CONFIG): SunflowerOverrideDecision {
  if (!config.enabled) {
    return { overridden: false, reason: 'Sunflower override is disabled by configuration.' }
  }

  if (input.amedTop && input.amedIsCurrentlyObserved && input.amedTop.confidence >= config.amedStrongConfidenceThreshold) {
    return {
      overridden: false,
      reason: `AMED currently observes ${input.amedTop.crop} at ${(input.amedTop.confidence * 100).toFixed(0)}% confidence — high-confidence known crops are never reconsidered against the Sunflower likeness score.`,
    }
  }

  if (input.likeness === null) {
    return { overridden: false, reason: 'No Sunflower likeness score available (insufficient real Sentinel-2 observations, unsupported geometry, or extraction failure) — existing AMED result retained.' }
  }

  if (input.likeness.likeness < config.threshold) {
    return {
      overridden: false,
      reason: `Sunflower likeness (${(input.likeness.likeness * 100).toFixed(1)}%) is below the configured override threshold (${(config.threshold * 100).toFixed(1)}%) — existing AMED result retained.`,
    }
  }

  return {
    overridden: true,
    crop: 'SUNFLOWER',
    likeness: input.likeness.likeness,
    band: input.likeness.band,
    reason: `Sunflower likeness (${(input.likeness.likeness * 100).toFixed(1)}%) clears the configured override threshold (${(config.threshold * 100).toFixed(1)}%) while AMED had ${input.amedTop ? `only a low-confidence (${(input.amedTop.confidence * 100).toFixed(0)}%) ${input.amedTop.crop} prediction` : 'no usable prediction'} — this is a model likelihood, NOT verified ground truth (no real Indian Sunflower labels exist to validate against).`,
  }
}
