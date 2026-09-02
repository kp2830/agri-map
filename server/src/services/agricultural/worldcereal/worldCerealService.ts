/**
 * Orchestrates the real WorldCereal research pipeline: check the persistent cache first, submit
 * a real job only if nothing usable is already cached/in-flight, poll, download, decode, cache.
 * This is the module the isolated /research/worldcereal routes call — never imported from the
 * production /agriculture/fields path. See config.ts for the feature flag.
 */
import { unlink } from 'node:fs/promises'
import { WORLDCEREAL_MODEL_VERSION, DEFAULT_INDIA_SEASON, FIELD_BBOX_BUFFER_DEGREES } from './config.js'
import { decodeWorldCerealGeoTiff } from './geotiffDecoder.js'
import {
  buildCacheKey, getCachedRecord, getCachedRecordByFieldId, saveRecord, tifCachePathForJob,
  type CachedWorldCerealRecord,
} from './resultStore.js'
import { describeWorldCerealJob, downloadWorldCerealResult, submitWorldCerealJob } from './openeoClient.js'
import type { WorldCerealResult } from './types.js'

export interface FieldRequest {
  fieldId: string
  lat: number
  lng: number
  geometryHash?: string | null
}

export interface TriggerResult {
  cacheKey: string
  jobId: string
  cacheHit: boolean
  status: CachedWorldCerealRecord['status']
  result: WorldCerealResult | null
}

/**
 * In-process submission lock: if two requests for the same field arrive close together (e.g.
 * two users clicking the same unprocessed field, or a client double-firing a click), only the
 * first actually submits a job — the second awaits the same in-flight promise and gets back the
 * job the first one created. This only protects a single Node process; if this integration is
 * ever run as multiple server instances, the file store's read-then-write is not itself atomic
 * across processes and would need a real distributed lock (e.g. a DB unique constraint) instead.
 */
const inFlightSubmissions = new Map<string, Promise<CachedWorldCerealRecord>>()

/** Read-only: whatever is currently cached for this field, without contacting CDSE at all. Safe
 *  to call as often as needed (e.g. every GET /research/worldcereal/:fieldId) — never triggers a
 *  job, never spends credits, never polls. */
export async function getCachedResultForField(fieldId: string): Promise<CachedWorldCerealRecord | null> {
  return getCachedRecordByFieldId(fieldId)
}

/**
 * Check-cache-or-submit. Real CDSE interaction happens only here, and only in these cases:
 *  - no record exists for this field+season+model at all -> submits a new job (credits spent)
 *  - a record exists with a job that hasn't resolved yet -> ONE describe_job call to refresh
 *    status (free) and, if it just finished, download+decode+persist the result (also free —
 *    downloading an already-completed job's output is not reprocessing)
 *  - a record already has a finished/error result -> returns it immediately, zero CDSE calls
 */
export async function getOrSubmitWorldCerealJob(request: FieldRequest, signal?: AbortSignal): Promise<TriggerResult> {
  const cacheKey = buildCacheKey(request.fieldId, DEFAULT_INDIA_SEASON.start, DEFAULT_INDIA_SEASON.end, WORLDCEREAL_MODEL_VERSION)

  const existing = await getCachedRecord(cacheKey)
  if (existing) {
    return await refreshIfPending(existing, signal)
  }

  // Nothing cached yet -- serialize submission for this exact key so concurrent requests for
  // the same never-before-seen field only submit one real job.
  const inFlight = inFlightSubmissions.get(cacheKey)
  if (inFlight) {
    const record = await inFlight
    return toTriggerResult(record, true)
  }

  const submission = (async (): Promise<CachedWorldCerealRecord> => {
    // Double-check after any await above, in case another call raced us to this point before
    // the lock was registered — never submit twice for the same key.
    const recheck = await getCachedRecord(cacheKey)
    if (recheck) return recheck

    const jobId = await submitWorldCerealJob({
      lat: request.lat, lng: request.lng, bufferDegrees: FIELD_BBOX_BUFFER_DEGREES,
      season: DEFAULT_INDIA_SEASON, title: `agrimap-research-${request.fieldId}`, signal,
    })
    const record: CachedWorldCerealRecord = {
      cacheKey, fieldId: request.fieldId, geometryHash: request.geometryHash ?? null,
      lat: request.lat, lng: request.lng, modelVersion: WORLDCEREAL_MODEL_VERSION,
      seasonStart: DEFAULT_INDIA_SEASON.start, seasonEnd: DEFAULT_INDIA_SEASON.end,
      jobId, status: 'queued',
      submittedAtIso: new Date().toISOString(), startedAtIso: null, completedAtIso: null,
      backendProcessingDurationSeconds: null, realCreditsSpent: null,
      result: null, resultTimestampIso: null,
    }
    await saveRecord(record)
    return record
  })()

  inFlightSubmissions.set(cacheKey, submission)
  try {
    const record = await submission
    return toTriggerResult(record, false)
  } finally {
    inFlightSubmissions.delete(cacheKey)
  }
}

export interface BackfillRequest extends FieldRequest {
  /** A job ID that was ALREADY submitted outside this service (e.g. the manual 20-field
   *  calibration tranche run from training/esa/) — never calls submitWorldCerealJob. Used to
   *  bring an already-real, already-billed job's result into the persistent cache without
   *  resubmitting or duplicating it. */
  jobId: string
  submittedAtIso: string
}

/** Registers (if not already present) a record for a job that was submitted OUTSIDE this
 *  service, then does exactly one describe_job refresh — same real, no-resubmission semantics
 *  as refreshIfPending. Never calls submitWorldCerealJob. Safe to call repeatedly (idempotent
 *  once the job resolves to finished/error). */
export async function backfillFromKnownJob(request: BackfillRequest, signal?: AbortSignal): Promise<TriggerResult> {
  const cacheKey = buildCacheKey(request.fieldId, DEFAULT_INDIA_SEASON.start, DEFAULT_INDIA_SEASON.end, WORLDCEREAL_MODEL_VERSION)
  let record = await getCachedRecord(cacheKey)
  if (!record) {
    record = {
      cacheKey, fieldId: request.fieldId, geometryHash: request.geometryHash ?? null,
      lat: request.lat, lng: request.lng, modelVersion: WORLDCEREAL_MODEL_VERSION,
      seasonStart: DEFAULT_INDIA_SEASON.start, seasonEnd: DEFAULT_INDIA_SEASON.end,
      jobId: request.jobId, status: 'queued',
      submittedAtIso: request.submittedAtIso, startedAtIso: null, completedAtIso: null,
      backendProcessingDurationSeconds: null, realCreditsSpent: null,
      result: null, resultTimestampIso: null,
    }
    await saveRecord(record)
  }
  return refreshIfPending(record, signal)
}

/** If a record's job hasn't resolved yet, does exactly ONE describe_job call to refresh it —
 *  never a polling loop. Persists the result the first time it observes "finished"/"error". */
async function refreshIfPending(record: CachedWorldCerealRecord, signal?: AbortSignal): Promise<TriggerResult> {
  if (record.status === 'finished' || record.status === 'error') {
    return toTriggerResult(record, true)
  }

  const description = await describeWorldCerealJob(record.jobId, signal)

  if (description.status === 'error') {
    const result: WorldCerealResult = {
      jobId: record.jobId, status: 'error', seasonStart: record.seasonStart, seasonEnd: record.seasonEnd,
      processingTimeSeconds: description.durationSeconds, realCreditsSpent: description.costs,
      validPixelCount: 0, totalPixelCount: 0, validPixelCoveragePct: 0, nearestValidPixel: null,
      errorMessage: description.errorMessage,
    }
    const updated: CachedWorldCerealRecord = {
      ...record, status: 'error', completedAtIso: new Date().toISOString(),
      backendProcessingDurationSeconds: description.durationSeconds, realCreditsSpent: description.costs,
      result, resultTimestampIso: new Date().toISOString(),
    }
    await saveRecord(updated)
    return toTriggerResult(updated, true)
  }

  if (description.status !== 'finished') {
    const nextStatus: CachedWorldCerealRecord['status'] = description.status === 'created' || description.status === 'queued' ? 'queued' : 'running'
    if (nextStatus !== record.status) {
      const updated: CachedWorldCerealRecord = { ...record, status: nextStatus }
      await saveRecord(updated)
      return toTriggerResult(updated, true)
    }
    return toTriggerResult(record, true)
  }

  // Finished for the first time this refresh: download + decode once, then persist permanently.
  const tifPath = tifCachePathForJob(record.jobId)
  await downloadWorldCerealResult(record.jobId, tifPath, signal)
  let decoded = await decodeWorldCerealGeoTiff(tifPath, record.lat, record.lng, { windowRadiusPx: 5 })
  if (!decoded.nearestValidPixel) {
    decoded = await decodeWorldCerealGeoTiff(tifPath, record.lat, record.lng, { windowRadiusPx: 15 })
  }
  await unlink(tifPath).catch(() => {})

  const result: WorldCerealResult = {
    jobId: record.jobId, status: 'finished', seasonStart: record.seasonStart, seasonEnd: record.seasonEnd,
    processingTimeSeconds: description.durationSeconds, realCreditsSpent: description.costs,
    validPixelCount: decoded.validPixelCount, totalPixelCount: decoded.totalPixelCount,
    validPixelCoveragePct: decoded.totalPixelCount > 0 ? (decoded.validPixelCount / decoded.totalPixelCount) * 100 : 0,
    nearestValidPixel: decoded.nearestValidPixel, errorMessage: null,
  }
  const nowIso = new Date().toISOString()
  const updated: CachedWorldCerealRecord = {
    ...record, status: 'finished', completedAtIso: nowIso,
    backendProcessingDurationSeconds: description.durationSeconds, realCreditsSpent: description.costs,
    result, resultTimestampIso: nowIso,
  }
  await saveRecord(updated)
  return toTriggerResult(updated, true)
}

function toTriggerResult(record: CachedWorldCerealRecord, cacheHit: boolean): TriggerResult {
  return { cacheKey: record.cacheKey, jobId: record.jobId, cacheHit, status: record.status, result: record.result }
}
