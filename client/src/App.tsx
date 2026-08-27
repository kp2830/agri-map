import { useState } from 'react'
import { CentroidForm } from './features/fields/CentroidForm'
import { CropSummaryPanel } from './features/fields/CropSummaryPanel'
import { FieldDetailsPanel } from './features/fields/FieldDetailsPanel'
import { useAgriculturalFields } from './features/fields/useAgriculturalFields'
import { MapView } from './features/map/MapView'
import type { NormalizedFieldFeature } from './types/agricultural'

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

  return (
    <div className="flex h-screen min-h-0 flex-col bg-slate-50">
      <header className="flex h-14 shrink-0 items-center gap-6 border-b border-slate-200 bg-white px-4">
        <div>
          <h1 className="text-lg font-semibold text-slate-800">AgriMap</h1>
        </div>
        <CentroidForm onSubmit={handleSubmit} isLoading={state.status === 'loading'} />
      </header>

      <div className="flex min-h-0 flex-1">
        <main className="min-w-0 flex-1">
          <MapView
            center={submittedCenter}
            fieldCollection={fieldCollection}
            selectedFieldId={selectedFeature ? String(selectedFeature.id) : null}
            onSelectField={setSelectedFeature}
          />
        </main>

        <aside className="w-96 shrink-0 overflow-y-auto border-l border-slate-200 bg-white p-4">
          {state.status === 'idle' && (
            <p className="text-sm text-slate-500">Enter a centroid and load fields to see agricultural data here.</p>
          )}

          {state.status === 'loading' && <p className="text-sm text-slate-500">Loading agricultural data…</p>}

          {state.status === 'error' && (
            <p className="text-sm text-red-600">{state.message}</p>
          )}

          {state.status === 'success' && (
            <div className="space-y-6">
              {fieldCollection && fieldCollection.features.length === 0 ? (
                <p className="text-sm text-slate-500">No agricultural landscape data available for this location.</p>
              ) : (
                <>
                  <section>
                    <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
                      Crop area breakdown
                    </h2>
                    {fieldCollection && <CropSummaryPanel fieldCollection={fieldCollection} />}
                  </section>

                  <section>
                    <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
                      Field details
                    </h2>
                    <FieldDetailsPanel feature={selectedFeature} />
                  </section>
                </>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}

export default App
