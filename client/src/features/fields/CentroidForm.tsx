import { useState } from 'react'
import { defaultMapCenter } from '../../lib/config'

interface CentroidFormProps {
  onSubmit: (lat: number, lng: number) => void
  isLoading: boolean
}

export function CentroidForm({ onSubmit, isLoading }: CentroidFormProps) {
  const [lat, setLat] = useState(String(defaultMapCenter.lat))
  const [lng, setLng] = useState(String(defaultMapCenter.lng))

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

  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        if (isValid) onSubmit(parsedLat, parsedLng)
      }}
    >
      <label className="flex items-center gap-1 text-sm text-slate-600">
        Lat
        <input
          type="number"
          step="any"
          value={lat}
          onChange={(event) => setLat(event.target.value)}
          className="w-28 rounded border border-slate-300 px-2 py-1 text-sm"
        />
      </label>
      <label className="flex items-center gap-1 text-sm text-slate-600">
        Lng
        <input
          type="number"
          step="any"
          value={lng}
          onChange={(event) => setLng(event.target.value)}
          className="w-28 rounded border border-slate-300 px-2 py-1 text-sm"
        />
      </label>
      <button
        type="submit"
        disabled={!isValid || isLoading}
        className="rounded bg-emerald-600 px-3 py-1 text-sm font-medium text-white disabled:opacity-50"
      >
        {isLoading ? 'Loading…' : 'Load fields'}
      </button>
    </form>
  )
}
