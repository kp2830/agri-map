import { useEffect, useMemo, useState } from 'react'
import { useSyncExternalStore } from 'react'
import { getSatelliteBusySnapshot, subscribeSatelliteStatus } from './lib/api'
import { StatusCard } from './components/StatusCard'
import { CentroidForm } from './features/fields/CentroidForm'
import { CropSummaryPanel } from './features/fields/CropSummaryPanel'
import { CORIANDER_MAP_COLOR_THRESHOLD_PERCENT, FENNEL_MAP_COLOR_THRESHOLD_PERCENT, SAFFLOWER_MAP_COLOR_THRESHOLD_PERCENT, buildCropColorMap, keepOnlyTopRfCropPerField, SUNFLOWER_MAP_COLOR_THRESHOLD_PERCENT } from './features/fields/cropDisplay'
import { ALL_CROPS, filterFieldsByCrop, getAvailableCrops, withAllAmedCrops, type CropFilterValue } from './features/fields/cropFilter'
import { CORIANDER_CROP_KEY, FENNEL_CROP_KEY, SAFFLOWER_CROP_KEY, SUNFLOWER_CROP_KEY, summarizeCropShares } from './features/fields/cropSummary'
import { featureCentroid } from './features/fields/fieldGeometry'
import { FieldDetailsPanel } from './features/fields/FieldDetailsPanel'
import { FieldIdSearch } from './features/fields/FieldIdSearch'
import { formatMonthName, type ViewMode } from './features/fields/cropPrediction'
import { ModeBanner } from './features/fields/ModeBanner'
import { MonthSelector } from './features/fields/MonthSelector'
import { ViewModeToggle } from './features/fields/ViewModeToggle'
import { ComparePanel } from './features/compare/ComparePanel'
import { useCropObservations } from './features/compare/useCropObservations'
import { useObservationComparison } from './features/compare/useObservationComparison'
import { captureMonthYear } from './features/compare/compareLogic'
import { activeModelOverride } from './features/compare/modelOverride'
import { useAgriculturalFields } from './features/fields/useAgriculturalFields'
import { decodeFieldId } from './lib/api'
import { defaultMapCenter } from './lib/config'
import { CORIANDER_UI_ENABLED, FENNEL_UI_ENABLED, SAFFLOWER_UI_ENABLED, SUNFLOWER_UI_ENABLED } from './lib/featureFlags'
import { markPerf } from './lib/perf'
import { MapView } from './features/map/MapView'
import { useSafflowerFieldColors } from './features/map/useSafflowerFieldColors'
import { useCorianderFieldColors } from './features/map/useCorianderFieldColors'
import { useFennelFieldColors } from './features/map/useFennelFieldColors'
import { useSunflowerFieldColors } from './features/map/useSunflowerFieldColors'
import type { CoverageInfo, CropObservation, NormalizedFieldFeature } from './types/agricultural'

function formatDistanceKm(km: number): string {
  if (km < 1) {
    return `${Math.max(Math.round(km * 1000), 1)} m`
  }
  return `${km.toFixed(1)} km`
}

function coverageStatusCard(coverage: CoverageInfo) {
  if (coverage.status === 'found_in_area') {
    return <StatusCard tone="info" title="Agricultural data found near this location." />
  }

  if (coverage.status === 'found_nearby' && coverage.nearestDistanceKm !== null) {
    return (
      <StatusCard
        tone="info"
        title={`Agricultural data found ${formatDistanceKm(coverage.nearestDistanceKm)} away.`}
        description="Showing the nearest available agricultural coverage."
      />
    )
  }

  return (
    <StatusCard
      tone="info"
      title={`No agricultural data found within ${coverage.maxSearchRadiusKm} km of this location.`}
    />
  )
}

function BrandMark() {
  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-600 text-white shadow-sm">
      <svg viewBox="0 0 24 24" fill="none" className="h-4.5 w-4.5" aria-hidden="true">
        <path d="M4 20c8 0 14-6 14-14V4h-2C8 4 4 10 4 18v2Z" fill="currentColor" />
      </svg>
    </div>
  )
}

/** Mirrors server's DEFAULT_GRID_KM/DEFAULT_MAX_SEARCH_KM (server/src/services/agricultural/areaSearch.ts). */
const DEFAULT_GRID_KM = 3
const DEFAULT_MAX_SEARCH_KM = 10

/** Experimental model crops — predictive mode only. */
/** Nothing known yet from the four crop models. */
const EMPTY_PROBABILITIES = new Map<string, number>()

const RF_CROP_KEYS = [SUNFLOWER_CROP_KEY, SAFFLOWER_CROP_KEY, CORIANDER_CROP_KEY, FENNEL_CROP_KEY]

/**
 * Shown after a map click, before any agricultural API call is made — an accidental click
 * must cost zero ALU/AMED requests. Deliberately a normal in-app panel (not window.confirm),
 * consistent with the rest of AgriMap's visual language. Clicking Analyze on the existing
 * manual lat/lng form never goes through this — the confirmation is specific to map clicks.
 */
function ConfirmAnalysisModal({
  lat,
  lng,
  onCancel,
  onConfirm,
}: {
  lat: number
  lng: number
  onCancel: () => void
  onConfirm: () => void
}) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onCancel])

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-900/40 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-analysis-title"
    >
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-5 shadow-xl">
        <h2 id="confirm-analysis-title" className="text-sm font-semibold text-slate-900">
          Analyze this location?
        </h2>
        <dl className="mt-3 space-y-1 text-sm">
          <div className="flex items-baseline justify-between">
            <dt className="text-slate-500">Latitude</dt>
            <dd className="font-medium text-slate-800">{lat.toFixed(4)}</dd>
          </div>
          <div className="flex items-baseline justify-between">
            <dt className="text-slate-500">Longitude</dt>
            <dd className="font-medium text-slate-800">{lng.toFixed(4)}</dd>
          </div>
        </dl>
        <p className="mt-3 text-xs text-slate-500">This will search agricultural field data around this location.</p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-1"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-md bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2"
          >
            Analyze
          </button>
        </div>
      </div>
    </div>
  )
}

function SummarySkeleton({ searchingLong }: { searchingLong: boolean }) {
  return (
    <div className="space-y-3.5" role="status" aria-label="Loading agricultural data">
      <p className="text-sm text-slate-500">
        {searchingLong ? 'Still searching nearby areas…' : 'Searching for agricultural coverage…'}
      </p>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="space-y-1.5">
          <div className="h-3 w-2/3 animate-pulse rounded bg-slate-200" />
          <div className="h-1.5 w-full animate-pulse rounded-full bg-slate-100" />
        </div>
      ))}
    </div>
  )
}

function App() {
  const { state, fetchFields, reset } = useAgriculturalFields()
  const [latInput, setLatInput] = useState(String(defaultMapCenter.lat))
  const [lngInput, setLngInput] = useState(String(defaultMapCenter.lng))
  const [submittedCenter, setSubmittedCenter] = useState<{ lat: number; lng: number } | null>(null)
  const [selectedFeature, setSelectedFeature] = useState<NormalizedFieldFeature | null>(null)
  const [searchingLong, setSearchingLong] = useState(false)
  const [selectedCrop, setSelectedCrop] = useState<CropFilterValue>(ALL_CROPS)
  // Bumped on "New Search" so MapView can explicitly reset its view — Leaflet's map center/zoom
  // aren't controlled by React after mount, so this can't happen just by clearing `submittedCenter`.
  const [mapResetToken, setMapResetToken] = useState(0)
  // Live dropdown selections — persist across "New Search" per the existing session-state
  // convention (only the active result/selection resets, not user preferences like these).
  const [gridKm, setGridKm] = useState(DEFAULT_GRID_KM)
  const [maxSearchKm, setMaxSearchKm] = useState(DEFAULT_MAX_SEARCH_KM)
  // The grid size actually used for the current/last search — captured at the moment analyze()
  // runs, so changing the dropdown afterward doesn't retroactively reframe an already-displayed
  // result (see task requirement: settings only apply to the *next* search).
  const [appliedGridKm, setAppliedGridKm] = useState(DEFAULT_GRID_KM)
  // Bumped every time a new search actually starts — lets MapView force a GeoJSON remount even
  // if the click happens to repeat the exact same lat/lng with different grid/max-search values.
  const [searchToken, setSearchToken] = useState(0)
  // A map click that hasn't been confirmed yet — set immediately on click, but nothing is
  // searched until the user explicitly presses Analyze in the confirmation panel. Clicking a
  // different spot while this is open simply overwrites it with the newest location; no API
  // call has happened either way.
  const [pendingClick, setPendingClick] = useState<{ lat: number; lng: number } | null>(null)
  const [fieldIdSearchStatus, setFieldIdSearchStatus] = useState<'idle' | 'searching' | 'not_found' | 'invalid'>('idle')
  // Reference month for "what crop would be growing" — 1-12, defaults to the real current
  // month so existing behavior is unchanged until the user deliberately picks a different one.
  // Deliberately NOT reset by "New Search": it's a viewing preference (like gridKm/maxSearchKm
  // above), not part of the active search result, so it persists across searches the same way.
  const [selectedMonth, setSelectedMonth] = useState<number>(new Date().getMonth() + 1)
  // Not user-selectable (only the month is, per product scope) — always the real current year.
  // predictCropOutlook always looks at selectedYear - 1 as its primary evidence, so this alone
  // is enough to fully determine "which historical year counts as last year" for any month.
  const currentYear = new Date().getFullYear()
  // 'predictive' (default) estimates what is likely to grow from earlier seasons; 'past' shows
  // only what AMED recorded for the exact month + pastYear. Past data never runs the RF models.
  const [viewMode, setViewMode] = useState<ViewMode>('predictive')
  const [pastYear, setPastYear] = useState(currentYear - 1)
  // Every downstream component already takes (selectedMonth, selectedYear) — in Past data the
  // year simply comes from the picker instead of being the real current year.
  const selectedYear = viewMode === 'past' ? pastYear : currentYear
  // Past data can't show months that haven't happened yet.
  const maxPastMonth = pastYear === currentYear ? new Date().getMonth() + 1 : 12
  const isPast = viewMode === 'past'

  // Compare: the team's logged crop observations lined up against AMED + our models. Nothing is
  // requested (no observations, no satellite checks) until Compare is opened / an observation chosen.
  const [compareOpen, setCompareOpen] = useState(false)
  const [selectedObservationId, setSelectedObservationId] = useState<string | null>(null)
  const { state: observationsState, reload: reloadObservations } = useCropObservations(compareOpen)
  const selectedObservation: CropObservation | null =
    observationsState.status === 'ready' ? (observationsState.observations.find((o) => o.id === selectedObservationId) ?? null) : null
  // Month being compared (null = the month the observation was captured) and the size of the nearby-fields area.
  const [compareMonthOverride, setCompareMonthOverride] = useState<number | null>(null)
  const [compareGridKm, setCompareGridKm] = useState(0.5)
  const comparison = useObservationComparison(compareOpen ? selectedObservation : null, compareMonthOverride, compareGridKm)
  // In Compare the map shows AMED's recorded crop for the month the observation was captured.
  const compareData = compareOpen && comparison.status === 'ready' ? comparison.data : null
  // Compare runs on the predictive module, for the picked month in the observation's capture year.
  const compareCapture = selectedObservation ? captureMonthYear(selectedObservation.capturedAt) : null
  const viewMonth = compareOpen && compareCapture ? (compareMonthOverride ?? compareCapture.month) : selectedMonth
  // The predictive model always runs as of today, whatever year the observation is from.
  const viewYear = compareOpen ? currentYear : selectedYear
  const viewKind: ViewMode = compareOpen ? 'predictive' : viewMode

  function handleSelectObservation(id: string | null) {
    setSelectedObservationId(id)
    setCompareMonthOverride(null)
    setSelectedFeature(null)
    setSelectedCrop(ALL_CROPS)
  }

  function handleToggleCompare() {
    setCompareOpen((open) => !open)
    setSelectedObservationId(null)
    setCompareMonthOverride(null)
    setSelectedCrop(ALL_CROPS)
    setSelectedFeature(null)
    setPendingClick(null)
  }

  function handleViewModeChange(mode: ViewMode) {
    setViewMode(mode)
    setSelectedFeature(null)
    if (mode === 'past') {
      setSelectedMonth((month) => Math.min(month, maxPastMonth))
      // Sunflower/Safflower/Coriander/Fennel don't exist in Past data.
      setSelectedCrop((crop) => (RF_CROP_KEYS.includes(crop) ? ALL_CROPS : crop))
    }
  }

  function handlePastYearChange(year: number) {
    setPastYear(year)
    if (year === currentYear) setSelectedMonth((month) => Math.min(month, new Date().getMonth() + 1))
  }

  useEffect(() => {
    if (state.status !== 'loading') return
    const timer = setTimeout(() => setSearchingLong(true), 4000)
    return () => clearTimeout(timer)
  }, [state.status])

  // When fallback expansion finds coverage away from the originally clicked point, reflect
  // the nearest real field's coordinates in the inputs so the user can see/reuse them. The
  // original click stays intact in `submittedCenter` — it was already used to compute this
  // distance server-side and continues to anchor the map marker and FitToData.
  async function analyze(lat: number, lng: number) {
    setSubmittedCenter({ lat, lng })
    setSelectedFeature(null)
    setSearchingLong(false)
    setSelectedCrop(ALL_CROPS)
    setAppliedGridKm(gridKm)
    setSearchToken((token) => token + 1)
    const data = await fetchFields(lat, lng, gridKm, maxSearchKm)
    if (data && data.coverage.status === 'found_nearby' && data.coverage.nearestFieldCentroid) {
      setLatInput(String(data.coverage.nearestFieldCentroid.lat))
      setLngInput(String(data.coverage.nearestFieldCentroid.lng))
    }
  }

  function handleSubmit(lat: number, lng: number) {
    setPendingClick(null)
    void analyze(lat, lng)
  }

  // A map click never searches directly — it only captures the coordinate and shows a
  // confirmation panel. Zero agricultural API requests happen until the user presses Analyze
  // there. This intentionally runs the same whether or not a search is already in progress:
  // a click during an active search still requires confirmation rather than silently starting
  // a second one, and confirming it then supersedes the old search via the existing
  // request-id/AbortController machinery in useAgriculturalFields (unchanged).
  function handleMapClick(lat: number, lng: number) {
    if (compareOpen) return
    markPerf('click')
    setLatInput(String(lat))
    setLngInput(String(lng))
    setPendingClick({ lat, lng })
  }

  function handleConfirmPendingClick() {
    if (!pendingClick) return
    const { lat, lng } = pendingClick
    setPendingClick(null)
    void analyze(lat, lng)
  }

  function handleCancelPendingClick() {
    setPendingClick(null)
  }

  // Selecting a field is purely local state — no network request. The coordinate inputs
  // immediately reflect the clicked field's actual centroid (the same vertex-averaging
  // definition the backend uses for nearestFieldCentroid), never the mouse-click position
  // inside the polygon. `submittedCenter` (the original search origin) is untouched, so the
  // fallback distance/messaging and the map's click marker keep referring to it correctly.
  function handleSelectField(feature: NormalizedFieldFeature) {
    setSelectedFeature(feature)
    const centroid = featureCentroid(feature.geometry)
    if (centroid) {
      setLatInput(String(centroid.lat))
      setLngInput(String(centroid.lng))
    }
  }

  // "Search by Field ID": a real field ID IS a standard Open Location Code, so this decodes it
  // (server-side — see lib/plusCode/index.ts) and reuses the EXACT SAME location-based search
  // fetchFields already does for a map click/Analyze — no separate field-lookup system. If the
  // decoded search actually returns a field with that exact ID, select it (pans/zooms + opens
  // the details panel via the existing selection machinery); otherwise a plain "not found".
  async function handleFieldIdSearch(fieldId: string) {
    setFieldIdSearchStatus('searching')
    const decoded = await decodeFieldId(fieldId)
    if (!decoded) {
      setFieldIdSearchStatus('invalid')
      return
    }

    setSubmittedCenter({ lat: decoded.lat, lng: decoded.lng })
    setSelectedFeature(null)
    setSearchingLong(false)
    setSelectedCrop(ALL_CROPS)
    setAppliedGridKm(gridKm)
    setSearchToken((token) => token + 1)
    setLatInput(String(decoded.lat))
    setLngInput(String(decoded.lng))

    const data = await fetchFields(decoded.lat, decoded.lng, gridKm, maxSearchKm)
    const match = data?.fieldCollection.features.find((feature) => String(feature.id).toUpperCase() === fieldId.toUpperCase())
    if (match) {
      handleSelectField(match)
      setFieldIdSearchStatus('idle')
    } else {
      setFieldIdSearchStatus('not_found')
    }
  }

  // Leaves the current result and returns to a fresh search state without a browser refresh.
  // Deliberately does not touch the basemap choice — that lives independently in MapView.
  function handleNewSearch() {
    reset()
    setSubmittedCenter(null)
    setSelectedFeature(null)
    setSelectedCrop(ALL_CROPS)
    setSearchingLong(false)
    setLatInput(String(defaultMapCenter.lat))
    setLngInput(String(defaultMapCenter.lng))
    setMapResetToken((token) => token + 1)
    setPendingClick(null)
    setFieldIdSearchStatus('idle')
  }

  const fieldCollection = compareOpen ? (compareData?.fieldCollection ?? null) : state.status === 'success' ? state.data.fieldCollection : null
  const coverage = compareOpen ? (compareData?.coverage ?? null) : state.status === 'success' ? state.data.coverage : null
  const isEmpty = fieldCollection !== null && fieldCollection.features.length === 0

  // Recomputing this means re-walking every field feature — memoized so it only happens
  // when the loaded data actually changes, not on every unrelated re-render (e.g. typing
  // in the lat/lng inputs, or selecting a field). Also recomputes when the reference month
  // changes, since a different month can shift which crop groups are largest by area.
  const cropColorMap = useMemo(
    () => (fieldCollection ? buildCropColorMap(summarizeCropShares(fieldCollection, viewMonth, viewYear, viewKind)) : new Map<string, string>()),
    [fieldCollection, viewMonth, viewYear, viewKind],
  )

  // Crop options are always derived from the complete result (never the filtered view),
  // so picking "Mustard" doesn't shrink the dropdown down to just "Mustard" afterward.
  const satelliteBusy = useSyncExternalStore(subscribeSatelliteStatus, getSatelliteBusySnapshot)
  const cropOptions = useMemo(
    () => (fieldCollection ? withAllAmedCrops(getAvailableCrops(fieldCollection, viewMonth, viewYear, viewKind)) : []),
    [fieldCollection, viewMonth, viewYear, viewKind],
  )

  // Sunflower RF v0 — checked against the FULL search result (fieldCollection), not the
  // crop-filtered visibleFieldCollection: switching the crop filter must not throw away
  // already-computed probabilities for fields outside the current filter (the crop-distribution
  // panel below needs the whole result's Sunflower data regardless of what's currently
  // rendered on the map), and must not re-trigger a fresh round of CDSE checks just because the
  // user picked a different crop to view. Fires automatically as soon as real field data
  // arrives — no click on an individual field required (see the hook's own docstring for why
  // it's keyed on fieldCollection's identity specifically). Declared before visibleFieldCollection
  // below since the "Sunflower" filter selection reads from it.
  const rawSunflowerProbabilities = useSunflowerFieldColors(isPast || compareOpen ? null : fieldCollection, submittedCenter, selectedMonth)
  // Safflower RF v0 — same reasoning as Sunflower's hook call above, checked against the full
  // result independently.
  const rawSafflowerProbabilities = useSafflowerFieldColors(isPast || compareOpen ? null : fieldCollection, submittedCenter, selectedMonth)
  // Coriander RF v0 — same reasoning again, checked against the full result independently.
  const rawCorianderProbabilities = useCorianderFieldColors(isPast || compareOpen ? null : fieldCollection, submittedCenter, selectedMonth)
  // Fennel RF v0 — same reasoning again, checked against the full result independently.
  const rawFennelProbabilities = useFennelFieldColors(isPast || compareOpen ? null : fieldCollection, submittedCenter, selectedMonth)
  // Of the four experimental crops, each field keeps only the one with the highest probability, so
  // the map, crop dropdown, distribution and filter never show more than one of them per field.
  // How a winner compares with AMED (isRfOverrideActive) is unchanged.
  const { sunflower: sunflowerProbabilities, safflower: safflowerProbabilities, coriander: corianderProbabilities, fennel: fennelProbabilities } = useMemo(
    () => keepOnlyTopRfCropPerField(rawSunflowerProbabilities, rawSafflowerProbabilities, rawCorianderProbabilities, rawFennelProbabilities),
    [rawSunflowerProbabilities, rawSafflowerProbabilities, rawCorianderProbabilities, rawFennelProbabilities],
  )
  // Compare checks our four models only for the observed field (one satellite call each), so the
  // nearby-crops list shows a model's crop for that field alone — and only when it overrides AMED.
  const compareProbabilities = useMemo(() => {
    const maps = { sunflower: EMPTY_PROBABILITIES, safflower: EMPTY_PROBABILITIES, coriander: EMPTY_PROBABILITIES, fennel: EMPTY_PROBABILITIES }
    const override = compareData ? activeModelOverride(compareData) : null
    if (compareData?.field && override) maps[override.key] = new Map([[String(compareData.field.id), override.percent]])
    return maps
  }, [compareData])

  // Whether the "Sunflower"/"Safflower" options should even appear in the crop dropdown — only
  // once at least one field in the current search has actually cleared the threshold, same
  // "don't show an option nothing matches" rule every other crop option already follows
  // (getAvailableCrops). Also gated on their own UI_ENABLED flag as an explicit, second,
  // defensive check.
  const hasSunflowerMatch = useMemo(
    () => SUNFLOWER_UI_ENABLED && [...sunflowerProbabilities.values()].some((percent) => percent > SUNFLOWER_MAP_COLOR_THRESHOLD_PERCENT),
    [sunflowerProbabilities],
  )
  const hasSafflowerMatch = useMemo(
    () => SAFFLOWER_UI_ENABLED && [...safflowerProbabilities.values()].some((percent) => percent > SAFFLOWER_MAP_COLOR_THRESHOLD_PERCENT),
    [safflowerProbabilities],
  )
  const hasCorianderMatch = useMemo(
    () => CORIANDER_UI_ENABLED && [...corianderProbabilities.values()].some((percent) => percent > CORIANDER_MAP_COLOR_THRESHOLD_PERCENT),
    [corianderProbabilities],
  )
  const hasFennelMatch = useMemo(
    () => FENNEL_UI_ENABLED && [...fennelProbabilities.values()].some((percent) => percent > FENNEL_MAP_COLOR_THRESHOLD_PERCENT),
    [fennelProbabilities],
  )

  // Pure client-side filter over the already-loaded collection — no network request, no new
  // S2/ALU/AMED lookup. `fieldCollection` itself is never mutated or replaced.
  //
  // Split into separate memos rather than one, deliberately: the ordinary AMED-crop path
  // (nonExperimentalVisible) must stay referentially stable while sunflower/safflowerProbabilities
  // keep growing in the background, or every newly-arrived RF result would force MapView's
  // GeoJSON layer to remount (thousands of polygons, for a dense search) even when the user
  // isn't even looking at that filter. Only the crop-specific memo — used exclusively while that
  // filter is actually selected — needs to react to its own probabilities Map at all.
  const nonExperimentalVisible = useMemo(
    () => (fieldCollection ? filterFieldsByCrop(fieldCollection, selectedCrop, undefined, undefined, viewMonth, viewYear, undefined, undefined, undefined, undefined, undefined, undefined, viewKind) : null),
    [fieldCollection, selectedCrop, viewMonth, viewYear, viewKind],
  )
  const sunflowerVisible = useMemo(
    () =>
      SUNFLOWER_UI_ENABLED && fieldCollection && selectedCrop === SUNFLOWER_CROP_KEY
        ? filterFieldsByCrop(fieldCollection, selectedCrop, sunflowerProbabilities)
        : null,
    [fieldCollection, selectedCrop, sunflowerProbabilities],
  )
  const safflowerVisible = useMemo(
    () =>
      SAFFLOWER_UI_ENABLED && fieldCollection && selectedCrop === SAFFLOWER_CROP_KEY
        ? filterFieldsByCrop(fieldCollection, selectedCrop, undefined, undefined, selectedMonth, selectedYear, safflowerProbabilities)
        : null,
    [fieldCollection, selectedCrop, safflowerProbabilities, selectedMonth, selectedYear],
  )
  const corianderVisible = useMemo(
    () =>
      CORIANDER_UI_ENABLED && fieldCollection && selectedCrop === CORIANDER_CROP_KEY
        ? filterFieldsByCrop(fieldCollection, selectedCrop, undefined, undefined, selectedMonth, selectedYear, undefined, undefined, corianderProbabilities)
        : null,
    [fieldCollection, selectedCrop, corianderProbabilities, selectedMonth, selectedYear],
  )
  const fennelVisible = useMemo(
    () =>
      FENNEL_UI_ENABLED && fieldCollection && selectedCrop === FENNEL_CROP_KEY
        ? filterFieldsByCrop(fieldCollection, selectedCrop, undefined, undefined, selectedMonth, selectedYear, undefined, undefined, undefined, undefined, fennelProbabilities)
        : null,
    [fieldCollection, selectedCrop, fennelProbabilities, selectedMonth, selectedYear],
  )
  const visibleFieldCollection =
    SUNFLOWER_UI_ENABLED && selectedCrop === SUNFLOWER_CROP_KEY
      ? sunflowerVisible
      : SAFFLOWER_UI_ENABLED && selectedCrop === SAFFLOWER_CROP_KEY
        ? safflowerVisible
        : CORIANDER_UI_ENABLED && selectedCrop === CORIANDER_CROP_KEY
          ? corianderVisible
          : FENNEL_UI_ENABLED && selectedCrop === FENNEL_CROP_KEY
            ? fennelVisible
            : nonExperimentalVisible

  function handleCropChange(crop: CropFilterValue) {
    setSelectedCrop(crop)
    setSelectedFeature(null)
  }

  return (
    <>
    <div className="flex h-screen min-h-0 flex-col bg-slate-50">
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-slate-200 bg-white px-4 py-3 shadow-sm sm:px-6">
        <div className="flex items-center gap-2.5">
          <BrandMark />
          <div>
            <h1 className="text-base font-semibold tracking-tight text-slate-900">AgriMap</h1>
            <p className="text-xs text-slate-500">Agricultural field intelligence from satellite data</p>
          </div>
        </div>

        {!compareOpen && (
          <>
            <ViewModeToggle mode={viewMode} onModeChange={handleViewModeChange} year={pastYear} onYearChange={handlePastYearChange} />

            <MonthSelector
              month={selectedMonth}
              onMonthChange={setSelectedMonth}
              maxMonth={isPast ? maxPastMonth : 12}
              label={isPast ? 'Month' : 'Reference Month'}
            />
          </>
        )}

        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-500">Team observations</span>
          <button
            type="button"
            aria-pressed={compareOpen}
            onClick={handleToggleCompare}
            className={`rounded-md border px-3 py-1.5 text-sm font-semibold shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${
              compareOpen ? 'border-sky-600 bg-sky-600 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            {compareOpen ? 'Exit compare' : 'Compare'}
          </button>
        </div>

        <CentroidForm
          lat={latInput}
          lng={lngInput}
          onLatChange={setLatInput}
          onLngChange={setLngInput}
          gridKm={gridKm}
          onGridKmChange={setGridKm}
          maxSearchKm={maxSearchKm}
          onMaxSearchKmChange={setMaxSearchKm}
          onSubmit={handleSubmit}
          isLoading={state.status === 'loading'}
        />

        <FieldIdSearch
          onSearch={handleFieldIdSearch}
          status={fieldIdSearchStatus}
          disabled={state.status === 'loading' || fieldIdSearchStatus === 'searching'}
        />
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <main className="relative h-[52vh] min-w-0 flex-1 lg:h-full">
          <div className="pointer-events-none absolute bottom-7 left-3 z-[500]">
            {compareOpen ? (
              <span className="rounded-full bg-sky-600 px-3 py-1 text-xs font-bold uppercase tracking-wide text-white shadow">
                Compare · team observations vs AgriMap
              </span>
            ) : (
              <ModeBanner mode={viewMode} month={selectedMonth} year={selectedYear} compact />
            )}
          </div>
          <MapView
            center={compareOpen ? (selectedObservation ? { lat: selectedObservation.lat, lng: selectedObservation.lng } : null) : submittedCenter}
            fieldCollection={fieldCollection}
            visibleFieldCollection={visibleFieldCollection}
            selectedCrop={selectedCrop}
            coverage={coverage}
            selectedFieldId={selectedFeature ? String(selectedFeature.id) : null}
            onSelectField={handleSelectField}
            onMapClick={handleMapClick}
            cropColorMap={cropColorMap}
            sunflowerProbabilities={compareOpen ? compareProbabilities.sunflower : sunflowerProbabilities}
            safflowerProbabilities={compareOpen ? compareProbabilities.safflower : safflowerProbabilities}
            corianderProbabilities={compareOpen ? compareProbabilities.coriander : corianderProbabilities}
            fennelProbabilities={compareOpen ? compareProbabilities.fennel : fennelProbabilities}
            selectedMonth={viewMonth}
            selectedYear={viewYear}
            viewMode={viewKind}
            highlightFieldId={compareOpen && compareData?.field ? String(compareData.field.id) : null}
            observations={compareOpen && observationsState.status === 'ready' ? observationsState.observations : undefined}
            selectedObservationId={selectedObservationId}
            onSelectObservation={(o) => handleSelectObservation(o.id)}
            resetToken={mapResetToken}
            gridKm={compareOpen ? compareGridKm : appliedGridKm}
            searchToken={searchToken}
          />
        </main>

        <aside
          className="sidebar-scroll flex w-full min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain border-t border-slate-200 bg-white lg:h-full lg:w-[380px] lg:flex-none lg:border-l lg:border-t-0"
          // Belt-and-suspenders isolation from the Leaflet map: the sidebar is already a
          // separate DOM sibling of the map (not a descendant), so wheel events over it
          // never reach Leaflet's scroll-zoom handler under normal event targeting — but
          // stopping propagation here guarantees it regardless of any browser/trackpad
          // quirk, without touching the map's own scroll-zoom behavior at all.
          onWheel={(event) => event.stopPropagation()}
        >
          <div className="flex-1 p-4 sm:p-5">
            {compareOpen ? (
              <ComparePanel
                observations={observationsState}
                onReload={reloadObservations}
                selectedId={selectedObservationId}
                onSelect={(o) => handleSelectObservation(o ? o.id : null)}
                comparison={comparison}
                month={viewMonth}
                onMonthChange={setCompareMonthOverride}
                gridKm={compareGridKm}
                onGridKmChange={setCompareGridKm}
                nearby={
                  compareData ? (
                    <div className="space-y-5">
                      <div>
                        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                          <h2 className="text-sm font-semibold text-slate-900">Crops in nearby fields — {formatMonthName(viewMonth)}</h2>
                          {cropOptions.length > 0 && (
                            <select
                              aria-label="Filter nearby fields by crop"
                              value={selectedCrop}
                              onChange={(event) => handleCropChange(event.target.value)}
                              className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                            >
                              <option value={ALL_CROPS}>All Crops</option>
                              {cropOptions.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          )}
                        </div>
                        <p className="mb-3 text-xs text-slate-500">
                          {compareData.hasLocalCoverage
                            ? `Predictive model · fields within ${compareGridKm} km of the observation`
                            : `No mapped fields at the observation. Showing the nearest mapped fields${compareData.coverage.nearestDistanceKm !== null ? `, ${compareData.coverage.nearestDistanceKm.toFixed(1)} km away` : ''}.`}
                        </p>
                        <CropSummaryPanel
                          fieldCollection={compareData.fieldCollection}
                          cropColorMap={cropColorMap}
                          selectedCrop={selectedCrop}
                          sunflowerProbabilities={compareProbabilities.sunflower}
                          safflowerProbabilities={compareProbabilities.safflower}
                          corianderProbabilities={compareProbabilities.coriander}
                          fennelProbabilities={compareProbabilities.fennel}
                          selectedMonth={viewMonth}
                          selectedYear={viewYear}
                          viewMode="predictive"
                        />
                      </div>
                    </div>
                  ) : null
                }
              />
            ) : (
            <>
            <div className="mb-4">
              <ModeBanner mode={viewMode} month={selectedMonth} year={selectedYear} />
            </div>

            {state.status !== 'idle' && (
              <div className="mb-4 flex items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Analysis</span>
                <button
                  type="button"
                  onClick={handleNewSearch}
                  className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-1"
                >
                  New Search
                </button>
              </div>
            )}

            {state.status === 'idle' && (
              <StatusCard
                tone="info"
                title="No data loaded yet"
                description="Click anywhere on the map, or enter coordinates above, to load real ALU/AMED agricultural data for that area."
              />
            )}

            {state.status === 'loading' && <SummarySkeleton searchingLong={searchingLong} />}

            {state.status === 'error' && (
              <StatusCard tone="error" title="Unable to load agricultural data." description="Please try again." />
            )}

            {state.status === 'success' && isEmpty && (coverage ? (
              coverageStatusCard(coverage)
            ) : (
              <StatusCard
                tone="info"
                title="No agricultural landscape data here"
                description="This location has no ALU landscape features on record."
              />
            ))}

            {state.status === 'success' && fieldCollection && !isEmpty && (
              <div className="space-y-6">
                {coverage && coverage.status === 'found_nearby' && <section>{coverageStatusCard(coverage)}</section>}

                {!isPast && satelliteBusy && (
                  <div role="alert" className="rounded-lg border-2 border-red-600 bg-red-50 p-4 text-red-900">
                    <p className="text-base font-bold">⚠ Satellite data is currently failing</p>
                    <p className="mt-1 text-sm">
                      Sunflower, Safflower, Coriander and Fennel cannot be checked right now, so they will not show on the map or
                      in the results. All other crops are unaffected. This usually clears within a few minutes — search again shortly.
                    </p>
                  </div>
                )}

                <section>
                  <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-sm font-semibold text-slate-900">
                      {isPast
                        ? `Past crop distribution (AMED record) — ${formatMonthName(selectedMonth)} ${selectedYear}`
                        : `Predicted crop distribution — ${formatMonthName(selectedMonth)}`}
                    </h2>
                    {(cropOptions.length > 0 || (!isPast && (hasSunflowerMatch || hasSafflowerMatch || hasCorianderMatch || hasFennelMatch))) && (
                      <select
                        aria-label="Filter fields by crop"
                        value={selectedCrop}
                        onChange={(event) => handleCropChange(event.target.value)}
                        className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                      >
                        <option value={ALL_CROPS}>All Crops</option>
                        {/* Pinned right after "All Crops", not sorted alphabetically among AMED
                            crops below — they're the app's core experimental signals, not
                            incidental categories, and only appear once a real field has actually
                            cleared the threshold. Only ever rendered when their own UI_ENABLED
                            flag is true (hasSunflowerMatch/hasSafflowerMatch are hard-gated on it
                            — see their own definitions above). */}
                        {!isPast && (
                          <>
                            <option value={SUNFLOWER_CROP_KEY}>Sunflower</option>
                            <option value={SAFFLOWER_CROP_KEY}>Safflower</option>
                            <option value={CORIANDER_CROP_KEY}>Coriander</option>
                            <option value={FENNEL_CROP_KEY}>Fennel</option>
                          </>
                        )}
                        {cropOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {isPast && option.value === 'NO_PREDICTION' ? 'No AMED record' : option.label}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                  {selectedCrop === ALL_CROPS && (
                    <p className="mb-3 text-xs text-slate-500">
                      {isPast ? 'Recorded by AMED satellite monitoring' : 'Based on historical crop-season patterns'} ·{' '}
                      {fieldCollection.features.length} landscape features in the analyzed area
                    </p>
                  )}
                  <CropSummaryPanel
                    fieldCollection={fieldCollection}
                    cropColorMap={cropColorMap}
                    selectedCrop={selectedCrop}
                    sunflowerProbabilities={sunflowerProbabilities}
                    safflowerProbabilities={safflowerProbabilities}
                    corianderProbabilities={corianderProbabilities}
                    fennelProbabilities={fennelProbabilities}
                    selectedMonth={selectedMonth}
                    selectedYear={selectedYear}
                    viewMode={viewMode}
                  />
                </section>

                <section className="border-t border-slate-100 pt-5">
                  <h2 className="mb-3 text-sm font-semibold text-slate-900">Field details</h2>
                  {/* Keyed by field id so selecting a different field mounts a fresh instance —
                      resetting its "History" view back to the Complete History default rather
                      than carrying forward the previously-selected field's choice. */}
                  <FieldDetailsPanel
                    key={selectedFeature ? String(selectedFeature.id) : 'none'}
                    feature={selectedFeature}
                    cropColorMap={cropColorMap}
                    selectedMonth={selectedMonth}
                    selectedYear={selectedYear}
                    viewMode={viewMode}
                  />
                </section>
              </div>
            )}
            </>
            )}
          </div>
        </aside>
      </div>
    </div>

    {pendingClick && (
      <ConfirmAnalysisModal
        lat={pendingClick.lat}
        lng={pendingClick.lng}
        onCancel={handleCancelPendingClick}
        onConfirm={handleConfirmPendingClick}
      />
    )}
    </>
  )
}

export default App
