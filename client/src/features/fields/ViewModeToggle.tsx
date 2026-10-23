import { useId } from 'react'
import { PAST_DATA_FIRST_YEAR, type ViewMode } from './cropPrediction'

interface ViewModeToggleProps {
  mode: ViewMode
  onModeChange: (mode: ViewMode) => void
  /** Only used in the Past data view. */
  year: number
  onYearChange: (year: number) => void
}

const selectClasses =
  'rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:border-indigo-500'

const segmentBase =
  'px-3 py-1.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500'

/**
 * Switches the whole app between the two ways of reading the same AMED data: the Predictive
 * model (default — what is likely to grow in a month, estimated from earlier seasons, plus our
 * experimental Sunflower/Safflower/Coriander/Fennel models) and Past data (what AMED actually
 * recorded in a chosen month and year, 12 AMED crops only). The year picker only exists in the
 * Past data view — the Predictive model always looks at the current year.
 */
export function ViewModeToggle({ mode, onModeChange, year, onYearChange }: ViewModeToggleProps) {
  const yearId = useId()
  const currentYear = new Date().getFullYear()
  const years: number[] = []
  for (let y = currentYear; y >= PAST_DATA_FIRST_YEAR; y--) years.push(y)

  return (
    <div className="flex items-end gap-3">
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-slate-500">Data Mode</span>
        <div role="group" aria-label="Data mode" className="inline-flex overflow-hidden rounded-md border border-slate-300 shadow-sm">
          <button
            type="button"
            aria-pressed={mode === 'predictive'}
            onClick={() => onModeChange('predictive')}
            className={`${segmentBase} ${mode === 'predictive' ? 'bg-emerald-600 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'}`}
          >
            Predictive
          </button>
          <button
            type="button"
            aria-pressed={mode === 'past'}
            onClick={() => onModeChange('past')}
            className={`${segmentBase} border-l border-slate-300 ${mode === 'past' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'}`}
          >
            Past data
          </button>
        </div>
      </div>

      {mode === 'past' && (
        <div className="flex flex-col gap-1">
          <label htmlFor={yearId} className="text-xs font-medium text-slate-500">
            Year
          </label>
          <select id={yearId} value={year} onChange={(event) => onYearChange(Number(event.target.value))} className={selectClasses}>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  )
}
