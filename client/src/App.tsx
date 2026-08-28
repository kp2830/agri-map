import { useEffect, useMemo, useState } from 'react'
import { StatusCard } from './components/StatusCard'
import { CentroidForm } from './features/fields/CentroidForm'
import { CropSummaryPanel } from './features/fields/CropSummaryPanel'
import { buildCropColorMap } from './features/fields/cropDisplay'
import { ALL_CROPS, filterFieldsByCrop, getAvailableCrops, type CropFilterValue } from './features/fields/cropFilter'
import { summarizeCropShares } from './features/fields/cropSummary'
import { featureCentroid } from './features/fields/fieldGeometry'
import { FieldDetailsPanel } from './features/fields/FieldDetailsPanel'
import { useAgriculturalFields } from './features/fields/useAgriculturalFields'
import { defaultMapCenter } from './lib/config'
import { markPerf } from './lib/perf'
import { MapView } from './features/map/MapView'
import type { CoverageInfo, NormalizedFieldFeature } from './types/agricultural'

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
    const data = await fetchFields(lat, lng)
    if (data && data.coverage.status === 'found_nearby' && data.coverage.nearestFieldCentroid) {
      setLatInput(String(data.coverage.nearestFieldCentroid.lat))
      setLngInput(String(data.coverage.nearestFieldCentroid.lng))
    }
  }

  function handleSubmit(lat: number, lng: number) {
    void analyze(lat, lng)
  }

  function handleMapClick(lat: number, lng: number) {
    markPerf('click')
    setLatInput(String(lat))
    setLngInput(String(lng))
    void analyze(lat, lng)
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
  }

  const fieldCollection = state.status === 'success' ? state.data.fieldCollection : null
  const coverage = state.status === 'success' ? state.data.coverage : null
  const isEmpty = fieldCollection !== null && fieldCollection.features.length === 0

  // Recomputing this means re-walking every field feature — memoized so it only happens
  // when the loaded data actually changes, not on every unrelated re-render (e.g. typing
  // in the lat/lng inputs, or selecting a field).
  const cropColorMap = useMemo(
    () => (fieldCollection ? buildCropColorMap(summarizeCropShares(fieldCollection)) : new Map<string, string>()),
    [fieldCollection],
  )

  // Crop options are always derived from the complete result (never the filtered view),
  // so picking "Mustard" doesn't shrink the dropdown down to just "Mustard" afterward.
  const cropOptions = useMemo(() => (fieldCollection ? getAvailableCrops(fieldCollection) : []), [fieldCollection])

  // Pure client-side filter over the already-loaded collection — no network request, no
  // new S2/ALU/AMED lookup. `fieldCollection` itself is never mutated or replaced.
  const visibleFieldCollection = useMemo(
    () => (fieldCollection ? filterFieldsByCrop(fieldCollection, selectedCrop) : null),
    [fieldCollection, selectedCrop],
  )

  function handleCropChange(crop: CropFilterValue) {
    setSelectedCrop(crop)
    setSelectedFeature(null)
  }

  return (
    <div className="flex h-screen min-h-0 flex-col bg-slate-50">
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-slate-200 bg-white px-4 py-3 shadow-sm sm:px-6">
        <div className="flex items-center gap-2.5">
          <BrandMark />
          <div>
            <h1 className="text-base font-semibold tracking-tight text-slate-900">AgriMap</h1>
            <p className="text-xs text-slate-500">Agricultural field intelligence from satellite data</p>
          </div>
        </div>

        <CentroidForm
          lat={latInput}
          lng={lngInput}
          onLatChange={setLatInput}
          onLngChange={setLngInput}
          onSubmit={handleSubmit}
          isLoading={state.status === 'loading'}
        />
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <main className="h-[52vh] min-w-0 flex-1 lg:h-full">
          <MapView
            center={submittedCenter}
            fieldCollection={fieldCollection}
            visibleFieldCollection={visibleFieldCollection}
            selectedCrop={selectedCrop}
            coverage={coverage}
            selectedFieldId={selectedFeature ? String(selectedFeature.id) : null}
            onSelectField={handleSelectField}
            onMapClick={handleMapClick}
            cropColorMap={cropColorMap}
            resetToken={mapResetToken}
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

                <section>
                  <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-sm font-semibold text-slate-900">Crop distribution</h2>
                    {cropOptions.length > 0 && (
                      <select
                        aria-label="Filter fields by crop"
                        value={selectedCrop}
                        onChange={(event) => handleCropChange(event.target.value)}
                        className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
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
                  {selectedCrop === ALL_CROPS && (
                    <p className="mb-3 text-xs text-slate-500">
                      Share of mapped field area by predicted crop · {fieldCollection.features.length} landscape features in
                      the analyzed area
                    </p>
                  )}
                  <CropSummaryPanel fieldCollection={fieldCollection} cropColorMap={cropColorMap} selectedCrop={selectedCrop} />
                </section>

                <section className="border-t border-slate-100 pt-5">
                  <h2 className="mb-3 text-sm font-semibold text-slate-900">Field details</h2>
                  <FieldDetailsPanel feature={selectedFeature} cropColorMap={cropColorMap} />
                </section>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}

export default App
