import { useId, useState } from 'react'

interface FieldIdSearchProps {
  onSearch: (fieldId: string) => void
  status: 'idle' | 'searching' | 'not_found' | 'invalid'
  disabled: boolean
}

const inputClasses =
  'w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:border-emerald-500'

/**
 * "Search by Field ID" — a real ALU field ID is a standard Open Location Code (Plus Code), so
 * this decodes it server-side (GET /geo/plus-code/:code) and reuses the existing location-based
 * search entirely (see App.tsx's handleFieldIdSearch) rather than a separate lookup system.
 */
export function FieldIdSearch({ onSearch, status, disabled }: FieldIdSearchProps) {
  const [input, setInput] = useState('')
  const inputId = useId()
  const isValid = input.trim().length > 0

  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        if (isValid) onSearch(input.trim())
      }}
    >
      <div className="min-w-[12rem] flex-1">
        <label htmlFor={inputId} className="mb-1 block text-xs font-medium text-slate-600">
          Search by Field ID
        </label>
        <input
          id={inputId}
          type="text"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="e.g. 8J2R6Q4P+P8C3"
          className={inputClasses}
          autoCapitalize="characters"
        />
      </div>
      <button
        type="submit"
        disabled={!isValid || disabled}
        className="flex items-center gap-2 rounded-md bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-300"
      >
        {status === 'searching' && (
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden />
        )}
        {status === 'searching' ? 'Searching…' : 'Find'}
      </button>

      {status === 'not_found' && (
        <p className="basis-full text-xs text-red-600" role="alert">
          No field with that ID was found nearby. Double-check the ID and try again.
        </p>
      )}
      {status === 'invalid' && (
        <p className="basis-full text-xs text-red-600" role="alert">
          That doesn't look like a valid field ID.
        </p>
      )}
    </form>
  )
}
