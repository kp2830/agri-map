import L from 'leaflet'
import type { LeafletMouseEvent, Layer, StyleFunction } from 'leaflet'
import { useEffect, useRef, useState } from 'react'
import { Circle, CircleMarker, GeoJSON, MapContainer, TileLayer, Tooltip, useMap, useMapEvents, ZoomControl } from 'react-leaflet'
import { colorForFeature } from '../fields/cropDisplay'
import type { CropFilterValue } from '../fields/cropFilter'
import { defaultMapCenter, defaultMapZoom } from '../../lib/config'
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
  /** Bumped by App's "New Search" action to explicitly return the map to its default view. */
  resetToken: number
}

/** Side length (km) of the geographic context kept visible around a directly-analyzed point —
 *  mirrors the backend's INITIAL_AREA_SIDE_KM (the displayed area, not an S2 cell). */
const DISPLAY_AREA_SIDE_KM = 5
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
}: {
  center: { lat: number; lng: number }
  fieldCollection: NormalizedFieldCollection | null
  /**
   * True for a direct hit (fields found in the analyzed area) or a genuine not-found result:
   * frame the fixed ~5km x 5km analyzed area around the click, regardless of how tightly the
   * actual returned fields cluster inside it — this keeps geographic context visible instead
   * of zooming in on just the polygons (or, when nothing was found, just the empty point).
   *
   * False for fallback coverage found several km away: fit tightly to the actual returned
   * field bounds instead, without forcing the (potentially km-away, empty) click point into
   * view — preserves the existing fallback visualization, which already avoids implying the
   * clicked location itself contained those fields.
   */
  anchorToCenter: boolean
}) {
  const map = useMap()

  useEffect(() => {
    if (anchorToCenter) {
      map.fitBounds(boundsAroundPoint(center.lat, center.lng, DISPLAY_AREA_SIDE_KM), { padding: [16, 16] })
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
  }, [center.lat, center.lng, fieldCollection, anchorToCenter, map])

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
  resetToken,
}: MapViewProps) {
  // Basemap choice lives here, independent of all agricultural search/crop-filter state in
  // App — switching it never touches fieldCollection, coverage, or the selected feature, and
  // it survives a "New Search" reset since MapView itself isn't unmounted by that action.
  const [basemap, setBasemap] = useState<Basemap>('street')

  const featureStyle: StyleFunction = (feature) => {
    const normalized = feature as NormalizedFieldFeature | undefined
    if (!normalized) return {}

    const isSelected = normalized.id === selectedFieldId
    const color = colorForFeature(normalized.properties, cropColorMap)

    return {
      color: isSelected ? '#0b0b0b' : color,
      weight: isSelected ? 3 : 1.25,
      fillColor: color,
      fillOpacity: isSelected ? 0.8 : 0.55,
      className: isSelected ? 'field-selected' : undefined,
    }
  }

  const isNearbyCoverage = coverage?.status === 'found_nearby'

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
          <FitToData center={center} fieldCollection={fieldCollection} anchorToCenter={!isNearbyCoverage} />
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
            key={`${center?.lat}-${center?.lng}-${selectedFieldId ?? 'none'}-${selectedCrop}`}
            data={visibleFieldCollection}
            style={featureStyle}
            onEachFeature={(feature, layer: Layer) => {
              layer.on('click', (event: LeafletMouseEvent) => {
                L.DomEvent.stopPropagation(event)
                onSelectField(feature as NormalizedFieldFeature)
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
