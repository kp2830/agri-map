/**
 * Persistent backend cache for WorldCereal results, keyed by FIELD IDENTITY (not by the
 * coordinates of whatever map click happened to trigger a lookup — see buildCacheKey). This is
 * what makes "click the same field again" serve a stored result instead of resubmitting a real
 * openEO/CDSE job.
 *
 * Storage: a single JSON file under server/.worldcereal-research-cache/ (gitignored). This
 * project has no database in V1 (see CLAUDE.md's "No MongoDB / persistence layer in V1" rule) —
 * a file store is the least-invasive way to get restart-durable persistence without introducing
 * new database technology, consistent with that constraint. If this integration is promoted
 * beyond research status, replace this module's internals with a real table; every other module
 * only depends on the functions exported here, not on the JSON-file detail.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WORLDCEREAL_MODEL_VERSION } from './config.js'
import type { WorldCerealResult } from './types.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const STORE_DIR = join(__dirname, '../../../../.worldcereal-research-cache')
const STORE_FILE = join(STORE_DIR, 'results.json')

export type CachedJobStatus = 'queued' | 'running' | 'finished' | 'error'

export interface CachedWorldCerealRecord {
  cacheKey: string
  fieldId: string
  /** Hash of the field's geometry, for defense-in-depth against a field_id collision or reuse
   *  across different real geometries — not itself part of the cache key (field_id + season +
   *  model version already is), but recorded so a mismatch can be detected/logged. */
  geometryHash: string | null
  lat: number
  lng: number
  modelVersion: string
  seasonStart: string
  seasonEnd: string

  jobId: string
  status: CachedJobStatus
  submittedAtIso: string
  startedAtIso: string | null
  completedAtIso: string | null
  backendProcessingDurationSeconds: number | null
  realCreditsSpent: number | null

  result: WorldCerealResult | null
  resultTimestampIso: string | null
}

/** Deterministic cache key: field identity + season/time window + model/process version — NOT
 *  the coordinates of a particular map click. Two clicks landing at slightly different points
 *  inside (or near) the same real field must resolve to the same key via the shared field_id. */
export function buildCacheKey(fieldId: string, seasonStart: string, seasonEnd: string, modelVersion: string = WORLDCEREAL_MODEL_VERSION): string {
  return `${fieldId}::${seasonStart}_${seasonEnd}::${modelVersion}`
}

async function readStore(): Promise<Record<string, CachedWorldCerealRecord>> {
  try {
    return JSON.parse(await readFile(STORE_FILE, 'utf-8')) as Record<string, CachedWorldCerealRecord>
  } catch {
    return {}
  }
}

async function writeStore(store: Record<string, CachedWorldCerealRecord>): Promise<void> {
  await mkdir(STORE_DIR, { recursive: true })
  await writeFile(STORE_FILE, JSON.stringify(store, null, 2))
}

export async function getCachedRecord(cacheKey: string): Promise<CachedWorldCerealRecord | null> {
  const store = await readStore()
  return store[cacheKey] ?? null
}

/** Look up a record by field_id alone (across whatever season/model it was last computed with) —
 *  used by the read-only GET endpoint, which doesn't know (or need to specify) the exact season
 *  window to find "whatever we already have for this field". */
export async function getCachedRecordByFieldId(fieldId: string): Promise<CachedWorldCerealRecord | null> {
  const store = await readStore()
  const matches = Object.values(store).filter((r) => r.fieldId === fieldId)
  if (matches.length === 0) return null
  // Most recently submitted wins if a field somehow has more than one (e.g. after a model
  // version bump) — never ambiguous about which one a plain "give me this field's result" call
  // should return.
  return matches.sort((a, b) => b.submittedAtIso.localeCompare(a.submittedAtIso))[0]
}

export async function saveRecord(record: CachedWorldCerealRecord): Promise<void> {
  const store = await readStore()
  store[record.cacheKey] = record
  await writeStore(store)
}

export function tifCachePathForJob(jobId: string): string {
  return join(STORE_DIR, `${jobId}.tif`)
}
