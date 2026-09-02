import 'dotenv/config'
import { writeFileSync } from 'node:fs'
import { searchAgriculturalArea } from '../src/services/agricultural/areaSearch.js'
import { buildAmedHypotheses } from '../src/services/agricultural/sunflower/amedHypotheses.js'

const CANDIDATES = [
  { name: 'Sindgi-Bijapur-iNat-56823200', lat: 16.9535950944, lng: 75.9900542815, positionalAccuracyM: 5, observedOn: '2020-08-18' },
  { name: 'ShelarFarm-Pangare-iNat-327356159', lat: 18.276, lng: 74.0612085, positionalAccuracyM: 226, observedOn: '2025-10-28' },
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
  return { lat: points.reduce((s, p) => s + p[1], 0) / points.length, lng: points.reduce((s, p) => s + p[0], 0) / points.length }
}

const results: Record<string, unknown> = {}
for (const candidate of CANDIDATES) {
  console.log(`\n=== ${candidate.name} (${candidate.lat}, ${candidate.lng}), GPS accuracy ~${candidate.positionalAccuracyM}m ===`)
  const { fieldCollection, coverage } = await searchAgriculturalArea(candidate.lat, candidate.lng, 3, 30)
  const fieldFeatures = fieldCollection.features.filter((f) => f.properties.aluType === 'field')
  const ranked = fieldFeatures
    .map((f) => {
      const c = centroidOf(f.geometry)
      const distanceM = c ? haversineMeters(candidate.lat, candidate.lng, c.lat, c.lng) : Infinity
      return { feature: f, distanceM }
    })
    .sort((a, b) => a.distanceM - b.distanceM)
  console.log('coverage:', JSON.stringify(coverage))
  console.log(`real field-type features in area: ${fieldFeatures.length}`)
  const withinGpsAccuracy = ranked.filter((r) => r.distanceM <= candidate.positionalAccuracyM + 20)
  console.log(`fields within GPS accuracy radius (+20m buffer): ${withinGpsAccuracy.length}`)
  for (const r of ranked.slice(0, 5)) {
    const hyp = buildAmedHypotheses(r.feature.properties)
    console.log(`  id=${String(r.feature.id)} distance=${r.distanceM.toFixed(1)}m area=${r.feature.properties.areaSqM.toFixed(1)}sqm amedTop=${JSON.stringify(hyp.amedTop)}`)
  }
  const nearest = ranked[0] ?? null
  results[candidate.name] = nearest
    ? { candidate, coverage, nearestFieldId: String(nearest.feature.id), nearestFieldDistanceM: nearest.distanceM, nearestFieldAreaSqM: nearest.feature.properties.areaSqM, nearestFieldGeometry: nearest.feature.geometry, nearestFieldProperties: nearest.feature.properties, nearestFieldAmedHypotheses: buildAmedHypotheses(nearest.feature.properties), fieldsWithinGpsAccuracy: withinGpsAccuracy.length, totalFieldsInArea: fieldFeatures.length }
    : { candidate, coverage, nearestFieldId: null }
}
writeFileSync('scripts/secondCandidateSearch.json', JSON.stringify(results, null, 2))
