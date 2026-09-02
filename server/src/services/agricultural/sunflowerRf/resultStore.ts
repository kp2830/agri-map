/**
 * Persistent cache for Sunflower RF v0 predictions, keyed by field identity + model version +
 * feature-window version (never by click coordinates — same reasoning as the WorldCereal
 * research cache, server/src/services/agricultural/worldcereal/resultStore.ts, which this
 * mirrors). A repeated click on the same field reuses the cached prediction instead of spending
 * more CDSE processing units. A future sunflower-rf-v1 (or a changed feature-window definition)
 * gets its own cache keys automatically — never silently served from a v0 entry.
 *
 * File-based JSON, same rationale as the WorldCereal cache: this project has no database in V1
 * (see CLAUDE.md), so a file store is the least-invasive way to get restart-durable persistence.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CachedSunflowerRfRecord } from './types.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const STORE_DIR = join(__dirname, '../../../../.sunflower-rf-cache')
const STORE_FILE = join(STORE_DIR, 'results.json')

export function buildCacheKey(fieldId: string, modelVersion: string, featureWindowVersion: string): string {
  return `${fieldId}::${modelVersion}::${featureWindowVersion}`
}

async function readStore(): Promise<Record<string, CachedSunflowerRfRecord>> {
  try {
    return JSON.parse(await readFile(STORE_FILE, 'utf-8')) as Record<string, CachedSunflowerRfRecord>
  } catch {
    return {}
  }
}

async function writeStore(store: Record<string, CachedSunflowerRfRecord>): Promise<void> {
  await mkdir(STORE_DIR, { recursive: true })
  await writeFile(STORE_FILE, JSON.stringify(store, null, 2))
}

export async function getCachedRecord(cacheKey: string): Promise<CachedSunflowerRfRecord | null> {
  const store = await readStore()
  return store[cacheKey] ?? null
}

export async function saveRecord(record: CachedSunflowerRfRecord): Promise<void> {
  const store = await readStore()
  store[record.cacheKey] = record
  await writeStore(store)
}
