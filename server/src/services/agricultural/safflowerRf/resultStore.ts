/**
 * Persistent cache for Safflower RF v0 predictions, keyed by field identity + model version +
 * feature-window version -- same pattern as Sunflower's own resultStore.ts. A repeated click on
 * the same field reuses the cached prediction instead of spending more CDSE processing units.
 *
 * File-based JSON, same rationale as Sunflower's cache: this project has no database in V1.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CachedSafflowerRfRecord } from './types.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const STORE_DIR = join(__dirname, '../../../../.safflower-rf-cache')
const STORE_FILE = join(STORE_DIR, 'results.json')

export function buildCacheKey(fieldId: string, modelVersion: string, featureWindowVersion: string): string {
  return `${fieldId}::${modelVersion}::${featureWindowVersion}`
}

async function readStore(): Promise<Record<string, CachedSafflowerRfRecord>> {
  try {
    return JSON.parse(await readFile(STORE_FILE, 'utf-8')) as Record<string, CachedSafflowerRfRecord>
  } catch {
    return {}
  }
}

async function writeStore(store: Record<string, CachedSafflowerRfRecord>): Promise<void> {
  await mkdir(STORE_DIR, { recursive: true })
  await writeFile(STORE_FILE, JSON.stringify(store, null, 2))
}

export async function getCachedRecord(cacheKey: string): Promise<CachedSafflowerRfRecord | null> {
  const store = await readStore()
  return store[cacheKey] ?? null
}

export async function saveRecord(record: CachedSafflowerRfRecord): Promise<void> {
  const store = await readStore()
  store[record.cacheKey] = record
  await writeStore(store)
}
