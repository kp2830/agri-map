import 'dotenv/config'
import { readFileSync, writeFileSync } from 'node:fs'
import { requestPolygonStatistics } from '../src/services/google/cdseClient.js'
import { predictSunflowerProbability } from '../src/services/agricultural/sunflowerRf/rfInference.js'
import { toOrderedVector, type SunflowerRfFeatures } from '../src/services/agricultural/sunflowerRf/featureExtraction.js'
import { FEATURE_WINDOWS } from '../src/services/agricultural/sunflowerRf/config.js'
import { buildAmedHypotheses } from '../src/services/agricultural/sunflower/amedHypotheses.js'
import type { MultiPolygon } from 'geojson'
import type { NormalizedFieldProperties } from '../src/types/agricultural.js'

/**
 * v0 validation batch: real Sunflower RF v0 predictions (SAME model, SAME feature extraction
 * used in production -- server/src/services/agricultural/sunflowerRf/) on 40 NEW Haryana fields
 * never seen during training/testing. No retraining. Throttled the same way the earlier
 * rate-limit-safe batch was (3s/6s gaps).
 *
 * Run: npx tsx scripts/testNewHaryanaFieldsRf.ts
 */

function meanIgnoringNull(values: (number | null)[]): number | null {
  const valid = values.filter((v): v is number => v !== null && !Number.isNaN(v))
  if (valid.length === 0) return null
  return valid.reduce((a, b) => a + b, 0) / valid.length
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function extractFeatures(geometry: MultiPolygon): Promise<SunflowerRfFeatures> {
  const april = await requestPolygonStatistics(geometry, FEATURE_WINDOWS.april.start, FEATURE_WINDOWS.april.end)
  await sleep(3000)
  const may = await requestPolygonStatistics(geometry, FEATURE_WINDOWS.may.start, FEATURE_WINDOWS.may.end)
  await sleep(3000)
  const june = await requestPolygonStatistics(geometry, FEATURE_WINDOWS.june.start, FEATURE_WINDOWS.june.end)

  const ndviApr = meanIgnoringNull(april.dailySeriesByIndex.ndvi.map((o) => o.mean))
  const ndviMay = meanIgnoringNull(may.dailySeriesByIndex.ndvi.map((o) => o.mean))
  const ndviJune = meanIgnoringNull(june.dailySeriesByIndex.ndvi.map((o) => o.mean))
  return {
    ndvi_apr: ndviApr, ndvi_may: ndviMay, ndvi_june: ndviJune,
    ndvi_apr_june_change: ndviApr !== null && ndviJune !== null ? ndviApr - ndviJune : null,
    ndre_apr: meanIgnoringNull(april.dailySeriesByIndex.ndre.map((o) => o.mean)),
    ndre_may: meanIgnoringNull(may.dailySeriesByIndex.ndre.map((o) => o.mean)),
    ndre_june: meanIgnoringNull(june.dailySeriesByIndex.ndre.map((o) => o.mean)),
    ndwi_apr: meanIgnoringNull(april.dailySeriesByIndex.ndwi.map((o) => o.mean)),
    ndwi_may: meanIgnoringNull(may.dailySeriesByIndex.ndwi.map((o) => o.mean)),
    ndwi_june: meanIgnoringNull(june.dailySeriesByIndex.ndwi.map((o) => o.mean)),
    ndyi_apr: meanIgnoringNull(april.dailySeriesByIndex.ndyi.map((o) => o.mean)),
    ndyi_may: meanIgnoringNull(may.dailySeriesByIndex.ndyi.map((o) => o.mean)),
    ndyi_june: meanIgnoringNull(june.dailySeriesByIndex.ndyi.map((o) => o.mean)),
  }
}

function centroid(geometry: MultiPolygon): { lat: number; lng: number } {
  const coords = geometry.coordinates[0][0]
  const lats = coords.map((c) => c[1])
  const lngs = coords.map((c) => c[0])
  return { lat: lats.reduce((a, b) => a + b, 0) / lats.length, lng: lngs.reduce((a, b) => a + b, 0) / lngs.length }
}

const OUT_PATH = '../training/sunflower/haryana_new_fields_rf_results.json'

async function main() {
  const fields = JSON.parse(readFileSync('../training/sunflower/haryana_new_fields_selected_40.json', 'utf-8')) as {
    id: string; geometry: MultiPolygon; properties: NormalizedFieldProperties; sourceCellToken: string
  }[]

  let results: any[] = []
  try {
    results = JSON.parse(readFileSync(OUT_PATH, 'utf-8')).results
    console.log(`Resuming: ${results.length} already done.`)
  } catch { /* fresh start */ }
  const done = new Set(results.filter((r) => r.status === 'ok').map((r) => r.field_id))
  const remaining = fields.filter((f) => !done.has(f.id))
  console.log(`Testing ${remaining.length} remaining fields (of ${fields.length} total).`)

  for (let i = 0; i < remaining.length; i++) {
    const f = remaining[i]
    const { lat, lng } = centroid(f.geometry)
    const { amedTop } = buildAmedHypotheses(f.properties)
    try {
      const features = await extractFeatures(f.geometry)
      const ordered = toOrderedVector(features)
      let sunflowerProbability: number | null = null
      if (!ordered.some((v) => v === null)) {
        sunflowerProbability = predictSunflowerProbability(ordered as number[])
      }
      results.push({
        field_id: f.id, lat, lng, source_cell: f.sourceCellToken, area_sqm: f.properties.areaSqM,
        amed_crop: amedTop?.crop ?? null, amed_confidence: amedTop?.confidence ?? null,
        features, sunflower_probability: sunflowerProbability,
        sunflower_probability_percent: sunflowerProbability !== null ? Math.round(sunflowerProbability * 100) : null,
        model_version: 'sunflower-rf-v0', status: 'ok',
      })
      console.log(`[${i + 1}/${remaining.length}] ${f.id} amed=${amedTop?.crop ?? 'none'}(${amedTop?.confidence ?? 'n/a'}) sunflower_rf=${sunflowerProbability !== null ? (sunflowerProbability * 100).toFixed(1) + '%' : 'unavailable'}`)
    } catch (error) {
      results.push({ field_id: f.id, lat, lng, source_cell: f.sourceCellToken, status: 'error', error: error instanceof Error ? error.message : String(error) })
      console.log(`[${i + 1}/${remaining.length}] ${f.id} ERROR: ${error instanceof Error ? error.message : error}`)
    }
    if ((i + 1) % 10 === 0) writeFileSync(OUT_PATH, JSON.stringify({ results }, null, 2))
    await sleep(6000)
  }

  writeFileSync(OUT_PATH, JSON.stringify({ results }, null, 2))
  console.log(`\nDONE. ${results.filter((r) => r.status === 'ok').length}/${fields.length} succeeded.`)
}

main().catch((e) => { console.error(e); process.exit(1) })
