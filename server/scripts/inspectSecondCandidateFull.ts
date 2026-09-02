/**
 * ONE real live CDSE request for the second dated Indian sunflower candidate: iNaturalist
 * observation 56823200 (Helianthus annuus, Sindgi, Bijapur/Vijayapura district, Karnataka,
 * observed 2020-08-18, 5m GPS accuracy, 2 independent research-community species IDs,
 * community-consensus captive/cultivated=true), matched to real AMED field 7J8QXX3Q+HXVX
 * (40.3m from the documented point -- disclosed, not within the claimed 5m GPS accuracy, but
 * the nearest and most tractable of only 2 real candidate fields in range).
 *
 * Window: 2020-05-01 to 2020-11-01 (~184 days), bracketing the real documented observation date
 * -- a real Kharif-season window (sown ~Jun, flowering ~Aug matches real sunflower biology) --
 * NOT "today".
 *
 * Run: cd server && npx tsx scripts/inspectSecondCandidateFull.ts
 */
import 'dotenv/config'
import { readFileSync, writeFileSync } from 'node:fs'
import type { MultiPolygon } from 'geojson'
import { requestPolygonStatistics, type DailyObservation } from '../src/services/google/cdseClient.js'
import { scoreSunflowerLikeness } from '../src/services/agricultural/sunflower/likenessModel.js'
import { decideSunflowerOverride } from '../src/services/agricultural/sunflower/overridePolicy.js'
import { meanIgnoringNulls } from '../src/services/agricultural/sunflower/spectralIndices.js'

const search = JSON.parse(readFileSync('scripts/secondCandidateSearch.json', 'utf-8'))
const entry = search['Sindgi-Bijapur-iNat-56823200']

const startDate = '2020-05-01'
const endDate = '2020-11-01'

console.log(`Field ${entry.nearestFieldId}, ${entry.nearestFieldDistanceM.toFixed(1)}m from documented sunflower observation, area=${entry.nearestFieldAreaSqM.toFixed(1)}sqm (~${(entry.nearestFieldAreaSqM/100).toFixed(1)} native px)`)
console.log(`Real AMED result: ${JSON.stringify(entry.nearestFieldAmedHypotheses)}`)
console.log(`Window: ${startDate} to ${endDate} (brackets real documented observation date 2020-08-18)`)

const t0 = Date.now()
const { dailySeriesByIndex, processingUnitsSpent } = await requestPolygonStatistics(entry.nearestFieldGeometry as MultiPolygon, startDate, endDate)
console.log(`Real CDSE request completed in ${Date.now() - t0}ms. Real PU spent: ${processingUnitsSpent}`)

function summarize(series: DailyObservation[]) {
  const valid = series.filter((o) => o.mean !== null)
  const values = valid.map((o) => o.mean as number)
  return {
    mean: meanIgnoringNulls(values), peak: values.length ? Math.max(...values) : null, min: values.length ? Math.min(...values) : null,
    observationCount: valid.length, rejectedCount: series.length - valid.length,
    trajectory: valid.map((o) => ({ date: o.date, value: o.mean })),
  }
}
const ndvi = summarize(dailySeriesByIndex.ndvi)
const ndre = summarize(dailySeriesByIndex.ndre)
const ndwi = summarize(dailySeriesByIndex.ndwi)
const ndyi = summarize(dailySeriesByIndex.ndyi)
for (const [name, s] of [['NDVI', ndvi], ['NDRE', ndre], ['NDWI', ndwi], ['NDYI', ndyi]] as const) {
  console.log(`${name}: ${s.observationCount} valid obs (${s.rejectedCount} rejected), mean=${s.mean?.toFixed(4)} peak=${s.peak?.toFixed(4)}`)
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
console.log('\nscoreSunflowerLikeness() [fixed full-window production]:', JSON.stringify(scored))
const decision = decideSunflowerOverride({ amedTop: entry.nearestFieldAmedHypotheses.amedTop, amedIsCurrentlyObserved: entry.nearestFieldAmedHypotheses.amedIsCurrentlyObserved, likeness: 'available' in scored ? null : scored })
console.log('decideSunflowerOverride():', JSON.stringify(decision))

writeFileSync('scripts/secondCandidateFullResult.json', JSON.stringify({ fieldId: entry.nearestFieldId, window: { startDate, endDate }, processingUnitsSpent, indices: { ndvi, ndre, ndwi, ndyi }, spectral, scored, decision, amedHypotheses: entry.nearestFieldAmedHypotheses }, null, 2))
