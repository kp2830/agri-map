import { useState } from 'react'
import { UNJUDGED_REASON_TEXT, accuracyPercent, type Tally, type TallyGroup, type UnjudgedReason } from './accuracy'
import type { ResultFilter } from './observationFilters'

function accuracyTone(percent: number | null): string {
  if (percent === null) return 'text-slate-400'
  if (percent >= 70) return 'text-emerald-600'
  if (percent >= 40) return 'text-amber-600'
  return 'text-red-600'
}

function Bar({ tally, height }: { tally: Tally; height: string }) {
  const pct = (n: number) => (tally.total === 0 ? 0 : (n / tally.total) * 100)
  return (
    <div className={`flex w-full overflow-hidden rounded-full bg-slate-100 ${height}`} role="img" aria-label={`${tally.right} right, ${tally.wrong} wrong, ${tally.unjudged} not judged`}>
      <div className="bg-emerald-500" style={{ width: `${pct(tally.right)}%` }} />
      <div className="bg-red-500" style={{ width: `${pct(tally.wrong)}%` }} />
      <div className="bg-slate-300" style={{ width: `${pct(tally.unjudged)}%` }} />
    </div>
  )
}

interface AccuracyBannerProps {
  /** What the numbers cover, e.g. "All observations" or "Wheat · Rajasthan". */
  scopeLabel: string
  filtered: boolean
  tally: Tally
  /** Whole-list tally, shown underneath while a filter narrows the banner. */
  overall: Tally
  activeResult: ResultFilter
  onResult: (result: ResultFilter) => void
  onRetry: () => void
}

/**
 * The headline: how many of the team's observations our predictive model got right or wrong.
 * The counts are buttons — pressing one lists exactly those observations.
 */
export function AccuracyBanner({ scopeLabel, filtered, tally, overall, activeResult, onResult, onRetry }: AccuracyBannerProps) {
  const percent = accuracyPercent(tally)
  const judged = tally.right + tally.wrong
  const overallPercent = accuracyPercent(overall)
  const reasons = (Object.keys(UNJUDGED_REASON_TEXT) as UnjudgedReason[]).filter((r) => tally.reasons[r] > 0)

  const chip = (result: Exclude<ResultFilter, 'all'>, icon: string, count: number, label: string, tone: string, activeTone: string) => (
    <button
      type="button"
      onClick={() => onResult(activeResult === result ? 'all' : result)}
      aria-pressed={activeResult === result}
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${
        activeResult === result ? activeTone : tone
      }`}
    >
      <span aria-hidden>{icon}</span>
      {count} {label}
    </button>
  )

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm" aria-label="Prediction accuracy">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Prediction accuracy</h2>
        <span className="truncate text-xs font-medium text-slate-600" title={scopeLabel}>
          {scopeLabel}
        </span>
      </div>

      <div className="mt-2 flex items-end gap-3">
        <p className={`text-4xl font-extrabold leading-none tabular-nums ${accuracyTone(percent)}`}>{percent === null ? '—' : `${percent}%`}</p>
        <p className="pb-0.5 text-xs leading-snug text-slate-500">
          {percent === null
            ? tally.pending > 0
              ? 'Checking predictions…'
              : 'No predictions could be judged here yet'
            : `${tally.right} of ${judged} judged predictions matched what the team logged`}
        </p>
      </div>

      <div className="mt-3">
        <Bar tally={tally} height="h-3" />
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {chip('right', '✓', tally.right, 'right', 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100', 'bg-emerald-600 text-white')}
        {chip('wrong', '✗', tally.wrong, 'wrong', 'bg-red-50 text-red-700 hover:bg-red-100', 'bg-red-600 text-white')}
        {chip('unjudged', '–', tally.unjudged, 'not judged', 'bg-slate-100 text-slate-600 hover:bg-slate-200', 'bg-slate-600 text-white')}
      </div>

      {(tally.pending > 0 || tally.error > 0) && (
        <p className="mt-2.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
          {tally.pending > 0 && (
            <span className="inline-flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sky-500" aria-hidden />
              Checking {tally.pending} more…
            </span>
          )}
          {tally.error > 0 && (
            <span>
              {tally.error} could not be checked (satellite busy).{' '}
              <button type="button" onClick={onRetry} className="font-semibold text-sky-700 underline">
                Retry
              </button>
            </span>
          )}
        </p>
      )}

      {reasons.length > 0 && (
        <details className="mt-2.5 text-xs text-slate-500">
          <summary className="cursor-pointer select-none font-medium text-slate-600">Why are {tally.unjudged} not judged?</summary>
          <ul className="mt-1.5 space-y-0.5 pl-1">
            {reasons.map((r) => (
              <li key={r} className="flex justify-between gap-2">
                <span>{UNJUDGED_REASON_TEXT[r]}</span>
                <span className="font-semibold tabular-nums text-slate-700">{tally.reasons[r]}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {filtered && (
        <p className="mt-3 border-t border-slate-100 pt-2 text-xs text-slate-500">
          All {overall.total} observations: <span className={`font-semibold ${accuracyTone(overallPercent)}`}>{overallPercent === null ? '—' : `${overallPercent}%`}</span> (
          {overall.right} right, {overall.wrong} wrong)
        </p>
      )}
    </section>
  )
}

export type BreakdownDimension = 'crop' | 'state' | 'district'

const DIMENSION_LABELS: Record<BreakdownDimension, string> = { crop: 'By crop', state: 'By state', district: 'By district' }
const COLLAPSED_ROWS = 6

interface AccuracyBreakdownProps {
  rows: Record<BreakdownDimension, TallyGroup[]>
  /** The value currently filtered on, per dimension ('' for none). */
  active: Record<BreakdownDimension, string>
  onPick: (dimension: BreakdownDimension, value: string) => void
}

/** Accuracy per crop, state or district. Pressing a row filters the list to it (again to clear). */
export function AccuracyBreakdown({ rows, active, onPick }: AccuracyBreakdownProps) {
  const [dimension, setDimension] = useState<BreakdownDimension>('crop')
  const [expanded, setExpanded] = useState(false)
  const groups = rows[dimension]
  const shown = expanded ? groups : groups.slice(0, COLLAPSED_ROWS)

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm" aria-label="Accuracy breakdown">
      <div role="tablist" className="flex gap-1 rounded-lg bg-slate-100 p-0.5">
        {(Object.keys(DIMENSION_LABELS) as BreakdownDimension[]).map((d) => (
          <button
            key={d}
            type="button"
            role="tab"
            aria-selected={dimension === d}
            onClick={() => {
              setDimension(d)
              setExpanded(false)
            }}
            className={`flex-1 rounded-md px-2 py-1 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${
              dimension === d ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {DIMENSION_LABELS[d]}
          </button>
        ))}
      </div>

      {groups.length === 0 ? (
        <p className="mt-3 text-xs text-slate-500">Nothing to break down yet.</p>
      ) : (
        <ul className="mt-2 space-y-0.5">
          {shown.map((g) => {
            const judged = g.tally.right + g.tally.wrong
            const percent = accuracyPercent(g.tally)
            const isActive = active[dimension] === g.key
            return (
              <li key={g.key}>
                <button
                  type="button"
                  onClick={() => onPick(dimension, isActive ? '' : g.key)}
                  aria-pressed={isActive}
                  className={`w-full rounded-md px-2 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${
                    isActive ? 'bg-sky-50 ring-1 ring-sky-300' : 'hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-medium text-slate-800">{g.label}</span>
                    <span className="shrink-0 text-xs tabular-nums text-slate-500">
                      {judged > 0 ? (
                        <>
                          <span className="text-emerald-700">{g.tally.right}✓</span> <span className="text-red-700">{g.tally.wrong}✗</span>{' '}
                          <span className={`font-bold ${accuracyTone(percent)}`}>{percent}%</span>
                        </>
                      ) : g.tally.pending > 0 ? (
                        'checking…'
                      ) : (
                        `${g.tally.total} not judged`
                      )}
                    </span>
                  </div>
                  <div className="mt-1">
                    <Bar tally={g.tally} height="h-1.5" />
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {groups.length > COLLAPSED_ROWS && (
        <button type="button" onClick={() => setExpanded((e) => !e)} className="mt-1.5 text-xs font-semibold text-sky-700 hover:text-sky-800">
          {expanded ? 'Show fewer' : `Show all ${groups.length}`}
        </button>
      )}
    </section>
  )
}
