import type { ReactNode } from 'react'
import {
  COVERAGE_LABELS,
  type FilterOption,
  type FilterOptions,
  type ObservationFilters,
  type ResultFilter,
} from './observationFilters'

const RESULT_OPTIONS: Array<{ value: ResultFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'right', label: '✓ Right' },
  { value: 'wrong', label: '✗ Wrong' },
  { value: 'unjudged', label: '– Not judged' },
]

const SELECT_CLASS =
  'w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500'

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={htmlFor} className="text-xs font-medium text-slate-500">
        {label}
      </label>
      {children}
    </div>
  )
}

function Options({ options }: { options: FilterOption[] }) {
  return (
    <>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label} ({o.count})
        </option>
      ))}
    </>
  )
}

function isoDaysAgo(days: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

interface ObservationFilterPanelProps {
  filters: ObservationFilters
  options: FilterOptions
  onChange: (patch: Partial<ObservationFilters>) => void
  onClear: () => void
  activeCount: number
  shown: number
  total: number
}

/**
 * Search and filters for the observation list: free text (crop, state, district, city), crop,
 * state, district, crop group, a date or date range, growth stage and how the crop was entered.
 * Every dropdown lists only values that exist in the data, with how many observations each has.
 */
export function ObservationFilterPanel({ filters, options, onChange, onClear, activeCount, shown, total }: ObservationFilterPanelProps) {
  const today = new Date().toISOString().slice(0, 10)
  const singleDay = filters.from !== '' && filters.from === filters.to

  return (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm" aria-label="Search and filter observations">
      <div className="relative">
        <svg className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <circle cx="9" cy="9" r="6" />
          <path d="m14 14 4 4" strokeLinecap="round" />
        </svg>
        <input
          type="search"
          value={filters.query}
          onChange={(event) => onChange({ query: event.target.value })}
          placeholder="Search crop, state, district or city…"
          aria-label="Search observations"
          className="w-full rounded-md border border-slate-300 bg-white py-2 pl-8 pr-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
        />
      </div>

      <div role="group" aria-label="Filter by result" className="flex gap-1 rounded-lg bg-slate-100 p-0.5">
        {RESULT_OPTIONS.map((r) => (
          <button
            key={r.value}
            type="button"
            aria-pressed={filters.result === r.value}
            onClick={() => onChange({ result: r.value })}
            className={`flex-1 rounded-md px-1.5 py-1 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${
              filters.result === r.value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <Field label="Crop" htmlFor="cmp-crop">
          <select id="cmp-crop" value={filters.crop} onChange={(e) => onChange({ crop: e.target.value })} className={SELECT_CLASS}>
            <option value="">All crops</option>
            {options.crops.amed.length > 0 && (
              <optgroup label={COVERAGE_LABELS.amed}>
                <Options options={options.crops.amed} />
              </optgroup>
            )}
            {options.crops.added.length > 0 && (
              <optgroup label={COVERAGE_LABELS.added}>
                <Options options={options.crops.added} />
              </optgroup>
            )}
            {options.crops.other.length > 0 && (
              <optgroup label={COVERAGE_LABELS.other}>
                <Options options={options.crops.other} />
              </optgroup>
            )}
          </select>
        </Field>
        <Field label="State" htmlFor="cmp-state">
          {/* Changing the state clears a district that belongs to another state. */}
          <select id="cmp-state" value={filters.state} onChange={(e) => onChange({ state: e.target.value, district: '' })} className={SELECT_CLASS}>
            <option value="">All states</option>
            <Options options={options.states} />
          </select>
        </Field>
        <Field label="District" htmlFor="cmp-district">
          <select id="cmp-district" value={filters.district} onChange={(e) => onChange({ district: e.target.value })} className={SELECT_CLASS}>
            <option value="">{filters.state ? `All of ${filters.state}` : 'All districts'}</option>
            <Options options={options.districts} />
          </select>
        </Field>
        <Field label="Crop group" htmlFor="cmp-coverage">
          <select id="cmp-coverage" value={filters.coverage} onChange={(e) => onChange({ coverage: e.target.value as ObservationFilters['coverage'] })} className={SELECT_CLASS}>
            <option value="">All groups</option>
            {(Object.keys(COVERAGE_LABELS) as Array<keyof typeof COVERAGE_LABELS>).map((c) => (
              <option key={c} value={c}>
                {COVERAGE_LABELS[c]}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div>
        <div className="grid grid-cols-2 gap-2.5">
          <Field label={singleDay ? 'Date' : 'From date'} htmlFor="cmp-from">
            <input
              id="cmp-from"
              type="date"
              value={filters.from}
              max={filters.to || today}
              onChange={(e) => onChange({ from: e.target.value })}
              className={SELECT_CLASS}
            />
          </Field>
          <Field label="To date" htmlFor="cmp-to">
            <input id="cmp-to" type="date" value={filters.to} min={filters.from || undefined} max={today} onChange={(e) => onChange({ to: e.target.value })} className={SELECT_CLASS} />
          </Field>
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {[
            { label: 'Today', from: today, to: today },
            { label: 'Last 7 days', from: isoDaysAgo(6), to: today },
            { label: 'Last 30 days', from: isoDaysAgo(29), to: today },
          ].map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => onChange({ from: preset.from, to: preset.to })}
              className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-xs font-medium text-slate-600 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
            >
              {preset.label}
            </button>
          ))}
          {singleDay && <span className="px-1 text-xs text-slate-400">One day. Set “To date” for a range.</span>}
        </div>
      </div>

      <details className="text-sm">
        <summary className="cursor-pointer select-none text-xs font-semibold text-slate-600">More filters</summary>
        <div className="mt-2 grid grid-cols-2 gap-2.5">
          <Field label="Growth stage" htmlFor="cmp-stage">
            <select id="cmp-stage" value={filters.stage} onChange={(e) => onChange({ stage: e.target.value })} className={SELECT_CLASS}>
              <option value="">Any stage</option>
              <Options options={options.stages} />
            </select>
          </Field>
          <Field label="How it was logged" htmlFor="cmp-source">
            <select id="cmp-source" value={filters.source} onChange={(e) => onChange({ source: e.target.value as ObservationFilters['source'] })} className={SELECT_CLASS}>
              <option value="">Either</option>
              <option value="manual">Picked by hand</option>
              <option value="ai">AI suggestion accepted</option>
            </select>
          </Field>
        </div>
      </details>

      <div className="flex items-center justify-between border-t border-slate-100 pt-2.5 text-xs">
        <span className="text-slate-500">
          Showing <span className="font-semibold text-slate-800">{shown}</span> of {total}
        </span>
        {activeCount > 0 && (
          <button type="button" onClick={onClear} className="font-semibold text-sky-700 hover:text-sky-800">
            Clear {activeCount} filter{activeCount === 1 ? '' : 's'}
          </button>
        )}
      </div>
    </section>
  )
}
