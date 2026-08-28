/**
 * Approximate centroid (mean of all vertices) of a GeoJSON geometry — the exact same
 * definition the backend already uses for `nearestFieldCentroid` (see server's
 * areaSearch.ts). Kept as a small, independent client-side function rather than a shared
 * package (this repo has no client/server code-sharing setup — see CLAUDE.md), so that
 * selecting a field can update the coordinate inputs instantly with no network request,
 * using the identical centroid math the backend already established as "the" field
 * location rather than inventing a second, competing definition (e.g. Leaflet's bounding
 * box center, which can differ for irregular polygons).
 */
function collectCoordinates(geometry: GeoJSON.Geometry, out: GeoJSON.Position[]): void {
  switch (geometry.type) {
    case 'Point':
      out.push(geometry.coordinates)
      break
    case 'MultiPoint':
    case 'LineString':
      out.push(...geometry.coordinates)
      break
    case 'MultiLineString':
    case 'Polygon':
      for (const ring of geometry.coordinates) out.push(...ring)
      break
    case 'MultiPolygon':
      for (const polygon of geometry.coordinates) for (const ring of polygon) out.push(...ring)
      break
    case 'GeometryCollection':
      for (const g of geometry.geometries) collectCoordinates(g, out)
      break
  }
}

export function featureCentroid(geometry: GeoJSON.Geometry): { lat: number; lng: number } | null {
  const coords: GeoJSON.Position[] = []
  collectCoordinates(geometry, coords)
  if (coords.length === 0) return null

  const [lngSum, latSum] = coords.reduce((acc, [lng, lat]) => [acc[0] + lng, acc[1] + lat], [0, 0])
  return { lng: lngSum / coords.length, lat: latSum / coords.length }
}
