import 'dotenv/config'
import { readFileSync, writeFileSync } from 'node:fs'
import { requestPolygonStatistics } from '../src/services/google/cdseClient.js'
import type { MultiPolygon } from 'geojson'

/**
 * Batch 2: extracts real April/May/June Sentinel-2 NDVI/NDRE/NDWI/NDYI for the 245 newly
 * selected Kurukshetra-Karnal fields (training/sunflower/kurukshetra_karnal_batch2_selected_fields.json),
 * using the SAME throttling that fixed the rate-limit hit in the 30-field test (1.2s between
 * windows within a field, 2s between fields). Saves incrementally so a crash/interrupt doesn't
 * lose completed work.
 *
 * Run: npx tsx scripts/extractSunflowerBatch2.ts
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
const OUT_PATH = '../training/sunflower/kurukshetra_karnal_batch2_results.json'

async function main() {
  const fields = JSON.parse(readFileSync('../training/sunflower/kurukshetra_karnal_batch2_selected_fields.json', 'utf-8')) as {
    id: string; geometry: MultiPolygon; properties: { areaSqM: number; classConfidence: number }; sourceCellTokens: string[]
  }[]

  let results: any[] = []
  try {
    results = JSON.parse(readFileSync(OUT_PATH, 'utf-8')).results
    console.log(`Resuming: ${results.length} fields already done.`)
  } catch { /* fresh start */ }
  const done = new Set(results.map((r) => r.field_id))
  const remaining = fields.filter((f) => !done.has(f.id))

  console.log(`Extracting ${remaining.length} remaining fields (of ${fields.length} total).`)
  let totalPU = results.reduce((s, r) => s + (r.real_pu_spent ?? 0), 0)
  let i = 0
  for (const f of remaining) {
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
      console.log(`[${i}/${remaining.length}] ${f.id}: apr=${ndviApr?.toFixed(3)} may=${ndviMay?.toFixed(3)} june=${ndviJune?.toFixed(3)} rule=${baselineRulePass} pu=${pu.toFixed(2)} (total ${totalPU.toFixed(1)})`)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      results.push({ field_id: f.id, source_cell: f.sourceCellTokens[0], area_sqm: f.properties.areaSqM, status: 'error', error: msg })
      console.log(`[${i}/${remaining.length}] ${f.id}: ERROR ${msg}`)
    }
    if (i % 10 === 0) writeFileSync(OUT_PATH, JSON.stringify({ results, totalRealPuSpent: totalPU }, null, 2))
    await sleep(2000)
  }

  writeFileSync(OUT_PATH, JSON.stringify({ results, totalRealPuSpent: totalPU }, null, 2))
  const okCount = results.filter((r) => r.status === 'ok').length
  console.log(`\nDONE. ${okCount}/${fields.length} succeeded. Total real PU spent: ${totalPU.toFixed(2)}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
