/**
 * Configurable thresholds for the AMED + Sunflower decision policy (decisionPolicy.ts). Every
 * value here is a documented, deliberately conservative placeholder — NONE of them has been
 * validated against real held-out data, because no real Sunflower-labeled data exists yet (see
 * the project's training-data investigation). They must be re-tuned once real validation data
 * exists; until then they exist so the decision logic is genuinely configurable rather than
 * hardcoded inline, per the explicit requirement not to hardcode "Sunflower must be >85%" or
 * any other single arbitrary number as the entire decision mechanism.
 */
export interface SunflowerDecisionConfig {
  /** An AMED season's own top prediction at or above this confidence is treated as
   *  "confidently identified" and is never reconsidered against Sunflower, regardless of the
   *  Sunflower model's probability — matches "AMED Wheat=0.94 + Sunflower=0.38 → keep Wheat". */
  amedStrongConfidenceThreshold: number
  /** Whether a minimum margin between Sunflower and the strongest competing hypothesis is
   *  enforced before Sunflower can be selected. Per the founder's explicit product requirement,
   *  this defaults to `false` — a low-but-genuinely-leading Sunflower probability is allowed to
   *  surface (with honest low-confidence labeling) rather than being suppressed. Set `true` only
   *  once real validation data demonstrates that small margins produce unacceptable false
   *  positives — never flip this from empirical guesswork. */
  requireMinimumMargin: boolean
  /** Only consulted when `requireMinimumMargin` is true. */
  minimumMargin: number
  /** Presentation-only confidence bands — NOT scientifically validated thresholds. See
   *  formatSunflowerConfidenceBand in decisionPolicy.ts for where these are applied and why
   *  they must never be presented as more rigorous than they are. */
  confidenceBands: { high: number; medium: number }
}

export const DEFAULT_SUNFLOWER_DECISION_CONFIG: SunflowerDecisionConfig = {
  amedStrongConfidenceThreshold: 0.8,
  requireMinimumMargin: false,
  minimumMargin: 0.05,
  confidenceBands: { high: 0.8, medium: 0.6 },
}
