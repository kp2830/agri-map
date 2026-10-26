import { useEffect, useMemo, useRef, useState } from 'react'
import type { CropObservation } from '../../types/agricultural'
import { UNJUDGED_REASON_TEXT, groupTallies, tallyObservations, type EvalMap, type EvalResult } from './accuracy'
import { AccuracyBanner, AccuracyBreakdown, type BreakdownDimension } from './AccuracyBanner'
import { COVERAGE_LABELS, DEFAULT_FILTERS, activeFilterCount, applyFilters, buildFilterOptions, observationDistrict, observationState, sortObservations, type ObservationFilters, type SortKey } from './observationFilters'
import { cropGroupLabel } from './compareLogic'
import { formatDate, formatPlace, formatStage } from './format'
import { ObservationFilterPanel } from './ObservationFilterPanel'
import { Pagination } from './Pagination'
import { useObservationEvaluations } from './useObservationEvaluations'

const PAGE_SIZES = [10, 25, 50]
const NO_EVALS: EvalMap = new Map()

const SORT_LABELS: Record<SortKey, string> = {
  newest: 'Newest first',
  oldest: 'Oldest first',
  wrong_first: 'Wrong first',
  crop: 'Crop A–Z',
}

function VerdictChip({ result }: { result: EvalResult | undefined }) {
  if (!result) {
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-700">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sky-500" aria-hidden />
        Checking
      </span>
    )
  }
  if (result.status === 'error') return <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">Not checked</span>
  if (result.status === 'right') return <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">✓ Right</span>
  if (result.status === 'wrong') return <span className="shrink-0 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700">✗ Wrong</span>
  return <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">– Not judged</span>
}

function verdictLine(o: CropObservation, result: EvalResult | undefined): string | null {
  if (!result || result.status === 'error') return null
  if (result.status === 'unjudged') return result.reason ? UNJUDGED_REASON_TEXT[result.reason] : null
  const said = result.predicted ?? 'no crop'
  return result.status === 'right' ? `Model said ${said}${result.detail ? ` · ${result.detail}` : ''}` : `Model said ${said}, team logged ${cropGroupLabel(o.cropName)}${result.detail ? ` · ${result.detail}` : ''}`
}

const ROW_BORDER: Record<string, string> = {
  right: 'border-l-emerald-500',
  wrong: 'border-l-red-500',
  unjudged: 'border-l-slate-300',
}

function scopeLabelFor(filters: ObservationFilters): string {
  const parts: string[] = []
  if (filters.crop) parts.push(filters.crop)
  if (filters.coverage) parts.push(COVERAGE_LABELS[filters.coverage])
  if (filters.district) parts.push(filters.district)
  if (filters.state) parts.push(filters.state)
  if (filters.query.trim()) parts.push(`“${filters.query.trim()}”`)
  if (filters.from || filters.to) parts.push(filters.from === filters.to ? filters.from : `${filters.from || '…'} → ${filters.to || '…'}`)
  if (filters.stage) parts.push(formatStage(filters.stage))
  if (filters.source) parts.push(filters.source === 'ai' ? 'AI suggestion' : 'Picked by hand')
  return parts.length > 0 ? parts.join(' · ') : 'All observations'
}

interface ObservationBrowserProps {
  observations: CropObservation[]
  selectedId: string | null
  onSelect: (observation: CropObservation | null) => void
  onReload: () => void
}

/**
 * The Compare list: accuracy banner, accuracy by crop / state / district, search and filters, and
 * the paged observations. Everything is worked out from the same filters, so the banner always
 * describes exactly what the filters select — and pressing a count, a breakdown row or a
 * filter narrows the list to match. Stays mounted while one observation is open, so the filters
 * and page are exactly as they were when the user comes back.
 */
export function ObservationBrowser({ observations, selectedId, onSelect, onReload }: ObservationBrowserProps) {
  const [filters, setFilters] = useState<ObservationFilters>(DEFAULT_FILTERS)
  const [sort, setSort] = useState<SortKey>('newest')
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0])
  const [page, setPage] = useState(0)

  // Work through what is on screen first, then the rest of the current selection, then everything else.
  const order = useMemo(() => {
    const scope = sortObservations(applyFilters(observations, filters, NO_EVALS, ['result']), 'newest', NO_EVALS)
    const start = Math.min(page * pageSize, scope.length)
    const inScope = new Set(scope.map((o) => o.id))
    return [...scope.slice(start), ...scope.slice(0, start), ...observations.filter((o) => !inScope.has(o.id))]
  }, [observations, filters, page, pageSize])
  const { evals, retryFailed } = useObservationEvaluations(order)

  const scope = useMemo(() => applyFilters(observations, filters, evals, ['result']), [observations, filters, evals])
  const listed = useMemo(() => sortObservations(applyFilters(observations, filters, evals), sort, evals), [observations, filters, evals, sort])
  const pageCount = Math.max(1, Math.ceil(listed.length / pageSize))
  const safePage = Math.min(page, pageCount - 1)
  const visible = listed.slice(safePage * pageSize, safePage * pageSize + pageSize)

  const tally = useMemo(() => tallyObservations(scope, evals), [scope, evals])
  const overall = useMemo(() => tallyObservations(observations, evals), [observations, evals])
  const breakdown = useMemo(
    () => ({
      crop: groupTallies(applyFilters(observations, filters, evals, ['crop', 'result']), evals, (o) => cropGroupLabel(o.cropName)),
      state: groupTallies(applyFilters(observations, filters, evals, ['state', 'district', 'result']), evals, observationState),
      district: groupTallies(applyFilters(observations, filters, evals, ['district', 'result']), evals, observationDistrict),
    }),
    [observations, filters, evals],
  )
  const options = useMemo(() => buildFilterOptions(observations, filters), [observations, filters])
  const activeCount = activeFilterCount(filters)
  const filtered = activeCount - (filters.result !== 'all' ? 1 : 0) > 0

  function update(patch: Partial<ObservationFilters>) {
    setFilters((f) => ({ ...f, ...patch }))
    setPage(0)
  }

  function pickBreakdown(dimension: BreakdownDimension, value: string) {
    update(dimension === 'state' ? { state: value, district: '' } : ({ [dimension]: value } as Partial<ObservationFilters>))
  }

  // Moving between pages brings the top of the list back into view.
  const listTopRef = useRef<HTMLDivElement>(null)
  const firstRender = useRef(true)
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    listTopRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [safePage, pageSize])

  return (
    <div className="space-y-4">
      <AccuracyBanner
        scopeLabel={scopeLabelFor(filters)}
        filtered={filtered}
        tally={tally}
        overall={overall}
        activeResult={filters.result}
        onResult={(result) => update({ result })}
        onRetry={retryFailed}
      />

      <AccuracyBreakdown
        rows={breakdown}
        active={{ crop: filters.crop, state: filters.state, district: filters.district }}
        onPick={pickBreakdown}
      />

      <ObservationFilterPanel
        filters={filters}
        options={options}
        onChange={update}
        onClear={() => update({ ...DEFAULT_FILTERS })}
        activeCount={activeCount}
        shown={listed.length}
        total={observations.length}
      />

      <div ref={listTopRef} className="scroll-mt-2">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-900">
            {listed.length} observation{listed.length === 1 ? '' : 's'}
          </h2>
          <div className="flex items-center gap-2">
            <label htmlFor="cmp-sort" className="sr-only">
              Sort observations
            </label>
            <select
              id="cmp-sort"
              value={sort}
              onChange={(e) => {
                setSort(e.target.value as SortKey)
                setPage(0)
              }}
              className="rounded-md border border-slate-300 bg-white px-1.5 py-1 text-xs font-medium text-slate-700 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
            >
              {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
                <option key={k} value={k}>
                  {SORT_LABELS[k]}
                </option>
              ))}
            </select>
            <button type="button" onClick={onReload} className="text-xs font-medium text-sky-700 hover:text-sky-800">
              Refresh
            </button>
          </div>
        </div>

        {observations.length === 0 ? (
          <p className="text-sm text-slate-500">No crop observations have been logged yet.</p>
        ) : listed.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 p-4 text-center text-sm text-slate-500">
            No observations match these filters.
            <button type="button" onClick={() => update({ ...DEFAULT_FILTERS })} className="ml-1 font-semibold text-sky-700 underline">
              Clear filters
            </button>
          </div>
        ) : (
          <ul className="space-y-2">
            {visible.map((o) => {
              const result = evals.get(o.id)
              const line = verdictLine(o, result)
              const active = o.id === selectedId
              return (
                <li key={o.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(active ? null : o)}
                    aria-pressed={active}
                    className={`w-full rounded-lg border border-l-4 p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${
                      ROW_BORDER[result?.status ?? ''] ?? 'border-l-sky-300'
                    } ${active ? 'border-sky-500 bg-sky-50' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm font-semibold text-slate-900">{o.cropName ?? 'Unknown crop'}</span>
                      <VerdictChip result={result} />
                    </div>
                    <p className="mt-0.5 text-xs text-slate-600">{formatPlace(o.place)}</p>
                    {line && <p className="mt-0.5 text-xs text-slate-500">{line}</p>}
                    <p className="mt-0.5 text-[11px] text-slate-400">
                      {formatDate(o.capturedAt)} · {o.lat.toFixed(5)}, {o.lng.toFixed(5)} · {formatStage(o.growthStage)} ·{' '}
                      {o.aiPredicted ? 'AI suggestion accepted' : 'Picked by hand'}
                    </p>
                  </button>
                </li>
              )
            })}
          </ul>
        )}

        {listed.length > 0 && (
          <div className="mt-3 space-y-2">
            <Pagination page={safePage} pageCount={pageCount} onPage={setPage} />
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>
                {safePage * pageSize + 1}–{Math.min((safePage + 1) * pageSize, listed.length)} of {listed.length}
              </span>
              <label className="flex items-center gap-1.5">
                Per page
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value))
                    setPage(0)
                  }}
                  className="rounded-md border border-slate-300 bg-white px-1.5 py-1 text-xs text-slate-700 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                >
                  {PAGE_SIZES.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
