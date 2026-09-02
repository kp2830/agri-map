import 'dotenv/config'
import { readFileSync, writeFileSync } from 'node:fs'
import { requestPolygonStatistics } from '../src/services/google/cdseClient.js'
import type { MultiPolygon } from 'geojson'

/**
 * Real Sentinel-2/CDSE test of the co-founder's April-green -> June-brown heuristic against 30
 * real ALU field polygons discovered in the Kurukshetra-Karnal stratified ALU sampling pass
 * (training/sunflower/kurukshetra_karnal_satellite_test_30_fields.json). Uses the existing,
 * proven requestPolygonStatistics (real NDVI/NDRE/NDWI/NDYI, native resolution, SCL cloud
 * masking) -- no new satellite client. 3 real CDSE calls per field (Apr 15-30, May 1-20,
 * Jun 1-15, 2026) = 90 real calls total.
 *
 * Run: npx tsx scripts/testSunflowerAprilJuneHeuristic.ts
 */

const WINDOWS = {
  april: { start: '2026-04-15', end: '2026-04-30' },
  may: { start: '2026-05-01', end: '2026-05-20' },
  june: { start: '2026-06-01', end: '2026-06-15' },
} as const

function meanIgnoringNull(values: (number | null)[]): number | null {
  const valid = values.filter((v): v is number => v !== null && !Number.isNaN(v))
  if (valid.length === 0) return null
  return valid.reduce((a, b) => a + b, 0) / valid.length
}

async function windowStats(geometry: MultiPolygon, start: string, end: string) {
  const result = await requestPolygonStatistics(geometry, start, end)
  return {
    ndvi: meanIgnoringNull(result.dailySeriesByIndex.ndvi.map((o) => o.mean)),
    ndre: meanIgnoringNull(result.dailySeriesByIndex.ndre.map((o) => o.mean)),
    ndwi: meanIgnoringNull(result.dailySeriesByIndex.ndwi.map((o) => o.mean)),
    ndyi: meanIgnoringNull(result.dailySeriesByIndex.ndyi.map((o) => o.mean)),
    observationDays: result.dailySeriesByIndex.ndvi.length,
    validObservationDays: result.dailySeriesByIndex.ndvi.filter((o) => o.mean !== null && !Number.isNaN(o.mean as number)).length,
    processingUnitsSpent: result.processingUnitsSpent,
  }
}

async function main() {
  const fields = JSON.parse(readFileSync('../training/sunflower/kurukshetra_karnal_satellite_test_30_fields.json', 'utf-8')) as {
    id: string
    geometry: MultiPolygon
    properties: { areaSqM: number; classConfidence: number }
  }[]

  console.log(`Testing April/May/June heuristic on ${fields.length} real fields (3 CDSE calls each = ${fields.length * 3} total calls).`)

  const results: any[] = []
  let totalPU = 0
  let i = 0
  for (const f of fields) {
    i++
    try {
      const [april, may, june] = await Promise.all([
        windowStats(f.geometry, WINDOWS.april.start, WINDOWS.april.end),
        windowStats(f.geometry, WINDOWS.may.start, WINDOWS.may.end),
        windowStats(f.geometry, WINDOWS.june.start, WINDOWS.june.end),
      ])
      const pu = (april.processingUnitsSpent ?? 0) + (may.processingUnitsSpent ?? 0) + (june.processingUnitsSpent ?? 0)
      totalPU += pu

      const ndviApr = april.ndvi
      const ndviMay = may.ndvi
      const ndviJune = june.ndvi
      const baselineRulePass = ndviApr !== null && ndviJune !== null && ndviApr > 0.5 && ndviJune < 0.25

      results.push({
        field_id: f.id, area_sqm: f.properties.areaSqM, class_confidence: f.properties.classConfidence,
        ndvi_apr: ndviApr, ndvi_may: ndviMay, ndvi_june: ndviJune,
        ndvi_apr_minus_june: ndviApr !== null && ndviJune !== null ? ndviApr - ndviJune : null,
        ndvi_may_minus_apr: ndviMay !== null && ndviApr !== null ? ndviMay - ndviApr : null,
        ndvi_may_minus_june: ndviMay !== null && ndviJune !== null ? ndviMay - ndviJune : null,
        ndre_apr: april.ndre, ndre_may: may.ndre, ndre_june: june.ndre,
        ndwi_apr: april.ndwi, ndwi_may: may.ndwi, ndwi_june: june.ndwi,
        ndyi_apr: april.ndyi, ndyi_may: may.ndyi, ndyi_june: june.ndyi,
        valid_obs_days: { april: april.validObservationDays, may: may.validObservationDays, june: june.validObservationDays },
        total_obs_days: { april: april.observationDays, may: may.observationDays, june: june.observationDays },
        baseline_rule_pass: baselineRulePass,
        real_pu_spent: pu,
        status: 'ok',
      })
      console.log(`[${i}/${fields.length}] ${f.id}: NDVI apr=${ndviApr?.toFixed(3)} may=${ndviMay?.toFixed(3)} june=${ndviJune?.toFixed(3)} rule=${baselineRulePass} pu=${pu.toFixed(2)}`)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      results.push({ field_id: f.id, area_sqm: f.properties.areaSqM, status: 'error', error: msg })
      console.log(`[${i}/${fields.length}] ${f.id}: ERROR ${msg}`)
    }
  }

  writeFileSync('../training/sunflower/kurukshetra_karnal_april_june_heuristic_test.json', JSON.stringify({ results, totalRealPuSpent: totalPU }, null, 2))
  console.log(`\nTotal real PU spent this test: ${totalPU.toFixed(2)}`)
  console.log('Saved training/sunflower/kurukshetra_karnal_april_june_heuristic_test.json')
}

main().catch((e) => { console.error(e); process.exit(1) })
