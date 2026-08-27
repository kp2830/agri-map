import type { Layer, StyleFunction } from 'leaflet'
import { useEffect } from 'react'
import { GeoJSON, MapContainer, TileLayer, useMap } from 'react-leaflet'
import { colorForFeature } from '../fields/cropDisplay'
import { defaultMapCenter, defaultMapZoom } from '../../lib/config'
import type { NormalizedFieldCollection, NormalizedFieldFeature } from '../../types/agricultural'

interface MapViewProps {
  center: { lat: number; lng: number } | null
  fieldCollection: NormalizedFieldCollection | null
  selectedFieldId: string | null
  onSelectField: (feature: NormalizedFieldFeature) => void
}

function RecenterOnChange({ center }: { center: { lat: number; lng: number } }) {
  const map = useMap()

  useEffect(() => {
    map.setView([center.lat, center.lng], 16)
  }, [center.lat, center.lng, map])

  return null
}

export function MapView({ center, fieldCollection, selectedFieldId, onSelectField }: MapViewProps) {
  const featureStyle: StyleFunction = (feature) => {
    const normalized = feature as NormalizedFieldFeature | undefined
    if (!normalized) return {}

    const isSelected = normalized.id === selectedFieldId
    const color = colorForFeature(normalized.properties)

    return {
      color: isSelected ? '#0f172a' : color,
      weight: isSelected ? 3 : 1,
      fillColor: color,
      fillOpacity: isSelected ? 0.75 : 0.5,
    }
  }

  return (
    <MapContainer center={[defaultMapCenter.lat, defaultMapCenter.lng]} zoom={defaultMapZoom} className="h-full w-full">
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      {center && <RecenterOnChange center={center} />}

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
  )
}
