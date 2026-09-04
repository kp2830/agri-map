import L from 'leaflet'
import type { LeafletMouseEvent, Layer, StyleFunction } from 'leaflet'
import { useEffect, useRef, useState } from 'react'
import { Circle, CircleMarker, GeoJSON, MapContainer, TileLayer, Tooltip, useMap, useMapEvents, ZoomControl } from 'react-leaflet'
import { colorForFeatureWithSunflower, SUNFLOWER_LIKELY_STROKE_COLOR, SUNFLOWER_MAP_COLOR_THRESHOLD_PERCENT } from '../fields/cropDisplay'
import type { CropFilterValue } from '../fields/cropFilter'
import { SUNFLOWER_CROP_KEY } from '../fields/cropSummary'
import { defaultMapCenter, defaultMapZoom } from '../../lib/config'
import { logPerfDelta, markPerf } from '../../lib/perf'
import type { CoverageInfo, NormalizedFieldCollection, NormalizedFieldFeature } from '../../types/agricultural'

interface MapViewProps {
  center: { lat: number; lng: number } | null
  /** Full geographic search result — always used to fit/frame the map, regardless of crop filter. */
  fieldCollection: NormalizedFieldCollection | null
  /** The subset actually rendered as polygons — equal to fieldCollection when no crop filter is applied. */
  visibleFieldCollection: NormalizedFieldCollection | null
  selectedCrop: CropFilterValue
  coverage: CoverageInfo | null
  selectedFieldId: string | null
  onSelectField: (feature: NormalizedFieldFeature) => void
  onMapClick: (lat: number, lng: number) => void
  cropColorMap: Map<string, string>
  /** Real per-field Sunflower RF probabilities (0-100), lifted to App.tsx so this map and the
   *  crop-distribution panel read the exact same data — see useSunflowerFieldColors. */
  sunflowerProbabilities: Map<string, number>
  /** Reference timestamp driving each field's displayed AMED color — real current time by
   *  default, or a different month's reference date when the header's month selector picks one
   *  (see monthToReferenceDateSec). Never affects Sunflower's own gold coloring, which is driven
   *  purely by sunflowerProbabilities regardless of this value. */
  nowSec: number
  /** Bumped by App's "New Search" action to explicitly return the map to its default view. */
  resetToken: number
  /**
   * The field-coverage grid side length (km) actually used for the current search — the
   * user-selected value captured at the moment Analyze/map-click ran, not the live dropdown
   * state (which may have changed since without re-searching). Drives the geographic context
   * kept visible around a directly-analyzed point; mirrors the backend's `gridKm`.
   */
  gridKm: number
  /**
   * Bumped by App every time a new search actually starts (map click or Analyze). Used to
   * force the GeoJSON layer to remount on a fresh result even if the click happened to land
   * on the exact same lat/lng as a previous search with different grid/max-search settings —
   * center/selectedCrop alone can't distinguish that case, since the coordinates would be
   * identical while the returned data differs.
   */
  searchToken: number
}

const KM_PER_DEGREE_LAT = 111.32

/** Approximate lat/lng bounding box of the given side length (km), centered on a point — same
 *  proper geographic-offset formula the backend uses to build its search square (longitude
 *  degrees shrink toward the poles, so the offset is corrected by cos(latitude)). */
function boundsAroundPoint(lat: number, lng: number, sideKm: number): L.LatLngBounds {
  const halfKm = sideKm / 2
  const dLat = halfKm / KM_PER_DEGREE_LAT
  const cosLat = Math.max(Math.cos((lat * Math.PI) / 180), 0.01)
  const dLng = halfKm / (KM_PER_DEGREE_LAT * cosLat)
  return L.latLngBounds([lat - dLat, lng - dLng], [lat + dLat, lng + dLng])
}

function FitToData({
  center,
  fieldCollection,
  anchorToCenter,
  gridKm,
}: {
  center: { lat: number; lng: number }
  fieldCollection: NormalizedFieldCollection | null
  /**
   * True for a direct hit (fields found in the analyzed area) or a genuine not-found result:
   * frame the fixed `gridKm` x `gridKm` analyzed area around the click, regardless of how
   * tightly the actual returned fields cluster inside it — this keeps geographic context
   * visible instead of zooming in on just the polygons (or, when nothing was found, just the
   * empty point).
   *
   * False for fallback coverage found several km away: fit tightly to the actual returned
   * field bounds instead, without forcing the (potentially km-away, empty) click point into
   * view — preserves the existing fallback visualization, which already avoids implying the
   * clicked location itself contained those fields.
   */
  anchorToCenter: boolean
  /** The grid side length (km) actually used for this search — see MapViewProps.gridKm. */
  gridKm: number
}) {
  const map = useMap()

  useEffect(() => {
    if (anchorToCenter) {
      map.fitBounds(boundsAroundPoint(center.lat, center.lng, gridKm), { padding: [16, 16] })
      return
    }

    if (fieldCollection && fieldCollection.features.length > 0) {
      const fieldBounds = L.geoJSON(fieldCollection).getBounds()
      if (fieldBounds.isValid()) {
        map.fitBounds(fieldBounds, { padding: [48, 48], maxZoom: 17 })
        return
      }
    }
    map.setView([center.lat, center.lng], 15)
  }, [center.lat, center.lng, fieldCollection, anchorToCenter, gridKm, map])

  return null
}

/** Explicitly returns the map to its default view when App's "New Search" action fires — Leaflet's
 *  MapContainer center/zoom props are uncontrolled after mount, so this can't happen implicitly. */
function ResetToDefaultView({ resetToken }: { resetToken: number }) {
  const map = useMap()
  const isFirstRender = useRef(true)

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    map.setView([defaultMapCenter.lat, defaultMapCenter.lng], defaultMapZoom)
  }, [resetToken, map])

  return null
}

/**
 * Leaflet allows continuous horizontal panning across repeated world copies, so a
 * click on one of those copies can report a longitude outside [-180, 180] (e.g. 200
 * instead of -160). Wrap it back into range so every click yields a coordinate the
 * backend will accept — this is plain coordinate normalization, not S2 logic.
 */
function normalizeLng(lng: number): number {
  return ((((lng + 180) % 360) + 360) % 360) - 180
}

function ClickHandler({ onMapClick }: { onMapClick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(event: LeafletMouseEvent) {
      onMapClick(event.latlng.lat, normalizeLng(event.latlng.lng))
    },
  })
  return null
}

type Basemap = 'street' | 'satellite'

export function MapView({
  center,
  fieldCollection,
  visibleFieldCollection,
  selectedCrop,
  coverage,
  selectedFieldId,
  onSelectField,
  onMapClick,
  cropColorMap,
  sunflowerProbabilities,
  nowSec,
  resetToken,
  gridKm,
  searchToken,
}: MapViewProps) {
  // Basemap choice lives here, independent of all agricultural search/crop-filter state in
  // App — switching it never touches fieldCollection, coverage, or the selected feature, and
  // it survives a "New Search" reset since MapView itself isn't unmounted by that action.
  const [basemap, setBasemap] = useState<Basemap>('street')

  const isNearbyCoverage = coverage?.status === 'found_nearby'

  // The GeoJSON layer only needs to be torn down and rebuilt (thousands of Leaflet path
  // layers, for a large result) when the underlying *data* changes — a new search result or
  // a crop-filter change. Selecting/deselecting a field is a per-layer style tweak, applied
  // imperatively below via layersByIdRef, so it's deliberately excluded from this key: doing
  // otherwise would recreate the entire polygon set on every single field click. `searchToken`
  // (not just center/lat-lng) is included so a repeat click on the same coordinate with
  // different grid/max-search settings — same lat/lng, different actual result — still forces
  // a remount instead of silently keeping the previous search's stale polygons on screen.
  //
  // The Sunflower filter is a special case: react-leaflet's GeoJSON never reacts to a changed
  // `data` prop on an already-mounted layer (confirmed directly in its source — its update
  // callback only ever looks at `style`), so a field newly crossing the >50% threshold while
  // this filter is active would never actually get ADDED to the rendered set without an
  // explicit remount. `qualifyingSunflowerCount` (not the raw, ever-growing probabilities Map)
  // drives that remount, and only while this filter is selected — every other crop filter's key
  // is completely unaffected by Sunflower RF results still arriving in the background, so
  // switching crops or watching results trickle in never triggers a wasted remount of a
  // potentially thousands-of-polygons layer.
  const qualifyingSunflowerCount =
    selectedCrop === SUNFLOWER_CROP_KEY
      ? [...sunflowerProbabilities.values()].filter((percent) => percent > SUNFLOWER_MAP_COLOR_THRESHOLD_PERCENT).length
      : 0
  const geoJsonDataKey = `${searchToken}-${center?.lat}-${center?.lng}-${selectedCrop}-${qualifyingSunflowerCount}`
  const layersByIdRef = useRef(new Map<string, Layer>())
  const prevDataKeyRef = useRef(geoJsonDataKey)
  if (prevDataKeyRef.current !== geoJsonDataKey) {
    prevDataKeyRef.current = geoJsonDataKey
    layersByIdRef.current = new Map()
  }

  const featureStyle: StyleFunction = (feature) => {
    const normalized = feature as NormalizedFieldFeature | undefined
    if (!normalized) return {}

    const isSelected = normalized.id === selectedFieldId
    const sunflowerProbabilityPercent = normalized.id === undefined ? null : (sunflowerProbabilities.get(String(normalized.id)) ?? null)
    const isSunflowerLikely =
      normalized.properties.aluType === 'field' && sunflowerProbabilityPercent != null && sunflowerProbabilityPercent > SUNFLOWER_MAP_COLOR_THRESHOLD_PERCENT
    const color = colorForFeatureWithSunflower(normalized.properties, cropColorMap, sunflowerProbabilityPercent, nowSec)

    // Sunflower fields get their own distinct dark-brown stroke and a visibly thicker outline
    // (not just a different fill hue) — a fill-color-only difference from the existing
    // categorical crop palette read as ambiguous in practice (a real Corn field's assigned
    // orange/amber landed close enough to an earlier gold choice to be mistaken for it).
    return {
      color: isSelected ? '#0b0b0b' : isSunflowerLikely ? SUNFLOWER_LIKELY_STROKE_COLOR : color,
      weight: isSelected ? 3 : isSunflowerLikely ? 2.5 : 1.25,
      fillColor: color,
      fillOpacity: isSelected ? 0.8 : 0.55,
      className: isSelected ? 'field-selected' : undefined,
    }
  }

  // Changing the reference month (nowSec) can change every visible field's displayed AMED
  // color at once (a different season may now be "active" for many fields simultaneously) —
  // unlike a single field's Sunflower result arriving, this walks every currently-mounted
  // layer rather than a handful, but still via the same imperative setStyle pattern rather
  // than a full GeoJSON remount, so switching months stays cheap even for a dense result.
  useEffect(() => {
    for (const layer of layersByIdRef.current.values()) {
      const pathLayer = layer as Layer & Partial<L.Path>
      if (typeof pathLayer.setStyle !== 'function') continue
      const feature = (layer as unknown as { feature?: NormalizedFieldFeature }).feature
      if (feature) pathLayer.setStyle(featureStyle(feature))
    }
    // featureStyle is a fresh closure each render but only depends on selectedFieldId/cropColorMap/
    // sunflowerProbabilities/nowSec, which are already this effect's real dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nowSec])

  // As each field's Sunflower RF result arrives (sunflowerProbabilities grows one entry at a
  // time — see useSunflowerFieldColors), imperatively restyle just that field's already-mounted
  // layer, same setStyle pattern used for selection below — never remounts the whole GeoJSON
  // layer just because one more field's probability became known.
  useEffect(() => {
    for (const fieldId of sunflowerProbabilities.keys()) {
      const layer = layersByIdRef.current.get(fieldId) as (Layer & Partial<L.Path>) | undefined
      if (!layer || typeof layer.setStyle !== 'function') continue
      const feature = (layer as unknown as { feature?: NormalizedFieldFeature }).feature
      if (feature) layer.setStyle(featureStyle(feature))
    }
    // featureStyle is a fresh closure each render but only depends on selectedFieldId/cropColorMap/
    // sunflowerProbabilities, which are already this effect's real dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sunflowerProbabilities])

  // Imperatively restyles just the previously- and newly-selected layers (at most two) via
  // Leaflet's own setStyle, instead of remounting the whole GeoJSON layer for a selection
  // change — see geoJsonDataKey above.
  const prevSelectedIdRef = useRef<string | null>(null)
  useEffect(() => {
    const restyle = (id: string) => {
      const layer = layersByIdRef.current.get(id) as (Layer & Partial<L.Path>) | undefined
      // Point-geometry features (e.g. a dug well) render as an L.Marker, which has no
      // setStyle — featureStyle's PathOptions never applied to those even before this
      // change (Leaflet's `style` prop only affects vector/Path layers), so skipping them
      // here preserves that same behavior instead of throwing on a non-Path layer.
      if (!layer || typeof layer.setStyle !== 'function') return
      const feature = (layer as unknown as { feature?: NormalizedFieldFeature }).feature
      if (feature) layer.setStyle(featureStyle(feature))
    }

    const prevId = prevSelectedIdRef.current
    if (prevId !== null && prevId !== selectedFieldId) restyle(prevId)
    if (selectedFieldId !== null) restyle(selectedFieldId)
    prevSelectedIdRef.current = selectedFieldId
    // featureStyle is a fresh closure each render but only depends on selectedFieldId/cropColorMap,
    // which are already this effect's real dependencies — re-deriving it here is intentional.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFieldId, cropColorMap])

  // Perceived-performance instrumentation: time from the API response landing to this
  // specific result actually being committed to the Leaflet layer (i.e. on screen).
  useEffect(() => {
    if (!visibleFieldCollection) return
    markPerf('rendered')
    logPerfDelta('responseReceived', 'rendered', 'response-received → fields-rendered')
  }, [visibleFieldCollection])

  return (
    <div className="relative h-full w-full">
      {/*
        scrollWheelZoom is intentionally left at Leaflet's default (enabled) — normal scroll/
        pinch zoom over the map must keep working. The sidebar is a separate DOM sibling (see
        App.tsx) with its own scroll container, so it never shares this wheel handling; nothing
        here needs to change to keep sidebar scrolling from zooming the map.
      */}
      <MapContainer
        center={[defaultMapCenter.lat, defaultMapCenter.lng]}
        zoom={defaultMapZoom}
        zoomControl={false}
        className="h-full w-full"
      >
        {basemap === 'street' ? (
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
        ) : (
          <>
            <TileLayer
              attribution="Tiles &copy; Esri &mdash; Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community"
              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            />
            <TileLayer
              attribution="Labels &copy; Esri, HERE, Garmin, OpenStreetMap contributors, and the GIS User Community"
              url="https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"
            />
          </>
        )}
        <ZoomControl position="bottomright" />
        <ClickHandler onMapClick={onMapClick} />
        <ResetToDefaultView resetToken={resetToken} />

        {center && (
          <FitToData center={center} fieldCollection={fieldCollection} anchorToCenter={!isNearbyCoverage} gridKm={gridKm} />
        )}

        {center && isNearbyCoverage && coverage?.nearestDistanceKm !== null && coverage?.nearestDistanceKm !== undefined && (
          <Circle
            center={[center.lat, center.lng]}
            radius={coverage.nearestDistanceKm * 1000}
            pathOptions={{ color: '#64748b', weight: 1.5, dashArray: '6 6', fillOpacity: 0 }}
          />
        )}

        {visibleFieldCollection && (
          <GeoJSON
            key={geoJsonDataKey}
            data={visibleFieldCollection}
            style={featureStyle}
            onEachFeature={(feature, layer: Layer) => {
              const normalized = feature as NormalizedFieldFeature
              if (normalized.id !== undefined) layersByIdRef.current.set(String(normalized.id), layer)

              layer.on('click', (event: LeafletMouseEvent) => {
                L.DomEvent.stopPropagation(event)
                onSelectField(normalized)
              })
            }}
          />
        )}

        {center && (
          <CircleMarker
            center={[center.lat, center.lng]}
            radius={9}
            pathOptions={{ color: '#0b0b0b', weight: 2, fillColor: '#f43f5e', fillOpacity: 1 }}
          >
            <Tooltip direction="top" offset={[0, -8]} permanent={false}>
              Selected location
            </Tooltip>
          </CircleMarker>
        )}
      </MapContainer>

      <div
        className="absolute right-4 top-4 z-[500] flex overflow-hidden rounded-md border border-slate-300 bg-white shadow-sm"
        role="group"
        aria-label="Base map style"
      >
        {(['street', 'satellite'] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setBasemap(option)}
            aria-pressed={basemap === option}
            className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
              option === 'street' ? 'border-r border-slate-300' : ''
            } ${basemap === option ? 'bg-emerald-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
          >
            {option === 'street' ? 'Street' : 'Satellite'}
          </button>
        ))}
      </div>

      {!center && (
        <div className="pointer-events-none absolute left-1/2 top-6 z-[500] -translate-x-1/2 rounded-full border border-slate-200 bg-white/95 px-4 py-2 text-sm text-slate-600 shadow-md">
          Click anywhere on the map, or set coordinates above, to analyze the surrounding agricultural area
        </div>
      )}
    </div>
  )
}
