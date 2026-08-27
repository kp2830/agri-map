import { useState } from 'react'
import { StatusCard } from './components/StatusCard'
import { CentroidForm } from './features/fields/CentroidForm'
import { CropSummaryPanel } from './features/fields/CropSummaryPanel'
import { buildCropColorMap } from './features/fields/cropDisplay'
import { summarizeCropShares } from './features/fields/cropSummary'
import { FieldDetailsPanel } from './features/fields/FieldDetailsPanel'
import { useAgriculturalFields } from './features/fields/useAgriculturalFields'
import { MapView } from './features/map/MapView'
import type { NormalizedFieldFeature } from './types/agricultural'

function BrandMark() {
  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-600 text-white shadow-sm">
      <svg viewBox="0 0 24 24" fill="none" className="h-4.5 w-4.5" aria-hidden="true">
        <path d="M4 20c8 0 14-6 14-14V4h-2C8 4 4 10 4 18v2Z" fill="currentColor" />
      </svg>
    </div>
  )
}

function SummarySkeleton() {
  return (
    <div className="space-y-3.5" role="status" aria-label="Loading agricultural data">
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
  const { state, fetchFields } = useAgriculturalFields()
  const [submittedCenter, setSubmittedCenter] = useState<{ lat: number; lng: number } | null>(null)
  const [selectedFeature, setSelectedFeature] = useState<NormalizedFieldFeature | null>(null)

  function handleSubmit(lat: number, lng: number) {
    setSubmittedCenter({ lat, lng })
    setSelectedFeature(null)
    void fetchFields(lat, lng)
  }

  const fieldCollection = state.status === 'success' ? state.data.fieldCollection : null
  const isEmpty = fieldCollection !== null && fieldCollection.features.length === 0
  const cropColorMap = fieldCollection ? buildCropColorMap(summarizeCropShares(fieldCollection)) : new Map<string, string>()

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

        <CentroidForm onSubmit={handleSubmit} isLoading={state.status === 'loading'} />
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <main className="h-[52vh] min-w-0 flex-1 lg:h-full">
          <MapView
            center={submittedCenter}
            fieldCollection={fieldCollection}
            selectedFieldId={selectedFeature ? String(selectedFeature.id) : null}
            onSelectField={setSelectedFeature}
            cropColorMap={cropColorMap}
          />
        </main>

        <aside className="flex w-full min-h-0 flex-1 flex-col overflow-y-auto border-t border-slate-200 bg-white lg:h-full lg:w-[380px] lg:flex-none lg:border-l lg:border-t-0">
          <div className="flex-1 p-4 sm:p-5">
            {state.status === 'idle' && (
              <StatusCard
                tone="info"
                title="No data loaded yet"
                description="Enter a centroid above and click Analyze to load real ALU/AMED agricultural data for that area."
              />
            )}

            {state.status === 'loading' && <SummarySkeleton />}

            {state.status === 'error' && <StatusCard tone="error" title="Couldn't load agricultural data" description={state.message} />}

            {state.status === 'success' && isEmpty && (
              <StatusCard
                tone="info"
                title="No agricultural landscape data here"
                description="This location has no ALU landscape features on record. Try a centroid within an agricultural region."
              />
            )}

            {state.status === 'success' && fieldCollection && !isEmpty && (
              <div className="space-y-6">
                <section>
                  <h2 className="mb-1 text-sm font-semibold text-slate-900">Crop distribution</h2>
                  <p className="mb-3 text-xs text-slate-500">
                    Share of mapped field area by predicted crop · {fieldCollection.features.length} landscape features in this
                    cell
                  </p>
                  <CropSummaryPanel fieldCollection={fieldCollection} cropColorMap={cropColorMap} />
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
