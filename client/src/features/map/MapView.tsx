import L from 'leaflet'
import type { Layer, StyleFunction } from 'leaflet'
import { useEffect } from 'react'
import { GeoJSON, MapContainer, TileLayer, useMap, ZoomControl } from 'react-leaflet'
import { colorForFeature } from '../fields/cropDisplay'
import { defaultMapCenter, defaultMapZoom } from '../../lib/config'
import type { NormalizedFieldCollection, NormalizedFieldFeature } from '../../types/agricultural'

interface MapViewProps {
  center: { lat: number; lng: number } | null
  fieldCollection: NormalizedFieldCollection | null
  selectedFieldId: string | null
  onSelectField: (feature: NormalizedFieldFeature) => void
  cropColorMap: Map<string, string>
}

function FitToData({
  center,
  fieldCollection,
}: {
  center: { lat: number; lng: number }
  fieldCollection: NormalizedFieldCollection | null
}) {
  const map = useMap()

  useEffect(() => {
    if (fieldCollection && fieldCollection.features.length > 0) {
      const bounds = L.geoJSON(fieldCollection).getBounds()
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [48, 48], maxZoom: 17 })
        return
      }
    }
    map.setView([center.lat, center.lng], 15)
  }, [center.lat, center.lng, fieldCollection, map])

  return null
}

export function MapView({ center, fieldCollection, selectedFieldId, onSelectField, cropColorMap }: MapViewProps) {
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

  return (
    <div className="relative h-full w-full">
      <MapContainer
        center={[defaultMapCenter.lat, defaultMapCenter.lng]}
        zoom={defaultMapZoom}
        zoomControl={false}
        className="h-full w-full"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <ZoomControl position="bottomright" />

        {center && <FitToData center={center} fieldCollection={fieldCollection} />}

        {fieldCollection && (
          <GeoJSON
            key={`${center?.lat}-${center?.lng}-${selectedFieldId ?? 'none'}`}
            data={fieldCollection}
            style={featureStyle}
            onEachFeature={(feature, layer: Layer) => {
              layer.on('click', () => onSelectField(feature as NormalizedFieldFeature))
            }}
          />
        )}
      </MapContainer>

      {!center && (
        <div className="pointer-events-none absolute left-1/2 top-6 z-[500] -translate-x-1/2 rounded-full border border-slate-200 bg-white/95 px-4 py-2 text-sm text-slate-600 shadow-md">
          Set coordinates above and click <span className="font-semibold text-slate-800">Analyze</span> to load fields
        </div>
      )}
    </div>
  )
}
