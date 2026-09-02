import { DEFAULT_SUNFLOWER_DECISION_CONFIG, type SunflowerDecisionConfig } from './config.js'
import type { SunflowerPrediction } from './types.js'

/** One AMED crop hypothesis for a season — either the top prediction or one of its real
 *  alternatives (AMED returns up to 3 ranked crop+confidence pairs per season). */
export interface AmedHypothesis {
  crop: string
  confidence: number
}

export interface SunflowerDecisionInput {
  /** The AMED season's top prediction, if any exists to evaluate. `null` when AMED has no
   *  usable prediction at all (no monitoring data, or every season is UNKNOWN_CROP/
   *  NO_PREDICTION). */
  amedTop: AmedHypothesis | null
  /** AMED's own remaining ranked alternatives for that same season (its real crop_2/crop_3
   *  predictions) — the genuine "competing hypotheses" this policy compares Sunflower against.
   *  Never invented: an empty array here means AMED simply didn't return alternatives. */
  amedCompeting: AmedHypothesis[]
  /** Whether `amedTop` comes from a season AMED currently, genuinely considers active (a
   *  monitoring window that actually covers today) — as opposed to a historical/fallback
   *  season. Only an actively-observed AMED result is treated as "confidently identified" and
   *  therefore un-reconsiderable — matches "AMED Wheat=0.94 (currently growing) + Sunflower=
   *  0.38 → keep Wheat", while a stale/fallback AMED crop remains open to comparison. */
  amedIsCurrentlyObserved: boolean
  sunflower: SunflowerPrediction
}

export type SunflowerConfidenceBand = 'low' | 'medium' | 'high'

export type FinalCropDecision =
  | { source: 'amed'; crop: string; confidence: number | null; reason: string }
  | {
      source: 'sunflower_model'
      crop: 'SUNFLOWER'
      /** The real, calibrated-or-raw model probability — exactly what SunflowerPrediction
       *  carried, never adjusted or inflated for display. */
      confidence: number
      confidenceBand: SunflowerConfidenceBand
      /** sunflowerProbability − strongest competing hypothesis's probability. Preserved for
       *  diagnostics regardless of whether requireMinimumMargin is enforced. */
      margin: number
      reason: string
    }
  | { source: 'none'; reason: string }

/** Presentation-only confidence band from a real probability — NOT a scientifically validated
 *  threshold (see config.ts). The underlying probability must always remain visible alongside
 *  this band; the band exists to aid quick scanning, never to replace the number. */
export function confidenceBandFor(probability: number, config: SunflowerDecisionConfig): SunflowerConfidenceBand {
  if (probability >= config.confidenceBands.high) return 'high'
  if (probability >= config.confidenceBands.medium) return 'medium'
  return 'low'
}

/**
 * The AMED + Sunflower reconciliation policy. Deliberately NOT `if AMED === UNKNOWN: Sunflower`
 * and NOT `if sunflowerScore > 0: Sunflower` — see the worked examples in the tests for exactly
 * which real-world cases this must and must not select Sunflower for.
 *
 * Order of evaluation:
 * 1. No monitoring data and no Sunflower evidence at all → 'none' (matches existing behavior).
 * 2. AMED currently, genuinely observes a season → AMED wins outright, Sunflower is never even
 *    compared (a live AMED observation is the strongest possible signal this app has).
 * 3. Sunflower model has no real prediction available (true today, always) → AMED's existing
 *    result (whatever it is — seasonal/fallback/none) stands unchanged; this policy never
 *    invents evidence where the model provided none.
 * 4. Otherwise: compare Sunflower's real probability against the strongest real competing
 *    hypothesis (AMED's own top prediction plus its real alternatives). Sunflower must be the
 *    single strongest hypothesis to be selectable at all — a numerically-highest-but-tied or
 *    behind case never selects Sunflower. If selectable, `config.requireMinimumMargin` decides
 *    whether a thin margin still counts (default: yes, surfaced honestly as low confidence,
 *    per the explicit product requirement that low-but-genuinely-leading evidence should not
 *    be hidden behind "Can't classify").
 */
export function decideCrop(
  input: SunflowerDecisionInput,
  config: SunflowerDecisionConfig = DEFAULT_SUNFLOWER_DECISION_CONFIG,
): FinalCropDecision {
  const { amedTop, amedCompeting, amedIsCurrentlyObserved, sunflower } = input

  if (!amedTop && !sunflower.available) {
    return { source: 'none', reason: 'No AMED prediction and no Sunflower model evidence available.' }
  }

  if (amedTop && amedIsCurrentlyObserved && amedTop.confidence >= config.amedStrongConfidenceThreshold) {
    return {
      source: 'amed',
      crop: amedTop.crop,
      confidence: amedTop.confidence,
      reason: `AMED currently observes ${amedTop.crop} at ${(amedTop.confidence * 100).toFixed(0)}% confidence — not reconsidered against the custom model.`,
    }
  }

  if (!sunflower.available) {
    return amedTop
      ? { source: 'amed', crop: amedTop.crop, confidence: amedTop.confidence, reason: `Custom Sunflower model has no evidence available (${sunflower.reason}); AMED result retained unchanged.` }
      : { source: 'none', reason: `No AMED prediction, and custom Sunflower model has no evidence available (${sunflower.reason}).` }
  }

  const competing: AmedHypothesis[] = [...(amedTop ? [amedTop] : []), ...amedCompeting]
  const strongestCompeting = competing.reduce<AmedHypothesis | null>(
    (best, current) => (best === null || current.confidence > best.confidence ? current : best),
    null,
  )

  const sunflowerIsLeading = strongestCompeting === null || sunflower.probability > strongestCompeting.confidence
  if (!sunflowerIsLeading) {
    // strongestCompeting is non-null whenever sunflowerIsLeading is false.
    const best = strongestCompeting as AmedHypothesis
    return {
      source: 'amed',
      crop: best.crop,
      confidence: best.confidence,
      reason: `${best.crop} (${(best.confidence * 100).toFixed(0)}%) outranks the Sunflower model's ${(sunflower.probability * 100).toFixed(0)}% — Sunflower is not the strongest supported hypothesis.`,
    }
  }

  const margin = sunflower.probability - (strongestCompeting?.confidence ?? 0)
  if (config.requireMinimumMargin && margin < config.minimumMargin) {
    return amedTop
      ? {
          source: 'amed',
          crop: amedTop.crop,
          confidence: amedTop.confidence,
          reason: `Sunflower leads numerically (${(sunflower.probability * 100).toFixed(0)}%) but the margin over the next-best hypothesis (${(margin * 100).toFixed(1)} points) is below the configured minimum — evidence too weak to override.`,
        }
      : { source: 'none', reason: `Sunflower leads numerically but the margin (${(margin * 100).toFixed(1)} points) is below the configured minimum, and there is no AMED result to fall back to.` }
  }

  return {
    source: 'sunflower_model',
    crop: 'SUNFLOWER',
    confidence: sunflower.probability,
    confidenceBand: confidenceBandFor(sunflower.probability, config),
    margin,
    reason: `Sunflower is the strongest supported hypothesis (${(sunflower.probability * 100).toFixed(0)}%, margin +${(margin * 100).toFixed(1)} pts over the next-best) from the early-season Sunflower model.`,
  }
}
