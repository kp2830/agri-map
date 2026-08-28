import { useId } from 'react'

interface CentroidFormProps {
  lat: string
  lng: string
  onLatChange: (value: string) => void
  onLngChange: (value: string) => void
  onSubmit: (lat: number, lng: number) => void
  isLoading: boolean
}

const inputClasses =
  'w-24 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:border-emerald-500'

export function CentroidForm({ lat, lng, onLatChange, onLngChange, onSubmit, isLoading }: CentroidFormProps) {
  const latId = useId()
  const lngId = useId()

  const parsedLat = Number(lat)
  const parsedLng = Number(lng)
  const isValid =
    lat.trim() !== '' &&
    lng.trim() !== '' &&
    !Number.isNaN(parsedLat) &&
    !Number.isNaN(parsedLng) &&
    parsedLat >= -90 &&
    parsedLat <= 90 &&
    parsedLng >= -180 &&
    parsedLng <= 180
  const showRangeError = (lat.trim() !== '' || lng.trim() !== '') && !isValid

  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        if (isValid) onSubmit(parsedLat, parsedLng)
      }}
    >
      <div className="flex flex-col gap-1">
        <label htmlFor={latId} className="text-xs font-medium text-slate-500">
          Latitude
        </label>
        <input
          id={latId}
          type="number"
          step="any"
          inputMode="decimal"
          min={-90}
          max={90}
          placeholder="e.g. 18.624"
          value={lat}
          onChange={(event) => onLatChange(event.target.value)}
          className={inputClasses}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={lngId} className="text-xs font-medium text-slate-500">
          Longitude
        </label>
        <input
          id={lngId}
          type="number"
          step="any"
          inputMode="decimal"
          min={-180}
          max={180}
          placeholder="e.g. 73.076"
          value={lng}
          onChange={(event) => onLngChange(event.target.value)}
          className={inputClasses}
        />
      </div>

      <button
        type="submit"
        disabled={!isValid || isLoading}
        className="flex items-center gap-2 rounded-md bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-300"
      >
        {isLoading && (
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden />
        )}
        {isLoading ? 'Analyzing…' : 'Analyze'}
      </button>

      {showRangeError && (
        <p className="basis-full text-xs text-red-600" role="alert">
          Please enter valid latitude and longitude. Latitude must be between -90 and 90, longitude between -180 and 180.
        </p>
      )}
    </form>
  )
}
