/**
 * Part A of the multi-candidate validation: for each of 4 independently-identified real
 * coordinates, run the REAL production searchAgriculturalArea() (Google Agricultural
 * Understanding API — not CDSE, zero PU cost) to determine whether the location falls inside or
 * near a real AMED field polygon. No coordinate or field ID is invented here.
 *
 * Run: cd server && npx tsx scripts/findAdditionalCandidates.ts
 */
import 'dotenv/config'
import { writeFileSync } from 'node:fs'
import { searchAgriculturalArea } from '../src/services/agricultural/areaSearch.js'
import { buildAmedHypotheses } from '../src/services/agricultural/sunflower/amedHypotheses.js'

const CANDIDATES = [
  { name: 'Mittikellur/Lingasugur/Raichur', lat: 16.051000, lng: 76.531200 },
  { name: 'Kuttapalli', lat: 17.038803, lng: 77.419292 },
  { name: 'Karnataka-3', lat: 15.387318, lng: 75.868861 },
  { name: 'Karnataka-4', lat: 13.438239, lng: 77.319143 },
]

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

const results: Record<string, unknown> = {}

for (const candidate of CANDIDATES) {
  console.log(`\n=== ${candidate.name} (${candidate.lat}, ${candidate.lng}) ===`)
  const { fieldCollection, coverage } = await searchAgriculturalArea(candidate.lat, candidate.lng, 3, 30)
  console.log('coverage:', JSON.stringify(coverage))

  const fieldFeatures = fieldCollection.features.filter((f) => f.properties.aluType === 'field')

  function centroidOf(geometry: GeoJSON.Geometry): { lat: number; lng: number } | null {
    const rings: number[][][] = geometry.type === 'Polygon' ? geometry.coordinates : geometry.type === 'MultiPolygon' ? geometry.coordinates.flat() : []
    const points = rings.flat()
    if (points.length === 0) return null
    const lat = points.reduce((s, p) => s + p[1], 0) / points.length
    const lng = points.reduce((s, p) => s + p[0], 0) / points.length
    return { lat, lng }
  }

  const ranked = fieldFeatures
    .map((f) => {
      const c = centroidOf(f.geometry)
      const distanceM = c ? haversineMeters(candidate.lat, candidate.lng, c.lat, c.lng) : Infinity
      return { feature: f, distanceM }
    })
    .sort((a, b) => a.distanceM - b.distanceM)

  const nearest = ranked.length > 0 ? ranked[0] : null
  const nearestId = nearest ? String(nearest.feature.id) : null
  const hyp = nearest ? buildAmedHypotheses(nearest.feature.properties) : null

  console.log(`total real field-type features in area: ${fieldFeatures.length}`)
  if (nearest) {
    console.log(
      `TRUE nearest real field: id=${nearestId} distance=${nearest.distanceM.toFixed(1)}m area=${nearest.feature.properties.areaSqM.toFixed(1)}sqm geometryType=${nearest.feature.geometry.type} amedTop=${JSON.stringify(hyp?.amedTop)} amedIsCurrentlyObserved=${hyp?.amedIsCurrentlyObserved}`,
    )
    console.log('top 3 nearest:')
    for (const r of ranked.slice(0, 3)) {
      console.log(`  id=${String(r.feature.id)} distance=${r.distanceM.toFixed(1)}m area=${r.feature.properties.areaSqM.toFixed(1)}sqm`)
    }
  } else {
    console.log('NO real field-type feature found in this search area.')
  }

  results[candidate.name] = {
    candidate,
    coverage,
    totalFieldTypeFeatures: fieldFeatures.length,
    nearestFieldId: nearestId,
    nearestFieldDistanceM: nearest?.distanceM ?? null,
    nearestFieldAreaSqM: nearest?.feature.properties.areaSqM ?? null,
    nearestFieldAmedHypotheses: hyp,
    nearestFieldGeometryType: nearest?.feature.geometry.type ?? null,
    nearestFieldGeometry: nearest?.feature.geometry ?? null,
    nearestFieldProperties: nearest?.feature.properties ?? null,
    top3: ranked.slice(0, 3).map((r) => ({ id: String(r.feature.id), distanceM: r.distanceM, areaSqM: r.feature.properties.areaSqM })),
  }
}

writeFileSync(new URL('./additionalCandidatesSearch.json', import.meta.url), JSON.stringify(results, null, 2))
console.log('\nWrote scripts/additionalCandidatesSearch.json')
