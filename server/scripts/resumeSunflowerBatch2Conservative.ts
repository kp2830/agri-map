import 'dotenv/config'
import { readFileSync, writeFileSync } from 'node:fs'
import { CdseApiError, requestPolygonStatistics } from '../src/services/google/cdseClient.js'
import type { MultiPolygon } from 'geojson'

/**
 * Conservative resume of ONLY the 129 fields that failed with 429 RATE_LIMIT_EXCEEDED in the
 * prior batch-2 run (never re-queries the 116 fields that already succeeded, or the 30 pilot
 * fields). The prior run's throttling (1.2s/2s) worked for ~180 fields then hit a sustained-rate
 * limit -- this uses longer delays (3s between windows, 6s between fields) plus a single
 * backoff-and-retry on 429 (wait 30s, retry once) rather than giving up immediately.
 *
 * Run: npx tsx scripts/resumeSunflowerBatch2Conservative.ts
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function windowStatsWithBackoff(geometry: MultiPolygon, start: string, end: string) {
  try {
    return await callOnce(geometry, start, end)
  } catch (error) {
    if (error instanceof CdseApiError && error.status === 429) {
      console.log('    (429 hit, waiting 30s and retrying once)')
      await sleep(30000)
      return await callOnce(geometry, start, end) // let a second failure propagate
    }
    throw error
  }
}

async function callOnce(geometry: MultiPolygon, start: string, end: string) {
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

const OUT_PATH = '../training/sunflower/kurukshetra_karnal_batch2_results.json'

async function main() {
  const fields = JSON.parse(readFileSync('../training/sunflower/kurukshetra_karnal_batch2_selected_fields.json', 'utf-8')) as {
    id: string; geometry: MultiPolygon; properties: { areaSqM: number; classConfidence: number }; sourceCellTokens: string[]
  }[]

  const prior = JSON.parse(readFileSync(OUT_PATH, 'utf-8')) as { results: any[]; totalRealPuSpent: number }
  // Only fields with a real, successful prior result are "done" -- errored fields must be retried.
  const succeeded = prior.results.filter((r) => r.status === 'ok')
  const succeededIds = new Set(succeeded.map((r) => r.field_id))
  const remaining = fields.filter((f) => !succeededIds.has(f.id))

  console.log(`Already succeeded (kept, not re-queried): ${succeeded.length}`)
  console.log(`Resuming ${remaining.length} previously-failed fields, conservative throttling (3s/6s + 429 backoff).`)

  const results: any[] = [...succeeded]
  let totalPU = succeeded.reduce((s, r) => s + (r.real_pu_spent ?? 0), 0)
  let i = 0
  let consecutiveErrors = 0
  for (const f of remaining) {
    i++
    try {
      const april = await windowStatsWithBackoff(f.geometry, WINDOWS.april.start, WINDOWS.april.end)
      await sleep(3000)
      const may = await windowStatsWithBackoff(f.geometry, WINDOWS.may.start, WINDOWS.may.end)
      await sleep(3000)
      const june = await windowStatsWithBackoff(f.geometry, WINDOWS.june.start, WINDOWS.june.end)

      const pu = (april.processingUnitsSpent ?? 0) + (may.processingUnitsSpent ?? 0) + (june.processingUnitsSpent ?? 0)
      totalPU += pu
      const ndviApr = april.ndvi, ndviMay = may.ndvi, ndviJune = june.ndvi
      const baselineRulePass = ndviApr !== null && ndviJune !== null && ndviApr > 0.5 && ndviJune < 0.25

      results.push({
        field_id: f.id, source_cell: f.sourceCellTokens[0], area_sqm: f.properties.areaSqM, class_confidence: f.properties.classConfidence,
        geometry: f.geometry,
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
      consecutiveErrors = 0
      console.log(`[${i}/${remaining.length}] ${f.id}: apr=${ndviApr?.toFixed(3)} may=${ndviMay?.toFixed(3)} june=${ndviJune?.toFixed(3)} rule=${baselineRulePass} pu=${pu.toFixed(2)} (total ${totalPU.toFixed(1)})`)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      results.push({ field_id: f.id, source_cell: f.sourceCellTokens[0], area_sqm: f.properties.areaSqM, status: 'error', error: msg })
      consecutiveErrors++
      console.log(`[${i}/${remaining.length}] ${f.id}: ERROR ${msg}`)
      if (consecutiveErrors >= 5) {
        console.log('5 consecutive errors after backoff -- stopping early rather than burning through the rest against a still-active limit.')
        writeFileSync(OUT_PATH, JSON.stringify({ results, totalRealPuSpent: totalPU }, null, 2))
        process.exit(1)
      }
    }
    if (i % 10 === 0) writeFileSync(OUT_PATH, JSON.stringify({ results, totalRealPuSpent: totalPU }, null, 2))
    await sleep(6000)
  }

  writeFileSync(OUT_PATH, JSON.stringify({ results, totalRealPuSpent: totalPU }, null, 2))
  const okCount = results.filter((r) => r.status === 'ok').length
  console.log(`\nDONE. ${okCount}/${fields.length} succeeded overall. Total real PU spent: ${totalPU.toFixed(2)}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
