export const defaultMapCenter = {
  lat: Number(import.meta.env.VITE_MAP_DEFAULT_LAT ?? 22.9734),
  lng: Number(import.meta.env.VITE_MAP_DEFAULT_LNG ?? 78.6569),
}

export const defaultMapZoom = Number(import.meta.env.VITE_MAP_DEFAULT_ZOOM ?? 5)
