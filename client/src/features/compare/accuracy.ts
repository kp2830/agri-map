import type { CropObservation, ObservationVerdict } from '../../types/agricultural'

/** Why an observation could not be marked right or wrong. */
export type UnjudgedReason = 'no_field' | 'no_prediction' | 'not_covered' | 'out_of_season' | 'no_satellite'

export const UNJUDGED_REASON_TEXT: Record<UnjudgedReason, string> = {
  no_field: 'No mapped field at the logged point',
  no_prediction: 'AMED has no crop for that field',
  not_covered: 'Crop is outside our models',
  out_of_season: 'Our crop model is not in season',
  no_satellite: 'No usable satellite imagery',
}

/** Verdict on one observation: did the predictive model say the crop the team logged? */
export type Evaluation = ObservationVerdict

/** A finished verdict, or a failed attempt (satellite busy, network). Absent from the map = still queued. */
export type EvalResult = Evaluation | { status: 'error' }

export type EvalMap = ReadonlyMap<string, EvalResult>

export interface Tally {
  total: number
  right: number
  wrong: number
  unjudged: number
  /** Not checked yet. */
  pending: number
  /** Checks that failed and will be retried. */
  error: number
  reasons: Record<UnjudgedReason, number>
}

export function emptyTally(): Tally {
  return { total: 0, right: 0, wrong: 0, unjudged: 0, pending: 0, error: 0, reasons: { no_field: 0, no_prediction: 0, not_covered: 0, out_of_season: 0, no_satellite: 0 } }
}

export function addToTally(tally: Tally, result: EvalResult | undefined): void {
  tally.total += 1
  if (!result) tally.pending += 1
  else if (result.status === 'error') tally.error += 1
  else if (result.status === 'right') tally.right += 1
  else if (result.status === 'wrong') tally.wrong += 1
  else {
    tally.unjudged += 1
    if (result.reason) tally.reasons[result.reason] += 1
  }
}

export function tallyObservations(observations: readonly CropObservation[], evals: EvalMap): Tally {
  const tally = emptyTally()
  for (const o of observations) addToTally(tally, evals.get(o.id))
  return tally
}

/** Right / (right + wrong), as a whole percent. Null until at least one observation has been judged. */
export function accuracyPercent(tally: Tally): number | null {
  const judged = tally.right + tally.wrong
  return judged === 0 ? null : Math.round((tally.right / judged) * 100)
}

export interface TallyGroup {
  key: string
  label: string
  tally: Tally
}

/** Tallies per group (crop, state, district), most-judged first so the groups that tell us the most lead. */
export function groupTallies(
  observations: readonly CropObservation[],
  evals: EvalMap,
  keyOf: (o: CropObservation) => string,
): TallyGroup[] {
  const groups = new Map<string, Tally>()
  for (const o of observations) {
    const key = keyOf(o)
    let tally = groups.get(key)
    if (!tally) {
      tally = emptyTally()
      groups.set(key, tally)
    }
    addToTally(tally, evals.get(o.id))
  }
  return [...groups.entries()]
    .map(([key, tally]) => ({ key, label: key, tally }))
    .sort((a, b) => b.tally.right + b.tally.wrong - (a.tally.right + a.tally.wrong) || b.tally.total - a.tally.total || a.label.localeCompare(b.label))
}
