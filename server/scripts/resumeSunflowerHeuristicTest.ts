import 'dotenv/config'
import { readFileSync, writeFileSync } from 'node:fs'
import { requestPolygonStatistics } from '../src/services/google/cdseClient.js'
import type { MultiPolygon } from 'geojson'

/**
 * Resumes the 30-field April/June heuristic test after hitting CDSE's real rate limit
 * (429 RATE_LIMIT_EXCEEDED) partway through — only re-queries fields that errored, throttled
 * with a real delay between fields (the original run fired 3 concurrent calls per field with
 * zero delay between fields, which is what tripped the limit around field #9). Does NOT re-spend
 * PU on the 8 fields that already succeeded.
 *
 * Run: npx tsx scripts/resumeSunflowerHeuristicTest.ts
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const allFields = JSON.parse(readFileSync('../training/sunflower/kurukshetra_karnal_satellite_test_30_fields.json', 'utf-8')) as {
    id: string; geometry: MultiPolygon; properties: { areaSqM: number; classConfidence: number }
  }[]
  const prior = JSON.parse(readFileSync('../training/sunflower/kurukshetra_karnal_april_june_heuristic_test.json', 'utf-8')) as { results: any[]; totalRealPuSpent: number }

  const succeeded = new Map(prior.results.filter((r) => r.status === 'ok').map((r) => [r.field_id, r]))
  const toRetry = allFields.filter((f) => !succeeded.has(f.id))
  console.log(`Already succeeded: ${succeeded.size}. Retrying ${toRetry.length} fields, serialized with 3s gaps between fields and 1s gaps between windows within a field.`)

  const newResults: any[] = [...succeeded.values()]
  let totalPU = prior.totalRealPuSpent
  let i = 0
  for (const f of toRetry) {
    i++
    try {
      const april = await windowStats(f.geometry, WINDOWS.april.start, WINDOWS.april.end)
      await sleep(1200)
      const may = await windowStats(f.geometry, WINDOWS.may.start, WINDOWS.may.end)
      await sleep(1200)
      const june = await windowStats(f.geometry, WINDOWS.june.start, WINDOWS.june.end)

      const pu = (april.processingUnitsSpent ?? 0) + (may.processingUnitsSpent ?? 0) + (june.processingUnitsSpent ?? 0)
      totalPU += pu
      const ndviApr = april.ndvi, ndviMay = may.ndvi, ndviJune = june.ndvi
      const baselineRulePass = ndviApr !== null && ndviJune !== null && ndviApr > 0.5 && ndviJune < 0.25

      newResults.push({
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
        baseline_rule_pass: baselineRulePass, real_pu_spent: pu, status: 'ok',
      })
      console.log(`[${i}/${toRetry.length}] ${f.id}: NDVI apr=${ndviApr?.toFixed(3)} may=${ndviMay?.toFixed(3)} june=${ndviJune?.toFixed(3)} rule=${baselineRulePass} pu=${pu.toFixed(2)}`)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      newResults.push({ field_id: f.id, area_sqm: f.properties.areaSqM, status: 'error', error: msg })
      console.log(`[${i}/${toRetry.length}] ${f.id}: ERROR ${msg}`)
    }
    await sleep(2000)
  }

  writeFileSync('../training/sunflower/kurukshetra_karnal_april_june_heuristic_test.json', JSON.stringify({ results: newResults, totalRealPuSpent: totalPU }, null, 2))
  console.log(`\nTotal real PU spent (cumulative): ${totalPU.toFixed(2)}`)
  const okCount = newResults.filter((r) => r.status === 'ok').length
  console.log(`Final: ${okCount}/${allFields.length} fields succeeded.`)
}

main().catch((e) => { console.error(e); process.exit(1) })
