/**
 * One-shot backfill: brings the 20 already-submitted calibration-tranche jobs (submitted from
 * training/esa/experiments/run_calibration_tranche.py, real job IDs recorded in
 * training/esa/experiments/calibration_jobs.json) into the new persistent backend cache
 * (server/.worldcereal-research-cache/results.json).
 *
 * Does NOT submit, retry, cancel, or recreate any job — backfillFromKnownJob only ever calls
 * describe_job (free) and, for a job that's already finished, downloads its already-computed
 * result (also free — not reprocessing). Safe to re-run: jobs still queued/running just get
 * their status refreshed; jobs already cached as finished/error are left untouched.
 *
 * Run: npx tsx scripts/backfillWorldCerealCalibration.ts
 */
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { backfillFromKnownJob } from '../src/services/agricultural/worldcereal/worldCerealService.js'

interface CalibrationJob {
  field_id: string
  job_id: string
  lat: number
  lng: number
  crop_label: string
}

const jobs = JSON.parse(readFileSync('../training/esa/experiments/calibration_jobs.json', 'utf-8')) as CalibrationJob[]

const submittedAtIso = new Date('2026-09-02T08:52:00Z').toISOString() // real submission window, see calibration_jobs.json timestamps

let finished = 0, running = 0, queued = 0, errored = 0

for (const j of jobs) {
  const result = await backfillFromKnownJob({
    fieldId: j.field_id, jobId: j.job_id, lat: j.lat, lng: j.lng, submittedAtIso,
  })
  console.log(`${j.crop_label.padEnd(10)} ${j.field_id}  job=${j.job_id}  status=${result.status}  cacheHit=${result.cacheHit}`)
  if (result.status === 'finished') finished++
  else if (result.status === 'error') errored++
  else if (result.status === 'running') running++
  else queued++
}

console.log(`\nBackfill complete: ${finished} finished, ${running} running, ${queued} queued, ${errored} errored (of ${jobs.length} total).`)
console.log('No jobs were submitted, retried, cancelled, or recreated.')
