import { useEffect, useRef, type ReactNode } from 'react'
import type { CropObservation } from '../../types/agricultural'
import {
  CORIANDER_MAP_COLOR_THRESHOLD_PERCENT,
  FENNEL_MAP_COLOR_THRESHOLD_PERCENT,
  SAFFLOWER_MAP_COLOR_THRESHOLD_PERCENT,
  SUNFLOWER_MAP_COLOR_THRESHOLD_PERCENT,
  formatCropLabel,
  formatTimestamp,
  isRfOverrideActive,
} from '../fields/cropDisplay'
import { formatMonthName } from '../fields/cropPrediction'
import { MonthSelector } from '../fields/MonthSelector'
import { MODEL_SIGNALS } from '../fields/modelSignals'
import { amedCropMatches, isModelCrop, type ModelKey, type Verdict } from './compareLogic'
import type { ComparisonState, ObservationComparison } from './useObservationComparison'
import type { ObservationsState } from './useCropObservations'

const MODEL_THRESHOLDS: Record<ModelKey, number> = {
  sunflower: SUNFLOWER_MAP_COLOR_THRESHOLD_PERCENT,
  safflower: SAFFLOWER_MAP_COLOR_THRESHOLD_PERCENT,
  coriander: CORIANDER_MAP_COLOR_THRESHOLD_PERCENT,
  fennel: FENNEL_MAP_COLOR_THRESHOLD_PERCENT,
}
const MODEL_KEYS: ModelKey[] = ['sunflower', 'safflower', 'coriander', 'fennel']

const GROWTH_STAGE_LABELS: Record<string, string> = {
  sowing_seedling: 'Sowing / seedling',
  vegetative: 'Vegetative',
  flowering: 'Flowering',
  fruiting_grain: 'Fruiting / grain filling',
  harvesting_mature: 'Harvesting / mature',
}

function formatStage(stage: string | null): string {
  if (!stage) return 'Stage not recorded'
  return GROWTH_STAGE_LABELS[stage] ?? stage.replace(/_/g, ' ')
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

function formatPlace(place: CropObservation['place']): string {
  if (!place) return 'Looking up place…'
  const parts = [place.city, place.district, place.state].filter((p): p is string => !!p)
  return [...new Set(parts)].join(', ') || 'Place unknown'
}

const VERDICT_STYLE: Record<Verdict, { icon: string; chip: string }> = {
  match: { icon: '✓', chip: 'bg-emerald-100 text-emerald-700' },
  mismatch: { icon: '✗', chip: 'bg-red-100 text-red-700' },
  neutral: { icon: '–', chip: 'bg-slate-100 text-slate-500' },
}

/** The entire AMED crop history of the field at the observation's spot, newest first — . */
function FieldHistory({ data }: { data: ObservationComparison }) {
  const seasons = [...(data.field?.properties.monitoring ?? [])].sort((a, b) => b.startTimestampSec - a.startTimestampSec)

  return (
    <div>
      <h3 className="text-sm font-semibold text-slate-900">Entire crop history of this field</h3>
      {seasons.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500">AMED has no crop history for this field.</p>
      ) : (
        <ul className="mt-2 space-y-1">
          {seasons.map((season, index) => (
            <li key={index} className="flex items-baseline justify-between gap-2 px-1.5 py-1 text-sm">
              <span className="text-slate-500">
                {formatTimestamp(season.startTimestampSec)} – {formatTimestamp(season.endTimestampSec)}
              </span>
              <span className="text-right font-medium text-slate-700">{formatCropLabel(season.predictions[0]?.crop ?? null)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function ComparisonDetail({ observation, data }: { observation: CropObservation; data: ObservationComparison }) {
  const observed = observation.cropName
  const predicted = data.amedPredictive

  const crop = predicted?.crop
  const predictiveVerdict: Verdict =
    !crop || crop === 'UNKNOWN_CROP' || crop === 'NO_PREDICTION' ? 'neutral' : amedCropMatches(observed, crop) ? 'match' : 'mismatch'

  // A crop model is mentioned only once it actually predicts its crop for this field.
  const detectedModels = MODEL_KEYS.flatMap((key) => {
    const check = data[key]
    if (check.status !== 'done' || !check.response.available) return []
    const percent = check.response.probabilityPercent
    // Same rule as the main predictive module: shown only when this crop is actually our predicted crop.
    if (!isRfOverrideActive(predicted?.confidencePercent ?? null, percent, MODEL_THRESHOLDS[key])) return []
    return [{ key, info: MODEL_SIGNALS[key], percent, verdict: (isModelCrop(observed, key) ? 'match' : 'mismatch') as Verdict }]
  })

  if (!data.field) {
    return (
      <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600">
        No mapped field at this exact point
        {data.coverage.nearestDistanceKm !== null ? ` (nearest mapped fields are ${data.coverage.nearestDistanceKm.toFixed(1)} km away, shown on the map)` : ''}, so
        there is nothing to compare.
      </p>
    )
  }

  const style = VERDICT_STYLE[predictiveVerdict]
  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3">
        <p className="text-xs font-semibold text-emerald-800">
          Predictive model · {formatMonthName(data.month)}
        </p>
        <div className="mt-2 grid grid-cols-2 gap-3">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Predicted</p>
            <p className="mt-0.5 text-lg font-bold text-slate-900">{crop ? formatCropLabel(crop) : 'No prediction'}</p>
            {predicted?.confidencePercent != null && <p className="text-xs text-slate-500">{predicted.confidencePercent}%</p>}
          </div>
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Logged by team</p>
            <p className="mt-0.5 text-lg font-bold text-slate-900">{observed ?? 'Unknown'}</p>
          </div>
        </div>
        <p className={`mt-3 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${style.chip}`}>
          <span aria-hidden>{style.icon}</span>
          {predictiveVerdict === 'match' ? 'Matches' : predictiveVerdict === 'mismatch' ? 'Differs' : 'No crop to compare'}
        </p>
        {detectedModels.map((m) => (
          <p key={m.key} className={`ml-2 mt-3 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${VERDICT_STYLE[m.verdict].chip}`}>
            <span aria-hidden>{VERDICT_STYLE[m.verdict].icon}</span>
            {m.info.label} model {m.percent}%
          </p>
        ))}
      </div>

      <FieldHistory data={data} />
    </div>
  )
}

interface ComparePanelProps {
  observations: ObservationsState
  onReload: () => void
  selectedId: string | null
  onSelect: (observation: CropObservation | null) => void
  comparison: ComparisonState
  /** Month being predicted/compared (defaults to the observation's capture month). */
  month: number
  onMonthChange: (month: number) => void
  /** Side length (km) of the area of nearby fields shown around the observation. */
  gridKm: number
  onGridKmChange: (gridKm: number) => void
  /** "Crops in nearby fields" — supplied by App so it reuses the map's crop summary and filter. */
  nearby: ReactNode
}

/**
 * The Compare view: every crop the team logged in the FieldView app, newest first. Selecting one
 * pans the map to that exact spot and lines up the team's crop against what AMED recorded, what
 * the predictive model says, and what each of our four crop models finds for the same field and
 * month — so we can see how AgriMap's models hold up against real field observations.
 */
export function ComparePanel({ observations, onReload, selectedId, onSelect, comparison, month, onMonthChange, gridKm, onGridKmChange, nearby }: ComparePanelProps) {
  const selected = observations.status === 'ready' ? (observations.observations.find((o) => o.id === selectedId) ?? null) : null

  // Opening an observation (or going back) always starts at the top of the sidebar, so the result is
  // in view straight away instead of below the list.
  const topRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    topRef.current?.scrollIntoView({ block: 'start' })
  }, [selectedId])

  return (
    <div className="space-y-4" ref={topRef}>
      {!selected && (
      <div className="rounded-lg border border-sky-300 bg-sky-50 p-3">
        <p className="text-xs font-bold uppercase tracking-wide text-sky-800">Compare with team crop observations</p>
        <p className="mt-1 text-sm text-sky-900">
          Crops logged by our team in the field (FieldView app, production). Select one to see what AMED and our models say for
          that exact spot and month.
        </p>
      </div>
      )}

      {observations.status === 'loading' && <p className="text-sm text-slate-500">Loading observations…</p>}
      {observations.status === 'error' && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          Could not load crop observations.
          <button type="button" onClick={onReload} className="ml-2 font-semibold underline">
            Retry
          </button>
        </div>
      )}

      {observations.status === 'ready' && !selected && (
        <>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">
              {observations.observations.length} observation{observations.observations.length === 1 ? '' : 's'}
            </h2>
            <button type="button" onClick={onReload} className="text-xs font-medium text-sky-700 hover:text-sky-800">
              Refresh
            </button>
          </div>

          {observations.observations.length === 0 ? (
            <p className="text-sm text-slate-500">No crop observations have been logged yet.</p>
          ) : (
            <ul className="space-y-2">
              {observations.observations.map((o) => {
                const active = o.id === selectedId
                return (
                  <li key={o.id}>
                    <button
                      type="button"
                      onClick={() => onSelect(active ? null : o)}
                      aria-pressed={active}
                      className={`w-full rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${
                        active ? 'border-sky-500 bg-sky-50' : 'border-slate-200 bg-white hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-sm font-semibold text-slate-900">{o.cropName ?? 'Unknown crop'}</span>
                        <span className="shrink-0 text-xs text-slate-400">{formatDate(o.capturedAt)}</span>
                      </div>
                      <p className="mt-0.5 text-xs text-slate-600">{formatPlace(o.place)}</p>
                      <p className="mt-0.5 text-[11px] text-slate-400">
                        {o.lat.toFixed(5)}, {o.lng.toFixed(5)} · {formatStage(o.growthStage)} ·{' '}
                        {o.aiPredicted ? 'AI suggestion accepted' : 'Picked by hand'}
                      </p>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}

      {selected && (
        <section>
          <button
            type="button"
            onClick={() => onSelect(null)}
            className="mb-3 inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
          >
            <span aria-hidden>←</span> All observations
          </button>
          <div className="mb-4 rounded-lg border border-sky-200 bg-sky-50/60 p-3">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-900">{selected.cropName ?? 'Observed crop'}</h2>
              <span className="shrink-0 text-xs text-slate-500">{formatDate(selected.capturedAt)}</span>
            </div>
            <p className="mt-0.5 text-xs text-slate-600">{formatPlace(selected.place)}</p>
            <p className="mt-0.5 text-[11px] text-slate-400">
              {selected.lat.toFixed(5)}, {selected.lng.toFixed(5)} · {formatStage(selected.growthStage)} ·{' '}
              {selected.aiPredicted ? 'AI suggestion accepted' : 'Picked by hand'}
            </p>
          </div>
          <div className="mb-4 flex flex-wrap items-end gap-3">
            <MonthSelector month={month} onMonthChange={onMonthChange} label="Month" />
            <div className="flex flex-col gap-1">
              <label htmlFor="compare-grid" className="text-xs font-medium text-slate-500">
                Nearby area
              </label>
              <select
                id="compare-grid"
                value={gridKm}
                onChange={(event) => onGridKmChange(Number(event.target.value))}
                className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
              >
                {[0.5, 1, 2, 3].map((km) => (
                  <option key={km} value={km}>
                    {km} km × {km} km
                  </option>
                ))}
              </select>
            </div>
          </div>
          {comparison.status === 'loading' && <p className="text-sm text-slate-500">Finding the field at this location…</p>}
          {comparison.status === 'error' && <p className="text-sm text-red-700">Could not run the comparison: {comparison.message}</p>}
          {comparison.status === 'ready' && <ComparisonDetail observation={selected} data={comparison.data} />}
        </section>
      )}

      {selected && comparison.status === 'ready' && (
        <section className="border-t border-slate-100 pt-4">{nearby}</section>
      )}
    </div>
  )
}
