import 'dotenv/config'
import { writeFileSync } from 'node:fs'
import { searchAgriculturalArea } from '../src/services/agricultural/areaSearch.js'
import { buildAmedHypotheses } from '../src/services/agricultural/sunflower/amedHypotheses.js'

const CANDIDATES = [
  { name: 'Nargund-Gadag-iNat-265387815', lat: 15.6744383333, lng: 75.3440033333, observedOn: '2025-02-27' },
  { name: 'BadamiRoad-Bagalkote-iNat-265387867', lat: 15.905805, lng: 75.521605, observedOn: '2025-02-27' },
]

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

function centroidOf(geometry: GeoJSON.Geometry): { lat: number; lng: number } | null {
  const rings: number[][][] = geometry.type === 'Polygon' ? geometry.coordinates : geometry.type === 'MultiPolygon' ? geometry.coordinates.flat() : []
  const points = rings.flat()
  if (points.length === 0) return null
  const lat = points.reduce((s, p) => s + p[1], 0) / points.length
  const lng = points.reduce((s, p) => s + p[0], 0) / points.length
  return { lat, lng }
}

const results: Record<string, unknown> = {}
for (const candidate of CANDIDATES) {
  console.log(`\n=== ${candidate.name} (${candidate.lat}, ${candidate.lng}) ===`)
  const { fieldCollection, coverage } = await searchAgriculturalArea(candidate.lat, candidate.lng, 3, 30)
  const fieldFeatures = fieldCollection.features.filter((f) => f.properties.aluType === 'field')
  const ranked = fieldFeatures
    .map((f) => {
      const c = centroidOf(f.geometry)
      const distanceM = c ? haversineMeters(candidate.lat, candidate.lng, c.lat, c.lng) : Infinity
      return { feature: f, distanceM }
    })
    .sort((a, b) => a.distanceM - b.distanceM)
  const nearest = ranked[0] ?? null
  console.log('coverage:', JSON.stringify(coverage))
  console.log(`real field-type features in area: ${fieldFeatures.length}`)
  if (nearest) {
    const hyp = buildAmedHypotheses(nearest.feature.properties)
    console.log(`nearest: id=${String(nearest.feature.id)} distance=${nearest.distanceM.toFixed(1)}m area=${nearest.feature.properties.areaSqM.toFixed(1)}sqm amedTop=${JSON.stringify(hyp.amedTop)}`)
    results[candidate.name] = {
      candidate, coverage, nearestFieldId: String(nearest.feature.id), nearestFieldDistanceM: nearest.distanceM,
      nearestFieldAreaSqM: nearest.feature.properties.areaSqM, nearestFieldGeometry: nearest.feature.geometry,
      nearestFieldProperties: nearest.feature.properties, nearestFieldAmedHypotheses: hyp,
    }
  } else {
    console.log('NO real field found.')
    results[candidate.name] = { candidate, coverage, nearestFieldId: null }
  }
}
writeFileSync('scripts/datedCandidateSearch.json', JSON.stringify(results, null, 2))
