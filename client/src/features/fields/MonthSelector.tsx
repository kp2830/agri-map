import { useId } from 'react'

interface MonthSelectorProps {
  /** 1-12. */
  month: number
  onMonthChange: (month: number) => void
}

const MONTH_LABELS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

const selectClasses =
  'rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:border-emerald-500'

/**
 * Lets the user ask "what crop would be growing around <month>" instead of only ever seeing
 * today's answer — same existing AMED seasonal-matching logic (see monthToReferenceDateSec in
 * cropDisplay.ts), just fed a different reference date. Lives in the header, independent of
 * having searched a location yet, so it's already set before the very first Analyze/click —
 * exactly like the existing Field Coverage/Max Search selectors it sits alongside.
 */
export function MonthSelector({ month, onMonthChange }: MonthSelectorProps) {
  const selectId = useId()

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={selectId} className="text-xs font-medium text-slate-500">
        Reference Month
      </label>
      <select
        id={selectId}
        value={month}
        onChange={(event) => onMonthChange(Number(event.target.value))}
        className={selectClasses}
      >
        {MONTH_LABELS.map((label, index) => (
          <option key={label} value={index + 1}>
            {label}
          </option>
        ))}
      </select>
    </div>
  )
}
