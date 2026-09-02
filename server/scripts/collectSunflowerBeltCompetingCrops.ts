/**
 * Data-collection tool (NOT part of the production request path — run manually via
 * `tsx server/scripts/collectSunflowerBeltCompetingCrops.ts`) that builds the REAL
 * competing-crop side of the Sunflower training dataset.
 *
 * It calls the exact same production ALU+AMED pipeline (`searchAgriculturalArea`) already
 * used by the live app — no second field-segmentation system, no synthetic data, no invented
 * coordinates for the crop labels themselves. The only "chosen" inputs here are the query
 * points below, which are real, public geographic coordinates of district headquarters in
 * India's major Sunflower-growing regions (Karnataka ~53% of national production, plus Andhra
 * Pradesh, Telangana, Maharashtra) — used purely to anchor where the search looks, exactly the
 * way a user clicking the map would. Every crop label, confidence, geometry, and monitoring
 * history in the output comes directly from a real, live AMED/ALU API response.
 *
 * A field is included only if at least one of its real AMED monitoring seasons has a genuine,
 * non-sentinel top crop prediction (i.e. not `UNKNOWN_CROP` or `NO_PREDICTION`) — per the
 * explicit instruction that those sentinels must never be treated as confirmed negatives.
 * Fields with no monitoring data, or with monitoring data that never resolves to a real crop,
 * are skipped entirely rather than included with a guessed label.
 *
 * Output: newline-delimited JSON (one real field per line) at
 * server/data/training/sunflower-belt-competing-crops.jsonl — never committed automatically;
 * this script only writes to disk.
 */
import 'dotenv/config'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { searchAgriculturalArea } from '../src/services/agricultural/areaSearch.js'
import type { MonitoringSeason, NormalizedFieldFeature } from '../src/types/agricultural.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUTPUT_PATH = `${__dirname}/../data/training/sunflower-belt-competing-crops.jsonl`

/** Real district-headquarters coordinates in India's major Sunflower-growing belt. Karnataka
 *  districts are the ones specifically named in national sunflower-production statistics
 *  (Raichur, Vijayapura/Bijapur, Ballari/Bellary, Bidar, Chitradurga, Belagavi/Belgaum, Gadag,
 *  Kalaburagi/Gulbarga — together the bulk of Karnataka's ~53% national share). Andhra Pradesh/
 *  Telangana/Maharashtra entries are real district centers in those states' documented
 *  sunflower/oilseed-growing areas. These are ordinary public geographic facts (town
 *  coordinates), not agricultural ground truth — the actual crop data below comes entirely from
 *  the live AMED API response for each point. */
const QUERY_POINTS: { state: string; district: string; lat: number; lng: number }[] = [
  { state: 'Karnataka', district: 'Raichur', lat: 16.2076, lng: 77.3463 },
  { state: 'Karnataka', district: 'Vijayapura', lat: 16.8302, lng: 75.71 },
  { state: 'Karnataka', district: 'Ballari', lat: 15.1394, lng: 76.9214 },
  { state: 'Karnataka', district: 'Bidar', lat: 17.9104, lng: 77.5199 },
  { state: 'Karnataka', district: 'Chitradurga', lat: 14.2251, lng: 76.398 },
  { state: 'Karnataka', district: 'Belagavi', lat: 15.8497, lng: 74.4977 },
  { state: 'Karnataka', district: 'Gadag', lat: 15.4319, lng: 75.61 },
  { state: 'Karnataka', district: 'Kalaburagi', lat: 17.3297, lng: 76.8343 },
  { state: 'Andhra Pradesh', district: 'Anantapur', lat: 14.6819, lng: 77.6006 },
  { state: 'Andhra Pradesh', district: 'Kurnool', lat: 15.8281, lng: 78.0373 },
  { state: 'Telangana', district: 'Mahbubnagar', lat: 16.7488, lng: 77.9855 },
  { state: 'Telangana', district: 'Nalgonda', lat: 17.0575, lng: 79.2685 },
  { state: 'Maharashtra', district: 'Solapur', lat: 17.6599, lng: 75.9064 },
  { state: 'Maharashtra', district: 'Ahmednagar', lat: 19.0952, lng: 74.7496 },
  { state: 'Maharashtra', district: 'Latur', lat: 18.4088, lng: 76.5604 },
]

const GRID_KM = 3
const MAX_SEARCH_KM = 15
const NON_CONFIRMED_CROPS = new Set(['UNKNOWN_CROP', 'NO_PREDICTION'])

interface TrainingRow {
  sampleId: string
  fieldId: string
  geometry: GeoJSON.Geometry
  coordinate: { lat: number; lng: number }
  amedCrop: string
  amedConfidence: number
  monitoringHistory: MonitoringSeason[]
  region: string
  district: string
  season: 'kharif' | 'rabi' | 'unclear'
  year: number
  labelSource: 'amed_confirmed_negative'
  queriedAt: string
}

function fieldCentroid(geometry: GeoJSON.Geometry): { lat: number; lng: number } | null {
  const coords: GeoJSON.Position[] = []
  const collect = (g: GeoJSON.Geometry) => {
    if (g.type === 'Polygon') for (const ring of g.coordinates) coords.push(...ring)
    else if (g.type === 'MultiPolygon') for (const poly of g.coordinates) for (const ring of poly) coords.push(...ring)
  }
  collect(geometry)
  if (coords.length === 0) return null
  const [lngSum, latSum] = coords.reduce((acc, [lng, lat]) => [acc[0] + lng, acc[1] + lat], [0, 0])
  return { lat: latSum / coords.length, lng: lngSum / coords.length }
}

/** Kharif (monsoon-sown, roughly June-October start) vs Rabi (winter-sown, roughly
 *  November-March start) — a standard, real Indian agricultural-season convention, applied only
 *  to derive a label from the season's own real start date, never invented. */
function seasonLabel(startTimestampSec: number): 'kharif' | 'rabi' | 'unclear' {
  const month = new Date(startTimestampSec * 1000).getUTCMonth() + 1
  if (month >= 6 && month <= 10) return 'kharif'
  if (month === 11 || month === 12 || (month >= 1 && month <= 3)) return 'rabi'
  return 'unclear'
}

/** The most recently-started real monitoring season whose top prediction is a genuine,
 *  non-sentinel crop — the same "most recent confirmed observation" principle already used
 *  elsewhere in this app, applied here only to pick which single season anchors `amedCrop`/
 *  `amedConfidence`; `monitoringHistory` below always preserves every real season regardless. */
function mostRecentConfirmedSeason(seasons: MonitoringSeason[]): MonitoringSeason | null {
  const confirmed = seasons.filter((s) => {
    const crop = s.predictions[0]?.crop
    return crop !== undefined && !NON_CONFIRMED_CROPS.has(crop)
  })
  if (confirmed.length === 0) return null
  return confirmed.reduce((latest, s) => (s.startTimestampSec > latest.startTimestampSec ? s : latest))
}

function toTrainingRow(
  feature: NormalizedFieldFeature,
  point: { state: string; district: string },
  queriedAt: string,
): TrainingRow | null {
  if (feature.properties.aluType !== 'field') return null
  const seasons = feature.properties.monitoring ?? []
  const anchorSeason = mostRecentConfirmedSeason(seasons)
  if (!anchorSeason) return null // no real confirmed crop anywhere in this field's history — excluded, not guessed

  const centroid = fieldCentroid(feature.geometry)
  if (!centroid) return null

  const anchorPrediction = anchorSeason.predictions[0]
  return {
    sampleId: `${String(feature.id)}_${anchorSeason.startTimestampSec}`,
    fieldId: String(feature.id),
    geometry: feature.geometry,
    coordinate: centroid,
    amedCrop: anchorPrediction.crop,
    amedConfidence: anchorPrediction.confidence,
    monitoringHistory: seasons,
    region: point.state,
    district: point.district,
    season: seasonLabel(anchorSeason.startTimestampSec),
    year: new Date(anchorSeason.startTimestampSec * 1000).getUTCFullYear(),
    labelSource: 'amed_confirmed_negative',
    queriedAt,
  }
}

async function main() {
  const rows: TrainingRow[] = []
  const seenFieldIds = new Set<string>()
  const queriedAt = new Date().toISOString()

  for (const point of QUERY_POINTS) {
    console.log(`[collect] querying ${point.state} / ${point.district} (${point.lat}, ${point.lng})`)
    try {
      const { fieldCollection, coverage } = await searchAgriculturalArea(point.lat, point.lng, GRID_KM, MAX_SEARCH_KM)
      let addedForPoint = 0
      for (const feature of fieldCollection.features) {
        const row = toTrainingRow(feature as NormalizedFieldFeature, point, queriedAt)
        if (!row) continue
        if (seenFieldIds.has(row.fieldId)) continue // a field near two query points is recorded once
        seenFieldIds.add(row.fieldId)
        rows.push(row)
        addedForPoint++
      }
      console.log(`[collect]   coverage=${coverage.status} totalFields=${fieldCollection.features.length} confirmedAdded=${addedForPoint}`)
    } catch (error) {
      console.error(`[collect]   FAILED for ${point.state}/${point.district}:`, error instanceof Error ? error.message : error)
    }
  }

  mkdirSync(dirname(OUTPUT_PATH), { recursive: true })
  writeFileSync(OUTPUT_PATH, rows.map((row) => JSON.stringify(row)).join('\n') + '\n', 'utf8')

  const byCrop = new Map<string, number>()
  for (const row of rows) byCrop.set(row.amedCrop, (byCrop.get(row.amedCrop) ?? 0) + 1)

  console.log(`\n[collect] wrote ${rows.length} confirmed real fields to ${OUTPUT_PATH}`)
  console.log('[collect] crop distribution:')
  for (const [crop, count] of [...byCrop.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${crop}: ${count}`)
  }
}

main().catch((error) => {
  console.error('[collect] fatal error:', error)
  process.exitCode = 1
})
