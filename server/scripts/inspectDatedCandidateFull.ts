/**
 * ONE real live CDSE request for the dated, sourced Indian sunflower validation candidate:
 * iNaturalist research-grade observation 265387815 (Helianthus annuus, Nargund, Gadag district,
 * Karnataka, 2025-02-27, 3m GPS accuracy), matched to real AMED field 7J7QM8FV+XJV9 (64.7m away).
 *
 * Window: 2024-11-01 to 2025-05-01 (~181 days), bracketing the real documented observation date
 * -- NOT "today" -- covering a real full Rabi growing cycle (typical North Karnataka sunflower
 * sowing Nov/Dec, flowering Jan/Feb, harvest Mar/Apr) around the actual evidence date.
 *
 * Run: cd server && npx tsx scripts/inspectDatedCandidateFull.ts
 */
import 'dotenv/config'
import { readFileSync, writeFileSync } from 'node:fs'
import type { MultiPolygon } from 'geojson'
import { requestPolygonStatistics, type DailyObservation } from '../src/services/google/cdseClient.js'
import { scoreSunflowerLikeness } from '../src/services/agricultural/sunflower/likenessModel.js'
import { decideSunflowerOverride } from '../src/services/agricultural/sunflower/overridePolicy.js'
import { meanIgnoringNulls } from '../src/services/agricultural/sunflower/spectralIndices.js'

const search = JSON.parse(readFileSync('scripts/datedCandidateSearch.json', 'utf-8'))
const entry = search['Nargund-Gadag-iNat-265387815']

const startDate = '2024-11-01'
const endDate = '2025-05-01'

console.log(`Field ${entry.nearestFieldId}, ${entry.nearestFieldDistanceM.toFixed(1)}m from documented sunflower observation, area=${entry.nearestFieldAreaSqM.toFixed(1)}sqm (~${(entry.nearestFieldAreaSqM/100).toFixed(1)} native px)`)
console.log(`Real AMED result: ${JSON.stringify(entry.nearestFieldAmedHypotheses)}`)
console.log(`Window: ${startDate} to ${endDate} (brackets real documented observation date 2025-02-27)`)

const t0 = Date.now()
const { dailySeriesByIndex, processingUnitsSpent } = await requestPolygonStatistics(entry.nearestFieldGeometry as MultiPolygon, startDate, endDate)
console.log(`Real CDSE request completed in ${Date.now() - t0}ms. Real PU spent: ${processingUnitsSpent}`)

function summarize(series: DailyObservation[]) {
  const valid = series.filter((o) => o.mean !== null)
  const values = valid.map((o) => o.mean as number)
  return {
    mean: meanIgnoringNulls(values),
    peak: values.length > 0 ? Math.max(...values) : null,
    min: values.length > 0 ? Math.min(...values) : null,
    observationCount: valid.length,
    rejectedCount: series.length - valid.length,
    trajectory: valid.map((o) => ({ date: o.date, value: o.mean })),
  }
}

const ndvi = summarize(dailySeriesByIndex.ndvi)
const ndre = summarize(dailySeriesByIndex.ndre)
const ndwi = summarize(dailySeriesByIndex.ndwi)
const ndyi = summarize(dailySeriesByIndex.ndyi)
for (const [name, s] of [['NDVI', ndvi], ['NDRE', ndre], ['NDWI', ndwi], ['NDYI', ndyi]] as const) {
  console.log(`${name}: ${s.observationCount} valid obs (${s.rejectedCount} rejected), mean=${s.mean?.toFixed(4)} peak=${s.peak?.toFixed(4)} min=${s.min?.toFixed(4)}`)
}
console.log('\nNDVI full trajectory:')
for (const o of ndvi.trajectory) console.log(`  ${o.date.slice(0,10)}  ${o.value!.toFixed(4)}`)

const spectral = {
  ndviMean: ndvi.mean, ndviSlope: null, ndviPeakValue: ndvi.peak,
  ndreMean: ndre.mean, ndreSlope: null, ndrePeakValue: ndre.peak,
  ndwiMean: ndwi.mean, ndwiPeakValue: ndwi.peak,
  yellowIndexMean: ndyi.mean, yellowIndexSlope: null, yellowIndexPeakValue: ndyi.peak,
  observationCount: ndvi.observationCount,
}
const scored = scoreSunflowerLikeness(spectral)
console.log('\nscoreSunflowerLikeness():', JSON.stringify(scored))
const decision = decideSunflowerOverride({ amedTop: entry.nearestFieldAmedHypotheses.amedTop, amedIsCurrentlyObserved: entry.nearestFieldAmedHypotheses.amedIsCurrentlyObserved, likeness: 'available' in scored ? null : scored })
console.log('decideSunflowerOverride():', JSON.stringify(decision))

writeFileSync('scripts/datedCandidateFullResult.json', JSON.stringify({ fieldId: entry.nearestFieldId, window: { startDate, endDate }, processingUnitsSpent, indices: { ndvi, ndre, ndwi, ndyi }, spectral, scored, decision, amedHypotheses: entry.nearestFieldAmedHypotheses }, null, 2))
