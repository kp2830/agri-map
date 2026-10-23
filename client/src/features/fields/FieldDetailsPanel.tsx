import { useEffect, useId, useMemo, useState } from 'react'
import { getCorianderRf, getFennelRf, getSafflowerRf, getSunflowerLikelihood, getSunflowerRf } from '../../lib/api'
import { CORIANDER_UI_ENABLED, FENNEL_UI_ENABLED, SAFFLOWER_UI_ENABLED, SUNFLOWER_UI_ENABLED } from '../../lib/featureFlags'
import type { CorianderRfResponse, FennelRfResponse, NormalizedFieldFeature, SafflowerRfResponse, SunflowerLikelihoodResponse, SunflowerRfResponse } from '../../types/agricultural'
import { CropOutlookCard, type CropOverride } from './CropOutlookCard'
import {
  colorForCropLabel,
  formatAluType,
  formatArea,
  formatCropLabel,
  formatPercent,
  formatTimestamp,
  getActiveCropOutcome,
  getCurrentSeasonHistory,
  isEligibleForCorianderCheck,
  isEligibleForFennelCheck,
  isEligibleForSafflowerCheck,
  isEligibleForSunflowerCheck,
  isRfOverrideActive,
  CORIANDER_LIKELY_FILL_COLOR,
  CORIANDER_MAP_COLOR_THRESHOLD_PERCENT,
  FENNEL_LIKELY_FILL_COLOR,
  FENNEL_MAP_COLOR_THRESHOLD_PERCENT,
  SAFFLOWER_LIKELY_FILL_COLOR,
  SAFFLOWER_MAP_COLOR_THRESHOLD_PERCENT,
  SUNFLOWER_LIKELY_FILL_COLOR,
  SUNFLOWER_MAP_COLOR_THRESHOLD_PERCENT,
} from './cropDisplay'
import { predictCropOutlook, type ViewMode } from './cropPrediction'
import { PastRecordCard } from './PastRecordCard'
import { ModelSignalCard } from './ModelSignalCard'

type SunflowerCheckState =
  | { status: 'idle' | 'checking' }
  | { status: 'done'; response: SunflowerLikelihoodResponse }
  | { status: 'error' }

type SunflowerRfCheckState =
  | { status: 'idle' | 'checking' }
  | { status: 'done'; response: SunflowerRfResponse }
  | { status: 'error' }

type SafflowerRfCheckState =
  | { status: 'idle' | 'checking' }
  | { status: 'done'; response: SafflowerRfResponse }
  | { status: 'error' }

type CorianderRfCheckState =
  | { status: 'idle' | 'checking' }
  | { status: 'done'; response: CorianderRfResponse }
  | { status: 'error' }

type FennelRfCheckState =
  | { status: 'idle' | 'checking' }
  | { status: 'done'; response: FennelRfResponse }
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
  /** 'past' shows AMED's recorded crop for the exact month/year and never runs the RF checks. */
  viewMode: ViewMode
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

export function FieldDetailsPanel({ feature, cropColorMap, selectedMonth, selectedYear, viewMode }: FieldDetailsPanelProps) {
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
  const [safflowerRfCheck, setSafflowerRfCheck] = useState<SafflowerRfCheckState>({ status: 'idle' })
  const [corianderRfCheck, setCorianderRfCheck] = useState<CorianderRfCheckState>({ status: 'idle' })
  const [fennelRfCheck, setFennelRfCheck] = useState<FennelRfCheckState>({ status: 'idle' })

  const properties = feature?.properties ?? null

  // The predictive Crop Outlook shown at the top of this panel — see cropPrediction.ts.
  const outlook = useMemo(
    () => (properties ? predictCropOutlook(properties, selectedMonth, selectedYear, viewMode) : null),
    [properties, selectedMonth, selectedYear, viewMode],
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
    if (viewMode === 'past') return // Past data is AMED-only: no satellite (CDSE) checks
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
  }, [feature, viewMode])

  // Sunflower RF v0 — a SEPARATE model/signal from the likeness check above (see
  // server/src/services/agricultural/sunflowerRf/). Same eligibility gate
  // (isEligibleForSunflowerCheck — AMED Unknown/low-confidence only), fired independently so one
  // model's latency/failure never affects the other's display. Never blocks the rest of this
  // panel: AMED's own result above renders immediately regardless of this check's state.
  // `selectedMonth` is now sent to the server too (see growingSeasonGate.ts) and included below
  // so switching months re-checks rather than showing a stale answer for a now-irrelevant month.
  useEffect(() => {
    setSunflowerRfCheck({ status: 'idle' })
    if (!SUNFLOWER_UI_ENABLED) return
    if (viewMode === 'past') return // Past data is AMED-only: no satellite (CDSE) checks
    if (!feature || !properties || properties.aluType !== 'field' || !realOutcome) return
    if (!isEligibleForSunflowerCheck(realOutcome)) return

    const controller = new AbortController()
    setSunflowerRfCheck({ status: 'checking' })
    getSunflowerRf(feature, selectedMonth, controller.signal)
      .then((response) => setSunflowerRfCheck({ status: 'done', response }))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setSunflowerRfCheck({ status: 'error' })
      })

    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on feature identity + selectedMonth; realOutcome is derived from the same properties, deliberately real-time
  }, [feature, selectedMonth, viewMode])

  // Safflower RF v0 — same shape and same real gating (month-in-season + AMED
  // confidence/Mustard-conflict, see safflowerRf/service.ts) as Sunflower RF above, an
  // independent signal fired in parallel.
  useEffect(() => {
    setSafflowerRfCheck({ status: 'idle' })
    if (!SAFFLOWER_UI_ENABLED) return
    if (viewMode === 'past') return // Past data is AMED-only: no satellite (CDSE) checks
    if (!feature || !properties || properties.aluType !== 'field' || !realOutcome) return
    if (!isEligibleForSafflowerCheck(realOutcome)) return

    const controller = new AbortController()
    setSafflowerRfCheck({ status: 'checking' })
    getSafflowerRf(feature, selectedMonth, controller.signal)
      .then((response) => setSafflowerRfCheck({ status: 'done', response }))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setSafflowerRfCheck({ status: 'error' })
      })

    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on feature identity + selectedMonth; realOutcome is derived from the same properties, deliberately real-time
  }, [feature, selectedMonth, viewMode])

  // Coriander RF v0 — same shape and same real gating (month-in-season + AMED confidence/
  // Mustard-Wheat-Gram confusion-crop, see corianderRf/service.ts) as Safflower RF above, an
  // independent signal fired in parallel.
  useEffect(() => {
    setCorianderRfCheck({ status: 'idle' })
    if (!CORIANDER_UI_ENABLED) return
    if (viewMode === 'past') return // Past data is AMED-only: no satellite (CDSE) checks
    if (!feature || !properties || properties.aluType !== 'field' || !realOutcome) return
    if (!isEligibleForCorianderCheck(realOutcome)) return

    const controller = new AbortController()
    setCorianderRfCheck({ status: 'checking' })
    getCorianderRf(feature, selectedMonth, controller.signal)
      .then((response) => setCorianderRfCheck({ status: 'done', response }))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setCorianderRfCheck({ status: 'error' })
      })

    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on feature identity + selectedMonth; realOutcome is derived from the same properties, deliberately real-time
  }, [feature, selectedMonth, viewMode])

  // Fennel RF v0 — same shape and same real gating (month-in-season + AMED confidence/
  // Mustard-Wheat-Gram confusion-crop, see fennelRf/service.ts) as Coriander RF above, an
  // independent signal fired in parallel.
  useEffect(() => {
    setFennelRfCheck({ status: 'idle' })
    if (!FENNEL_UI_ENABLED) return
    if (viewMode === 'past') return // Past data is AMED-only: no satellite (CDSE) checks
    if (!feature || !properties || properties.aluType !== 'field' || !realOutcome) return
    if (!isEligibleForFennelCheck(realOutcome)) return

    const controller = new AbortController()
    setFennelRfCheck({ status: 'checking' })
    getFennelRf(feature, selectedMonth, controller.signal)
      .then((response) => setFennelRfCheck({ status: 'done', response }))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setFennelRfCheck({ status: 'error' })
      })

    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on feature identity + selectedMonth; realOutcome is derived from the same properties, deliberately real-time
  }, [feature, selectedMonth, viewMode])


  // Whether a Sunflower/Safflower/Coriander/Fennel RF result is strong enough to override the "Predicted Crop"
  // banner above AMED's own answer — the SAME isRfOverrideActive predicate MapView.tsx's
  // featureStyle uses for the map's fill color, so this panel and the map can never disagree
  // about which fields are "override-active." When both RF models qualify at once, whichever
  // has the higher probability wins (not a fixed Sunflower-vs-Safflower priority).
  const cropOverride = useMemo((): CropOverride | null => {
    const amedConfidencePercent = outlook?.confidencePercent ?? null
    const sunflowerProbability =
      sunflowerRfCheck.status === 'done' && sunflowerRfCheck.response.available ? sunflowerRfCheck.response.probabilityPercent : null
    const safflowerProbability =
      safflowerRfCheck.status === 'done' && safflowerRfCheck.response.available ? safflowerRfCheck.response.probabilityPercent : null

    const corianderProbability =
      corianderRfCheck.status === 'done' && corianderRfCheck.response.available ? corianderRfCheck.response.probabilityPercent : null

    const fennelProbability =
      fennelRfCheck.status === 'done' && fennelRfCheck.response.available ? fennelRfCheck.response.probabilityPercent : null

    const sunflowerActive = isRfOverrideActive(amedConfidencePercent, sunflowerProbability, SUNFLOWER_MAP_COLOR_THRESHOLD_PERCENT)
    const safflowerActive = isRfOverrideActive(amedConfidencePercent, safflowerProbability, SAFFLOWER_MAP_COLOR_THRESHOLD_PERCENT)
    const corianderActive = isRfOverrideActive(amedConfidencePercent, corianderProbability, CORIANDER_MAP_COLOR_THRESHOLD_PERCENT)
    const fennelActive = isRfOverrideActive(amedConfidencePercent, fennelProbability, FENNEL_MAP_COLOR_THRESHOLD_PERCENT)
    if (!sunflowerActive && !safflowerActive && !corianderActive && !fennelActive) return null

    // Whichever qualifying model has the highest probability wins.
    const candidates: CropOverride[] = []
    if (sunflowerActive) candidates.push({ label: 'Sunflower', probabilityPercent: sunflowerProbability as number, fillColor: SUNFLOWER_LIKELY_FILL_COLOR })
    if (safflowerActive) candidates.push({ label: 'Safflower', probabilityPercent: safflowerProbability as number, fillColor: SAFFLOWER_LIKELY_FILL_COLOR })
    if (corianderActive) candidates.push({ label: 'Coriander', probabilityPercent: corianderProbability as number, fillColor: CORIANDER_LIKELY_FILL_COLOR })
    if (fennelActive) candidates.push({ label: 'Fennel', probabilityPercent: fennelProbability as number, fillColor: FENNEL_LIKELY_FILL_COLOR })
    return candidates.reduce((best, c) => (c.probabilityPercent > best.probabilityPercent ? c : best))
  }, [outlook, sunflowerRfCheck, safflowerRfCheck, corianderRfCheck, fennelRfCheck])

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
            style={{ backgroundColor: cropOverride ? cropOverride.fillColor : colorForCropLabel(outlook?.crop ?? null, cropColorMap) }}
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
        outlook &&
        (viewMode === 'past' ? (
          <PastRecordCard outlook={outlook} cropColorSwatch={colorForCropLabel(outlook.crop, cropColorMap)} />
        ) : (
          <CropOutlookCard outlook={outlook} cropColorSwatch={colorForCropLabel(outlook.crop, cropColorMap)} override={cropOverride} />
        ))
      )}

      {SUNFLOWER_UI_ENABLED && sunflowerCheck.status === 'checking' && (
        <p className="text-xs text-slate-400">Checking Sentinel-2 signature for a Sunflower likelihood…</p>
      )}

      {/* A crop model's percentage is shown only when that crop is actually our predicted crop here — the same
          isRfOverrideActive rule the map and the headline above use. Below-threshold results, models that were
          not run, and unavailable ones are not shown at all. */}
      {cropOverride && (
        <ModelSignalCard
          signal={cropOverride.label.toLowerCase() as 'sunflower' | 'safflower' | 'coriander' | 'fennel'}
          percent={cropOverride.probabilityPercent}
        />
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
