import type { MonitoringSeason, NormalizedFieldProperties } from '../../../types/agricultural.js'
import type { AmedHypothesis } from './decisionPolicy.js'

export interface AmedHypothesesResult {
  amedTop: AmedHypothesis | null
  amedCompeting: AmedHypothesis[]
  amedIsCurrentlyObserved: boolean
}

/**
 * Converts a field's real AMED monitoring history into the shape decisionPolicy.ts needs:
 * the season's top prediction, its real ranked alternatives (AMED itself returns up to 3
 * crop+confidence pairs per season — these become the genuine "competing hypotheses", never
 * invented), and whether that season is one AMED currently, actively observes.
 *
 * Deliberately mirrors the recency-first season-selection logic in the client's
 * cropDisplay.ts (getActiveCropOutcome) — server and client are separate npm projects with no
 * shared code path (see CLAUDE.md), so this is an intentional, minimal re-implementation of
 * just the season-selection step, not a duplicate of the full seasonal-inference algorithm
 * (margin/majority logic, etc.) which stays client-only. If that client-side algorithm changes,
 * this should be revisited for consistency — it is not automatically kept in sync.
 *
 * `UNKNOWN_CROP`/`NO_PREDICTION` predictions are filtered out entirely: they are not confirmed
 * competing crops, and including them as a "hypothesis" would mean comparing Sunflower against
 * AMED's own uncertainty rather than against a real, named alternative.
 */
export function buildAmedHypotheses(properties: NormalizedFieldProperties, nowSec: number = Date.now() / 1000): AmedHypothesesResult {
  const seasons = properties.monitoring ?? []
  if (seasons.length === 0) return { amedTop: null, amedCompeting: [], amedIsCurrentlyObserved: false }

  const isOngoing = (season: MonitoringSeason) =>
    season.startTimestampSec <= nowSec && (!Number.isFinite(season.endTimestampSec) || season.endTimestampSec >= nowSec)

  const ongoing = seasons.filter(isOngoing)
  const isCurrentlyObserved = ongoing.length > 0
  const candidates = isCurrentlyObserved ? ongoing : seasons
  const relevantSeason = candidates.reduce((latest, season) => (season.startTimestampSec > latest.startTimestampSec ? season : latest))

  const validPredictions = relevantSeason.predictions.filter((p) => p.crop !== 'UNKNOWN_CROP' && p.crop !== 'NO_PREDICTION')
  if (validPredictions.length === 0) return { amedTop: null, amedCompeting: [], amedIsCurrentlyObserved: false }

  const [amedTop, ...amedCompeting] = validPredictions
  return { amedTop, amedCompeting, amedIsCurrentlyObserved: isCurrentlyObserved }
}
