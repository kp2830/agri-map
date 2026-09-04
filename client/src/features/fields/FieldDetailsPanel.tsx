import { useEffect, useId, useMemo, useState } from 'react'
import { getSunflowerLikelihood, getSunflowerRf } from '../../lib/api'
import { SUNFLOWER_UI_ENABLED } from '../../lib/featureFlags'
import type { NormalizedFieldFeature, SunflowerLikelihoodResponse, SunflowerRfResponse } from '../../types/agricultural'
import { CropOutlookCard } from './CropOutlookCard'
import {
  colorForCropLabel,
  formatAluType,
  formatArea,
  formatCropLabel,
  formatPercent,
  formatTimestamp,
  getActiveCropOutcome,
  getCurrentSeasonHistory,
  isEligibleForSunflowerCheck,
} from './cropDisplay'
import { predictCropOutlook } from './cropPrediction'

type SunflowerCheckState =
  | { status: 'idle' | 'checking' }
  | { status: 'done'; response: SunflowerLikelihoodResponse }
  | { status: 'error' }

type SunflowerRfCheckState =
  | { status: 'idle' | 'checking' }
  | { status: 'done'; response: SunflowerRfResponse }
  | { status: 'error' }

interface FieldDetailsPanelProps {
  feature: NormalizedFieldFeature | null
  cropColorMap: Map<string, string>
  /** The reference month (1-12) and year for the Crop Outlook prediction — see
   *  cropPrediction.ts's predictCropOutlook, which primarily uses the corresponding month one
   *  year earlier as its evidence. Never affects the Sunflower eligibility checks below, which
   *  stay anchored to the real current AMED state regardless of which month is being viewed. */
  selectedMonth: number
  selectedYear: number
}

type HistoryView = 'current' | 'complete'

const historySelectClasses =
  'rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500'

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 text-sm">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right font-medium text-slate-800">{value}</dd>
    </div>
  )
}

function SectionHeading({ children }: { children: string }) {
  return <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{children}</h4>
}

export function FieldDetailsPanel({ feature, cropColorMap, selectedMonth, selectedYear }: FieldDetailsPanelProps) {
  // Hooks must run unconditionally on every render, so these come before the `!feature` early
  // return below. The parent keys this component by field id, so a newly-selected field mounts
  // a fresh instance and this always starts back at the default, Complete History — the user
  // never has to re-pick it per field. Complete History is the default (not Current Season
  // History) because a field's full record is more informative at a glance; Current Season
  // History remains one dropdown selection away for whoever specifically wants just the
  // records that explain the currently-shown crop.
  const [historyView, setHistoryView] = useState<HistoryView>('complete')
  const historyViewId = useId()
  const [sunflowerCheck, setSunflowerCheck] = useState<SunflowerCheckState>({ status: 'idle' })
  const [sunflowerRfCheck, setSunflowerRfCheck] = useState<SunflowerRfCheckState>({ status: 'idle' })

  const properties = feature?.properties ?? null

  // The predictive Crop Outlook shown at the top of this panel — see cropPrediction.ts.
  const outlook = useMemo(
    () => (properties ? predictCropOutlook(properties, selectedMonth, selectedYear) : null),
    [properties, selectedMonth, selectedYear],
  )
  const currentSeasonHistory = useMemo(
    () => (properties ? getCurrentSeasonHistory(properties, outlook?.matchedSeason ?? null) : []),
    [properties, outlook],
  )

  // Sunflower eligibility is deliberately always real "now", regardless of the selected
  // month/year above — it's about whether THIS field's real, current AMED confidence is strong
  // enough to skip a CDSE spend, not about a hypothetical "what would month X look like" view.
  const realOutcome = useMemo(() => (properties ? getActiveCropOutcome(properties) : null), [properties])

  // On-demand real-time Sunflower likelihood check — fired only when this specific field's
  // current AMED result is Unknown/low-confidence (see isEligibleForSunflowerCheck), never for
  // every field in the map's viewport. A newly-selected field cancels any still-in-flight check
  // for the previously-selected one. Any failure leaves `sunflowerCheck` at 'error', which
  // renders nothing extra — the existing AMED display below is completely unaffected.
  //
  // Sunflower is temporarily hidden from the frontend (see lib/featureFlags.ts): while the flag
  // is off, this effect never fires, so no CDSE credits are spent checking a signal nobody can
  // currently see. Fully intact and ready to resume the instant the flag flips back to true.
  useEffect(() => {
    setSunflowerCheck({ status: 'idle' })
    if (!SUNFLOWER_UI_ENABLED) return
    if (!feature || !properties || properties.aluType !== 'field' || !realOutcome) return
    if (!isEligibleForSunflowerCheck(realOutcome)) return

    const controller = new AbortController()
    setSunflowerCheck({ status: 'checking' })
    getSunflowerLikelihood(feature, controller.signal)
      .then((response) => setSunflowerCheck({ status: 'done', response }))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setSunflowerCheck({ status: 'error' })
      })

    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on feature identity; realOutcome is derived from the same properties, deliberately real-time
  }, [feature])

  // Sunflower RF v0 — a SEPARATE model/signal from the likeness check above (see
  // server/src/services/agricultural/sunflowerRf/). Same eligibility gate
  // (isEligibleForSunflowerCheck — AMED Unknown/low-confidence only), fired independently so one
  // model's latency/failure never affects the other's display. Never blocks the rest of this
  // panel: AMED's own result above renders immediately regardless of this check's state.
  useEffect(() => {
    setSunflowerRfCheck({ status: 'idle' })
    if (!SUNFLOWER_UI_ENABLED) return
    if (!feature || !properties || properties.aluType !== 'field' || !realOutcome) return
    if (!isEligibleForSunflowerCheck(realOutcome)) return

    const controller = new AbortController()
    setSunflowerRfCheck({ status: 'checking' })
    getSunflowerRf(feature, controller.signal)
      .then((response) => setSunflowerRfCheck({ status: 'done', response }))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setSunflowerRfCheck({ status: 'error' })
      })

    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on feature identity; realOutcome is derived from the same properties, deliberately real-time
  }, [feature])

  if (!feature || !properties) {
    return (
      <p className="text-sm text-slate-500">
        Click a field on the map to inspect its ALU classification and, where available, its AMED crop prediction.
      </p>
    )
  }

  const seasons = properties.monitoring ?? []
  const sortedSeasons = [...seasons].sort((a, b) => b.startTimestampSec - a.startTimestampSec)
  const sortedCurrentSeasonHistory = [...currentSeasonHistory].sort((a, b) => b.startTimestampSec - a.startTimestampSec)

  // Which records the "History" dropdown below actually renders — a local, presentation-only
  // choice that never touches `properties.monitoring` itself or re-derives the crop.
  const historySeasons = historyView === 'current' ? sortedCurrentSeasonHistory : sortedSeasons

  return (
    <div className="space-y-5">
      <div>
        <div className="mb-2 flex items-center gap-2">
          <span
            className="h-3 w-3 shrink-0 rounded-sm"
            style={{ backgroundColor: colorForCropLabel(outlook?.crop ?? null, cropColorMap) }}
            aria-hidden
          />
          <h3 className="truncate font-mono text-sm font-semibold text-slate-900">{String(feature.id)}</h3>
        </div>

        <SectionHeading>Field</SectionHeading>
        <dl className="mt-1 divide-y divide-slate-50">
          <DetailRow label="Area" value={formatArea(properties.areaSqM)} />
          <DetailRow label="ALU type" value={formatAluType(properties.aluType)} />
          {/* Named "ALU Field Confidence", not "crop confidence" — this is ALU's confidence that
              the polygon is correctly classified as a field/trees/pond/etc., a completely
              different concept from Predicted Crop Confidence below (which is about what's
              growing in it), and must never be confused with it. */}
          <DetailRow label="ALU Field Confidence" value={formatPercent(properties.classConfidence)} />
          <DetailRow label="Imagery capture date" value={formatTimestamp(properties.captureTimestampSec)} />
        </dl>
      </div>

      {properties.aluType !== 'field' ? (
        <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-500">
          Crop monitoring only applies to field-type features.
        </p>
      ) : (
        outlook && <CropOutlookCard outlook={outlook} cropColorSwatch={colorForCropLabel(outlook.crop, cropColorMap)} />
      )}

      {SUNFLOWER_UI_ENABLED && sunflowerCheck.status === 'checking' && (
        <p className="text-xs text-slate-400">Checking Sentinel-2 signature for a Sunflower likelihood…</p>
      )}

      {SUNFLOWER_UI_ENABLED && sunflowerRfCheck.status === 'checking' && (
        <p className="text-xs text-slate-400">Sunflower detector: analyzing satellite history…</p>
      )}
      {SUNFLOWER_UI_ENABLED && sunflowerRfCheck.status === 'error' && <p className="text-xs text-slate-400">Sunflower detector: unavailable</p>}
      {SUNFLOWER_UI_ENABLED && sunflowerRfCheck.status === 'done' && !sunflowerRfCheck.response.available && (
        <p className="text-xs text-slate-400">Sunflower detector: unavailable</p>
      )}
      {SUNFLOWER_UI_ENABLED && sunflowerRfCheck.status === 'done' && sunflowerRfCheck.response.available && (
        <div className="rounded-md bg-amber-50 px-3 py-2">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="text-amber-800">Sunflower likelihood</span>
            <span className="font-semibold tabular-nums text-amber-900">{sunflowerRfCheck.response.probabilityPercent}%</span>
          </div>
          <p className="mt-1 text-xs text-amber-700">
            Experimental v0 model score — not confirmed Sunflower, not a validated statistical accuracy. Trained on
            weak labels derived from a temporal satellite heuristic; AMED's own result above is unchanged.
          </p>
        </div>
      )}

      {sortedSeasons.length > 0 && (
        <div>
          <SectionHeading>Crop History</SectionHeading>

          <div className="mt-2 flex items-center justify-between gap-2">
            <label htmlFor={historyViewId} className="text-xs font-medium text-slate-500">
              History
            </label>
            <select
              id={historyViewId}
              value={historyView}
              onChange={(event) => setHistoryView(event.target.value as HistoryView)}
              className={historySelectClasses}
            >
              <option value="current">Current Season History</option>
              <option value="complete">Complete History</option>
            </select>
          </div>

          <ul className="mt-2 space-y-2">
            {historySeasons.map((season, index) => (
              <li key={index} className="flex items-baseline justify-between gap-2 text-sm">
                <span className="text-slate-500">
                  {formatTimestamp(season.startTimestampSec)} – {formatTimestamp(season.endTimestampSec)}
                </span>
                <span className="font-medium text-slate-700">{formatCropLabel(season.predictions[0]?.crop ?? null)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
