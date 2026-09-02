import { useEffect, useId, useMemo, useState } from 'react'
import { getSunflowerLikelihood, getSunflowerRf } from '../../lib/api'
import type { NormalizedFieldFeature, SunflowerLikelihoodResponse, SunflowerRfResponse } from '../../types/agricultural'
import {
  colorForCropLabel,
  formatAluType,
  formatArea,
  formatCropLabel,
  formatPercent,
  formatTimestamp,
  getActiveCropOutcome,
  getCurrentSeasonHistory,
  getPrimaryCrop,
  isEligibleForSunflowerCheck,
} from './cropDisplay'

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

export function FieldDetailsPanel({ feature, cropColorMap }: FieldDetailsPanelProps) {
  // Hooks must run unconditionally on every render, so these come before the `!feature` early
  // return below. The parent keys this component by field id, so a newly-selected field mounts
  // a fresh instance and this always starts back at the default, "Current Season History" —
  // the user never has to re-pick it per field.
  const [historyView, setHistoryView] = useState<HistoryView>('current')
  const historyViewId = useId()
  const [sunflowerCheck, setSunflowerCheck] = useState<SunflowerCheckState>({ status: 'idle' })
  const [sunflowerRfCheck, setSunflowerRfCheck] = useState<SunflowerRfCheckState>({ status: 'idle' })

  const properties = feature?.properties ?? null
  const outcome = useMemo(() => (properties ? getActiveCropOutcome(properties) : null), [properties])
  const currentSeasonHistory = useMemo(
    () => (properties && outcome ? getCurrentSeasonHistory(properties, outcome) : []),
    [properties, outcome],
  )

  // On-demand real-time Sunflower likelihood check — fired only when this specific field's
  // current AMED result is Unknown/low-confidence (see isEligibleForSunflowerCheck), never for
  // every field in the map's viewport. A newly-selected field cancels any still-in-flight check
  // for the previously-selected one. Any failure leaves `sunflowerCheck` at 'error', which
  // renders nothing extra — the existing AMED display below is completely unaffected.
  useEffect(() => {
    setSunflowerCheck({ status: 'idle' })
    if (!feature || !properties || properties.aluType !== 'field' || !outcome) return
    if (!isEligibleForSunflowerCheck(outcome)) return

    const controller = new AbortController()
    setSunflowerCheck({ status: 'checking' })
    getSunflowerLikelihood(feature, controller.signal)
      .then((response) => setSunflowerCheck({ status: 'done', response }))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setSunflowerCheck({ status: 'error' })
      })

    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on feature identity; outcome is derived from the same properties
  }, [feature])

  // Sunflower RF v0 — a SEPARATE model/signal from the likeness check above (see
  // server/src/services/agricultural/sunflowerRf/). Same eligibility gate
  // (isEligibleForSunflowerCheck — AMED Unknown/low-confidence only), fired independently so one
  // model's latency/failure never affects the other's display. Never blocks the rest of this
  // panel: AMED's own result above renders immediately regardless of this check's state.
  useEffect(() => {
    setSunflowerRfCheck({ status: 'idle' })
    if (!feature || !properties || properties.aluType !== 'field' || !outcome) return
    if (!isEligibleForSunflowerCheck(outcome)) return

    const controller = new AbortController()
    setSunflowerRfCheck({ status: 'checking' })
    getSunflowerRf(feature, controller.signal)
      .then((response) => setSunflowerRfCheck({ status: 'done', response }))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setSunflowerRfCheck({ status: 'error' })
      })

    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on feature identity; outcome is derived from the same properties
  }, [feature])

  if (!feature || !properties || !outcome) {
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
  // choice that never touches `properties.monitoring` itself or re-derives the crop (see
  // getCurrentSeasonHistory / getSeasonalReferenceSeason in cropDisplay.ts).
  const historySeasons = historyView === 'current' ? sortedCurrentSeasonHistory : sortedSeasons

  // The single source of truth for "which season's crop to show" — reused for both the label
  // and its own sowing/harvest dates/predictions, so they can never disagree (see
  // getActiveCropOutcome for why this isn't simply "whichever season started most recently"
  // in a way that ignores AMED's reporting lag, and why a 'seasonal' inference is kept
  // distinct from a directly-observed one).
  const activeSeason = outcome.kind === 'observed' || outcome.kind === 'fallback' ? outcome.season : null
  const primaryCrop = getPrimaryCrop(properties)
  const primaryPrediction = activeSeason?.predictions[0] ?? null
  const alternativePredictions = activeSeason?.predictions.slice(1) ?? []

  // The ONLY place a Sunflower override actually changes what's displayed — everything else in
  // this component is the existing, untouched AMED rendering. `overridden: true` is only ever
  // set server-side (overridePolicy.ts) when AMED's own result was NOT high-confidence, so this
  // can never suppress a confidently-observed known crop.
  const sunflowerOverride =
    sunflowerCheck.status === 'done' && sunflowerCheck.response.override.overridden ? sunflowerCheck.response.override : null

  return (
    <div className="space-y-5">
      <div>
        <div className="mb-2 flex items-center gap-2">
          <span
            className="h-3 w-3 shrink-0 rounded-sm"
            style={{ backgroundColor: colorForCropLabel(primaryCrop, cropColorMap) }}
            aria-hidden
          />
          <h3 className="truncate font-mono text-sm font-semibold text-slate-900">{String(feature.id)}</h3>
        </div>

        <SectionHeading>Field</SectionHeading>
        <dl className="mt-1 divide-y divide-slate-50">
          <DetailRow label="Area" value={formatArea(properties.areaSqM)} />
          <DetailRow label="ALU type" value={formatAluType(properties.aluType)} />
          <DetailRow label="Classification confidence" value={formatPercent(properties.classConfidence)} />
          <DetailRow label="Imagery capture date" value={formatTimestamp(properties.captureTimestampSec)} />
        </dl>
      </div>

      {properties.aluType !== 'field' ? (
        <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-500">
          Crop monitoring only applies to field-type features.
        </p>
      ) : sunflowerOverride ? (
        <div>
          <SectionHeading>Crop</SectionHeading>
          <dl className="mt-1 divide-y divide-slate-50">
            <DetailRow label="Current crop" value={`${formatCropLabel('SUNFLOWER')} (${formatPercent(sunflowerOverride.likeness)})`} />
          </dl>
          <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Model likelihood, not verified ground truth — AMED had{' '}
            {outcome.kind === 'none' ? 'no prediction' : outcome.kind === 'seasonal' ? 'only a historical seasonal inference' : `a low-confidence (${primaryPrediction ? formatPercent(primaryPrediction.confidence) : 'unknown'}) ${formatCropLabel(primaryCrop)} prediction`}{' '}
            for this field; this field's Sentinel-2 spectral signature scored {formatPercent(sunflowerOverride.likeness)} similarity
            to known Sunflower fields ({sunflowerOverride.band} confidence band), which cleared this app's conservative
            override threshold. No real Indian Sunflower ground truth exists to validate this against.
          </p>
        </div>
      ) : outcome.kind === 'none' ? (
        <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-500">
          No crop monitoring data is available for this field.
        </p>
      ) : outcome.kind === 'seasonal' ? (
        <div>
          <SectionHeading>Crop</SectionHeading>
          <dl className="mt-1 divide-y divide-slate-50">
            <DetailRow label="Current crop" value={formatCropLabel(primaryCrop)} />
            <DetailRow label="Seasonal basis" value="Historical seasonal match" />
          </dl>
          <p className="mt-2 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-500">
            AMED has no monitoring window covering today. This crop is carried forward from this
            field's most recent historical season that covered this same time of year (
            {formatTimestamp(outcome.matchedSeason.startTimestampSec)} –{' '}
            {formatTimestamp(outcome.matchedSeason.endTimestampSec)}) — not a crop AMED is
            currently observing.
          </p>
        </div>
      ) : (
        <div>
          <SectionHeading>Crop</SectionHeading>
          <dl className="mt-1 divide-y divide-slate-50">
            <DetailRow label="Current crop" value={formatCropLabel(primaryCrop)} />
            {primaryPrediction && <DetailRow label="Crop confidence" value={formatPercent(primaryPrediction.confidence)} />}
            <DetailRow label="Sowing" value={formatTimestamp(outcome.season.startTimestampSec)} />
            <DetailRow label="Harvest" value={formatTimestamp(outcome.season.endTimestampSec)} />
          </dl>

          {alternativePredictions.length > 0 && (
            <div className="mt-3">
              <SectionHeading>Alternative predictions</SectionHeading>
              <ul className="mt-1 space-y-1">
                {alternativePredictions.map((prediction) => (
                  <li key={prediction.crop} className="flex items-baseline justify-between text-sm text-slate-600">
                    <span>{formatCropLabel(prediction.crop)}</span>
                    <span className="tabular-nums text-slate-400">{formatPercent(prediction.confidence)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {sunflowerCheck.status === 'checking' && (
        <p className="text-xs text-slate-400">Checking Sentinel-2 signature for a Sunflower likelihood…</p>
      )}

      {sunflowerRfCheck.status === 'checking' && (
        <p className="text-xs text-slate-400">Sunflower detector: analyzing satellite history…</p>
      )}
      {sunflowerRfCheck.status === 'error' && <p className="text-xs text-slate-400">Sunflower detector: unavailable</p>}
      {sunflowerRfCheck.status === 'done' && !sunflowerRfCheck.response.available && (
        <p className="text-xs text-slate-400">Sunflower detector: unavailable</p>
      )}
      {sunflowerRfCheck.status === 'done' && sunflowerRfCheck.response.available && (
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
          <SectionHeading>Historical monitoring</SectionHeading>

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
