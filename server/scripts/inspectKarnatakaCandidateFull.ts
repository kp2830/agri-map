/**
 * ONE real live CDSE request for the known Karnataka sunflower candidate (field 7J3RQJCW+F4WP,
 * 18m from the decoded QJQJ+CW / Suryakhami / Bheemanabeedu location — established in the prior
 * session's real ALU/AMED search, not invented here), capturing the FULL per-index daily
 * trajectory (not just the aggregate likeness the production endpoint returns) by calling the
 * exact same underlying requestPolygonStatistics() the production path uses — not a duplicate
 * implementation, just a fuller capture of its real output for this one investigation.
 *
 * Everything downstream of the one network call (aggregation, scoring, override decision) reuses
 * the real production functions verbatim (aggregateIndex's logic is mirrored inline since it is
 * not exported from featureExtraction.ts; scoreSunflowerLikeness/decideSunflowerOverride are
 * imported directly, unmodified).
 *
 * Run: cd server && npx tsx scripts/inspectKarnatakaCandidateFull.ts
 */
import 'dotenv/config'
import { readFileSync, writeFileSync } from 'node:fs'
import type { MultiPolygon } from 'geojson'
import { requestPolygonStatistics, type DailyObservation } from '../src/services/google/cdseClient.js'
import { buildAmedHypotheses } from '../src/services/agricultural/sunflower/amedHypotheses.js'
import { scoreSunflowerLikeness } from '../src/services/agricultural/sunflower/likenessModel.js'
import { decideSunflowerOverride } from '../src/services/agricultural/sunflower/overridePolicy.js'
import { meanIgnoringNulls } from '../src/services/agricultural/sunflower/spectralIndices.js'
import type { NormalizedFieldFeature } from '../src/types/agricultural.js'

const field = JSON.parse(readFileSync(new URL('./karnatakaTestField.json', import.meta.url), 'utf-8')) as NormalizedFieldFeature

const LIVE_EXTRACTION_WINDOW_DAYS = 183 // matches featureExtraction.ts exactly
const end = new Date()
const start = new Date(end.getTime() - LIVE_EXTRACTION_WINDOW_DAYS * 24 * 60 * 60 * 1000)
const startDate = start.toISOString().slice(0, 10)
const endDate = end.toISOString().slice(0, 10)

console.log(`=== Field ${String(field.id)} — real geometry, real AMED properties ===`)
console.log(`Requested window: ${startDate} to ${endDate} (${LIVE_EXTRACTION_WINDOW_DAYS} days, matches the production live-extraction window exactly)`)

const hyp = buildAmedHypotheses(field.properties)
console.log(`\nReal current AMED result: ${JSON.stringify(hyp)}`)

console.log('\n--- Making the ONE real live CDSE Statistical API request ---')
const t0 = Date.now()
const { dailySeriesByIndex, processingUnitsSpent } = await requestPolygonStatistics(field.geometry as MultiPolygon, startDate, endDate)
const elapsedMs = Date.now() - t0
console.log(`Request completed in ${elapsedMs}ms. Real PU spent: ${processingUnitsSpent}`)

function summarize(indexName: string, series: DailyObservation[]) {
  const valid = series.filter((o) => o.mean !== null)
  const rejected = series.length - valid.length
  const values = valid.map((o) => o.mean as number)
  const mean = meanIgnoringNulls(values)
  const peak = values.length > 0 ? Math.max(...values) : null
  const min = values.length > 0 ? Math.min(...values) : null
  const dates = valid.map((o) => o.date)
  console.log(`\n${indexName.toUpperCase()}: ${valid.length} real valid observations (${rejected} rejected/cloud-masked of ${series.length} total)`)
  console.log(`  date range of valid obs: ${dates[0] ?? 'n/a'} .. ${dates[dates.length - 1] ?? 'n/a'}`)
  console.log(`  mean=${mean?.toFixed(4)}  peak=${peak?.toFixed(4)}  min=${min?.toFixed(4)}`)
  console.log('  full real trajectory:')
  for (const o of valid) console.log(`    ${o.date.slice(0, 10)}  ${o.mean!.toFixed(4)}`)
  return { mean, peak, min, observationCount: valid.length, rejectedCount: rejected, trajectory: valid.map((o) => ({ date: o.date, value: o.mean })) }
}

const ndvi = summarize('ndvi', dailySeriesByIndex.ndvi)
const ndre = summarize('ndre', dailySeriesByIndex.ndre)
const ndwi = summarize('ndwi', dailySeriesByIndex.ndwi)
const ndyi = summarize('ndyi', dailySeriesByIndex.ndyi)

const spectral = {
  ndviMean: ndvi.mean, ndviSlope: null, ndviPeakValue: ndvi.peak,
  ndreMean: ndre.mean, ndreSlope: null, ndrePeakValue: ndre.peak,
  ndwiMean: ndwi.mean, ndwiPeakValue: ndwi.peak,
  yellowIndexMean: ndyi.mean, yellowIndexSlope: null, yellowIndexPeakValue: ndyi.peak,
  observationCount: ndvi.observationCount,
}

console.log('\n--- Scoring via the real production scoreSunflowerLikeness() ---')
const scored = scoreSunflowerLikeness(spectral)
console.log(JSON.stringify(scored, null, 2))

console.log('\n--- Real production decideSunflowerOverride() ---')
const decision = decideSunflowerOverride({ amedTop: hyp.amedTop, amedIsCurrentlyObserved: hyp.amedIsCurrentlyObserved, likeness: 'available' in scored ? null : scored })
console.log(JSON.stringify(decision, null, 2))

writeFileSync(
  new URL('./karnatakaCandidateFullResult.json', import.meta.url),
  JSON.stringify({ fieldId: field.id, window: { startDate, endDate }, processingUnitsSpent, amedHypotheses: hyp, indices: { ndvi, ndre, ndwi, ndyi }, spectral, scored, decision }, null, 2),
)
console.log('\nWrote scripts/karnatakaCandidateFullResult.json')
