import 'dotenv/config'
import { readFileSync, writeFileSync } from 'node:fs'
import { requestPolygonStatistics } from '../src/services/google/cdseClient.js'
import type { MultiPolygon } from 'geojson'

/**
 * Round 3: real Apr/May/June Sentinel-2 feature extraction for the 250 newly-selected
 * Kurukshetra-Karnal round-3 fields. SAME 3 windows, SAME 13-feature schema, SAME CDSE client
 * as every prior round. Conservative throttling from the start this time (3s between windows,
 * 6s between fields) -- the rate that fully succeeded when resuming the 245-field round 2 batch
 * after the faster 1.2s/2s throttling hit sustained 429s partway through.
 *
 * Run: npx tsx scripts/extractHaryanaRound3Features.ts
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
const OUT_PATH = '../training/sunflower/haryana_round3_results.json'

async function main() {
  const fields = JSON.parse(readFileSync('../training/sunflower/haryana_round3_selected_250.json', 'utf-8')) as {
    id: string; geometry: MultiPolygon; properties: { areaSqM: number; classConfidence: number }; sourceCellToken: string
  }[]

  let results: any[] = []
  try {
    results = JSON.parse(readFileSync(OUT_PATH, 'utf-8')).results
    console.log(`Resuming: ${results.length} already recorded.`)
  } catch { /* fresh start */ }
  const done = new Set(results.filter((r) => r.status === 'ok').map((r) => r.field_id))
  const remaining = fields.filter((f) => !done.has(f.id))
  console.log(`Extracting ${remaining.length} remaining fields (of ${fields.length} total), conservative throttling.`)

  let totalPU = results.reduce((s, r) => s + (r.real_pu_spent ?? 0), 0)
  let consecutiveErrors = 0
  for (let i = 0; i < remaining.length; i++) {
    const f = remaining[i]
    try {
      const april = await requestPolygonStatistics(f.geometry, WINDOWS.april.start, WINDOWS.april.end)
      await sleep(3000)
      const may = await requestPolygonStatistics(f.geometry, WINDOWS.may.start, WINDOWS.may.end)
      await sleep(3000)
      const june = await requestPolygonStatistics(f.geometry, WINDOWS.june.start, WINDOWS.june.end)

      const pu = (april.processingUnitsSpent ?? 0) + (may.processingUnitsSpent ?? 0) + (june.processingUnitsSpent ?? 0)
      totalPU += pu
      const ndviApr = meanIgnoringNull(april.dailySeriesByIndex.ndvi.map((o) => o.mean))
      const ndviMay = meanIgnoringNull(may.dailySeriesByIndex.ndvi.map((o) => o.mean))
      const ndviJune = meanIgnoringNull(june.dailySeriesByIndex.ndvi.map((o) => o.mean))
      const baselineRulePass = ndviApr !== null && ndviJune !== null && ndviApr > 0.5 && ndviJune < 0.25

      const validObs = {
        april: april.dailySeriesByIndex.ndvi.filter((o) => o.mean !== null && !Number.isNaN(o.mean as number)).length,
        may: may.dailySeriesByIndex.ndvi.filter((o) => o.mean !== null && !Number.isNaN(o.mean as number)).length,
        june: june.dailySeriesByIndex.ndvi.filter((o) => o.mean !== null && !Number.isNaN(o.mean as number)).length,
      }
      const totalObs = {
        april: april.dailySeriesByIndex.ndvi.length, may: may.dailySeriesByIndex.ndvi.length, june: june.dailySeriesByIndex.ndvi.length,
      }

      results.push({
        field_id: f.id, source_cell: f.sourceCellToken, area_sqm: f.properties.areaSqM, class_confidence: f.properties.classConfidence,
        geometry: f.geometry,
        ndvi_apr: ndviApr, ndvi_may: ndviMay, ndvi_june: ndviJune,
        ndvi_apr_minus_june: ndviApr !== null && ndviJune !== null ? ndviApr - ndviJune : null,
        ndvi_may_minus_apr: ndviMay !== null && ndviApr !== null ? ndviMay - ndviApr : null,
        ndvi_may_minus_june: ndviMay !== null && ndviJune !== null ? ndviMay - ndviJune : null,
        ndre_apr: meanIgnoringNull(april.dailySeriesByIndex.ndre.map((o) => o.mean)),
        ndre_may: meanIgnoringNull(may.dailySeriesByIndex.ndre.map((o) => o.mean)),
        ndre_june: meanIgnoringNull(june.dailySeriesByIndex.ndre.map((o) => o.mean)),
        ndwi_apr: meanIgnoringNull(april.dailySeriesByIndex.ndwi.map((o) => o.mean)),
        ndwi_may: meanIgnoringNull(may.dailySeriesByIndex.ndwi.map((o) => o.mean)),
        ndwi_june: meanIgnoringNull(june.dailySeriesByIndex.ndwi.map((o) => o.mean)),
        ndyi_apr: meanIgnoringNull(april.dailySeriesByIndex.ndyi.map((o) => o.mean)),
        ndyi_may: meanIgnoringNull(may.dailySeriesByIndex.ndyi.map((o) => o.mean)),
        ndyi_june: meanIgnoringNull(june.dailySeriesByIndex.ndyi.map((o) => o.mean)),
        valid_obs_days: validObs, total_obs_days: totalObs,
        baseline_rule_pass: baselineRulePass, real_pu_spent: pu, status: 'ok',
      })
      consecutiveErrors = 0
      console.log(`[${i + 1}/${remaining.length}] ${f.id}: apr=${ndviApr?.toFixed(3)} may=${ndviMay?.toFixed(3)} june=${ndviJune?.toFixed(3)} rule=${baselineRulePass} pu=${pu.toFixed(2)} (total ${totalPU.toFixed(1)})`)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      results.push({ field_id: f.id, source_cell: f.sourceCellToken, area_sqm: f.properties.areaSqM, status: 'error', error: msg })
      consecutiveErrors++
      console.log(`[${i + 1}/${remaining.length}] ${f.id}: ERROR ${msg}`)
      if (consecutiveErrors >= 5) {
        console.log('5 consecutive errors -- stopping early.')
        writeFileSync(OUT_PATH, JSON.stringify({ results, totalRealPuSpent: totalPU }, null, 2))
        process.exit(1)
      }
    }
    if ((i + 1) % 10 === 0) writeFileSync(OUT_PATH, JSON.stringify({ results, totalRealPuSpent: totalPU }, null, 2))
    await sleep(6000)
  }

  writeFileSync(OUT_PATH, JSON.stringify({ results, totalRealPuSpent: totalPU }, null, 2))
  const okCount = results.filter((r) => r.status === 'ok').length
  console.log(`\nDONE. ${okCount}/${fields.length} succeeded. Total real PU spent: ${totalPU.toFixed(2)}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
