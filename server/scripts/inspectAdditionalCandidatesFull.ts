/**
 * Exactly 4 real live CDSE requests (one per real matched AMED field from
 * findAdditionalCandidates.ts), same production extraction path as
 * inspectKarnatakaCandidateFull.ts, run sequentially. No historical source date could be
 * independently verified for any of these candidates (only text descriptions were provided, no
 * fetchable URL) -- disclosed here rather than fabricated; uses the same current 183-day window
 * production already uses.
 *
 * Run: cd server && npx tsx scripts/inspectAdditionalCandidatesFull.ts
 */
import 'dotenv/config'
import { readFileSync, writeFileSync } from 'node:fs'
import type { MultiPolygon } from 'geojson'
import { requestPolygonStatistics, type DailyObservation } from '../src/services/google/cdseClient.js'
import { scoreSunflowerLikeness } from '../src/services/agricultural/sunflower/likenessModel.js'
import { decideSunflowerOverride } from '../src/services/agricultural/sunflower/overridePolicy.js'
import { meanIgnoringNulls } from '../src/services/agricultural/sunflower/spectralIndices.js'
import type { AmedHypothesesResult } from '../src/services/agricultural/sunflower/amedHypotheses.js'
import type { NormalizedFieldProperties } from '../src/types/agricultural.js'
import type { Geometry } from 'geojson'

interface SearchResult {
  candidate: { name: string; lat: number; lng: number }
  nearestFieldId: string | null
  nearestFieldDistanceM: number | null
  nearestFieldAreaSqM: number | null
  nearestFieldAmedHypotheses: AmedHypothesesResult | null
  nearestFieldGeometryType: string | null
  nearestFieldGeometry: Geometry | null
  nearestFieldProperties: NormalizedFieldProperties | null
}

const search = JSON.parse(readFileSync(new URL('./additionalCandidatesSearch.json', import.meta.url), 'utf-8')) as Record<string, SearchResult>

const LIVE_EXTRACTION_WINDOW_DAYS = 183
const end = new Date()
const start = new Date(end.getTime() - LIVE_EXTRACTION_WINDOW_DAYS * 24 * 60 * 60 * 1000)
const startDate = start.toISOString().slice(0, 10)
const endDate = end.toISOString().slice(0, 10)

function summarize(indexName: string, series: DailyObservation[]) {
  const valid = series.filter((o) => o.mean !== null)
  const values = valid.map((o) => o.mean as number)
  const mean = meanIgnoringNulls(values)
  const peak = values.length > 0 ? Math.max(...values) : null
  const min = values.length > 0 ? Math.min(...values) : null
  return {
    mean, peak, min,
    observationCount: valid.length,
    rejectedCount: series.length - valid.length,
    totalGridPoints: series.length,
    dateRange: valid.length > 0 ? [valid[0].date, valid[valid.length - 1].date] : null,
    trajectory: valid.map((o) => ({ date: o.date, value: o.mean })),
  }
}

const allResults: Record<string, unknown> = {}

for (const [name, entry] of Object.entries(search)) {
  console.log(`\n=== ${name}: field ${entry.nearestFieldId} (${entry.nearestFieldDistanceM?.toFixed(1)}m from documented location, area=${entry.nearestFieldAreaSqM?.toFixed(1)}sqm) ===`)

  if (!entry.nearestFieldGeometry || (entry.nearestFieldGeometry.type !== 'Polygon' && entry.nearestFieldGeometry.type !== 'MultiPolygon')) {
    console.log('SKIPPED: no usable geometry found.')
    continue
  }
  const nativePixels = (entry.nearestFieldAreaSqM ?? 0) / 100
  console.log(`Approx. native Sentinel-2 10m pixels: ${nativePixels.toFixed(1)}`)
  console.log(`Real AMED result: ${JSON.stringify(entry.nearestFieldAmedHypotheses)}`)
  console.log(`No verifiable historical source date available for this candidate -- using the current ${startDate} to ${endDate} window (same as production).`)

  const t0 = Date.now()
  const { dailySeriesByIndex, processingUnitsSpent } = await requestPolygonStatistics(entry.nearestFieldGeometry as MultiPolygon, startDate, endDate)
  console.log(`Real CDSE request completed in ${Date.now() - t0}ms. Real PU spent: ${processingUnitsSpent}`)

  const ndvi = summarize('ndvi', dailySeriesByIndex.ndvi)
  const ndre = summarize('ndre', dailySeriesByIndex.ndre)
  const ndwi = summarize('ndwi', dailySeriesByIndex.ndwi)
  const ndyi = summarize('ndyi', dailySeriesByIndex.ndyi)
  console.log(`NDVI: ${ndvi.observationCount} valid obs, mean=${ndvi.mean?.toFixed(4)} peak=${ndvi.peak?.toFixed(4)}`)
  console.log(`NDRE: ${ndre.observationCount} valid obs, mean=${ndre.mean?.toFixed(4)} peak=${ndre.peak?.toFixed(4)}`)
  console.log(`NDWI: ${ndwi.observationCount} valid obs, mean=${ndwi.mean?.toFixed(4)} peak=${ndwi.peak?.toFixed(4)}`)
  console.log(`NDYI: ${ndyi.observationCount} valid obs, mean=${ndyi.mean?.toFixed(4)} peak=${ndyi.peak?.toFixed(4)}`)

  const spectral = {
    ndviMean: ndvi.mean, ndviSlope: null, ndviPeakValue: ndvi.peak,
    ndreMean: ndre.mean, ndreSlope: null, ndrePeakValue: ndre.peak,
    ndwiMean: ndwi.mean, ndwiPeakValue: ndwi.peak,
    yellowIndexMean: ndyi.mean, yellowIndexSlope: null, yellowIndexPeakValue: ndyi.peak,
    observationCount: ndvi.observationCount,
  }
  const scored = scoreSunflowerLikeness(spectral)
  console.log('scoreSunflowerLikeness():', JSON.stringify(scored))

  const hyp = entry.nearestFieldAmedHypotheses
  const decision = decideSunflowerOverride({
    amedTop: hyp?.amedTop ?? null,
    amedIsCurrentlyObserved: hyp?.amedIsCurrentlyObserved ?? false,
    likeness: 'available' in scored ? null : scored,
  })
  console.log('decideSunflowerOverride():', JSON.stringify(decision))

  allResults[name] = {
    fieldId: entry.nearestFieldId,
    distanceFromDocumentedLocationM: entry.nearestFieldDistanceM,
    areaSqM: entry.nearestFieldAreaSqM,
    approxNativePixels: nativePixels,
    window: { startDate, endDate },
    processingUnitsSpent,
    amedHypotheses: hyp,
    indices: { ndvi, ndre, ndwi, ndyi },
    spectral,
    scored,
    decision,
  }
}

writeFileSync(new URL('./additionalCandidatesFullResults.json', import.meta.url), JSON.stringify(allResults, null, 2))
console.log('\nWrote scripts/additionalCandidatesFullResults.json')
