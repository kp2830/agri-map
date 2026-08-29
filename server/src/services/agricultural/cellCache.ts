import type { NormalizedFieldCollection } from '../../types/agricultural.js'

/**
 * In-memory cache of normalized ALU+AMED results, keyed by decimal S2 Level-13 cell ID.
 * Avoids re-calling the external API for a cell already fetched recently — e.g. a user
 * re-analyzing the same or an overlapping location, or two nearby clicks whose 5km squares
 * share cells. ALU/AMED landscape/crop classifications are satellite-derived and don't
 * change minute-to-minute, so a short TTL is safe: it only ever avoids a *redundant* call
 * within the same active-use window, never serves data that's meaningfully stale.
 *
 * Deliberately a plain in-memory Map, not Redis or another external service — this process
 * doesn't have one, and a single Node process's memory is sufficient for this workload.
 */
const TTL_MS = 15 * 60 * 1000

/**
 * Real-world S2 Level-13 cells vary enormously in how much data they hold — a dense
 * smallholder-agriculture cell can contain many hundreds of tiny field polygons, each with a
 * decade of AMED monitoring history, while a sparse cell has a handful of features or none.
 * Measured directly against live ALU/AMED data: a single dense cell's normalized collection
 * can run into single-digit megabytes, so bounding the cache purely by *entry count* gives no
 * real bound on memory at all — 5000 entries could be a few hundred MB or, in a bad case,
 * several gigabytes, easily exceeding a constrained container's heap regardless of the entry
 * cap. This is what was actually causing the production OOM: repeated searches into dense
 * regions kept adding multi-MB entries well before the process could ever reach 5000 of them.
 *
 * MAX_CACHE_BYTES bounds the cache's own footprint directly (measured via the same
 * JSON size AMED/ALU would put on the wire — cheap to compute once per cache miss, since it
 * only runs after an ALU+AMED round trip that already took far longer). 64 MB leaves generous
 * headroom under a small container's ~256 MB heap for the rest of the process — one in-flight
 * search's own working set (Node/Express baseline, the current request's merged result before
 * it's sent, up to CONCURRENCY_LIMIT cells being fetched/parsed at once) plus V8 GC/fragmentation
 * overhead — while still being large enough to retain many real cells: most measured real-world
 * cells are well under 1 MB, and even the densest observed cells (a few MB each) still leave
 * room for dozens of them, which is what actually matters for cache-hit rate in practice (users
 * repeatedly viewing the same or nearby areas within the TTL window).
 */
const MAX_CACHE_BYTES = 64 * 1024 * 1024
/** Secondary safety net independent of MAX_CACHE_BYTES — guards against a pathological case of
 *  very many tiny entries inflating Map/object overhead without ever tripping the byte budget. */
const MAX_ENTRIES = 5000

interface CacheEntry {
  collection: NormalizedFieldCollection
  expiresAt: number
  /** Approximate serialized size in bytes — computed once at insert time, used to enforce
   *  MAX_CACHE_BYTES without re-serializing on every read. */
  bytes: number
}

/** Insertion order doubles as recency order: getCachedCell re-inserts an entry on every hit
 *  (delete + set moves it to the end of Map's iteration order), so the *first* key is always
 *  genuinely the least-recently-used one — true LRU eviction, not just "oldest fetched". */
const cache = new Map<string, CacheEntry>()
let totalBytes = 0

function estimateBytes(collection: NormalizedFieldCollection): number {
  return Buffer.byteLength(JSON.stringify(collection))
}

/** Evicts least-recently-used entries until adding `incomingBytes` would fit within both
 *  MAX_CACHE_BYTES and MAX_ENTRIES. */
function evictUntilWithinBudget(incomingBytes: number): void {
  while (cache.size > 0 && (cache.size >= MAX_ENTRIES || totalBytes + incomingBytes > MAX_CACHE_BYTES)) {
    const oldestKey = cache.keys().next().value
    if (oldestKey === undefined) break
    const oldest = cache.get(oldestKey)
    cache.delete(oldestKey)
    if (oldest) totalBytes -= oldest.bytes
  }
}

/** Read-only snapshot for logging/tests — never exposes the cached collections themselves. */
export function getCacheDiagnostics(): { entries: number; totalBytes: number } {
  return { entries: cache.size, totalBytes }
}

/**
 * Promises for cells currently being fetched, keyed the same as `cache`. Lets two
 * overlapping searches (e.g. two nearby map clicks in flight at once) that both need
 * the same not-yet-cached cell share a single outbound ALU+AMED request instead of
 * each firing their own — see getOrFetchCell.
 */
const inFlight = new Map<string, Promise<NormalizedFieldCollection>>()

export function getCachedCell(cellId: string): NormalizedFieldCollection | undefined {
  const entry = cache.get(cellId)
  if (!entry) return undefined
  if (Date.now() > entry.expiresAt) {
    cache.delete(cellId)
    totalBytes -= entry.bytes
    return undefined
  }
  // Bump recency to the most-recently-used end so eviction is genuinely LRU (a cell hit
  // repeatedly across searches survives longer than one fetched once and never revisited).
  cache.delete(cellId)
  cache.set(cellId, entry)
  return entry.collection
}

export function setCachedCell(cellId: string, collection: NormalizedFieldCollection): void {
  const bytes = estimateBytes(collection)
  // A single cell's data can itself approach or exceed the whole budget in an extremely dense
  // area — skip caching it rather than let one entry crowd out everything else (or, if it's
  // genuinely larger than the whole budget, evict-loop forever trying to make room for it).
  if (bytes > MAX_CACHE_BYTES) return

  const existing = cache.get(cellId)
  if (existing) {
    cache.delete(cellId)
    totalBytes -= existing.bytes
  }
  evictUntilWithinBudget(bytes)
  cache.set(cellId, { collection, expiresAt: Date.now() + TTL_MS, bytes })
  totalBytes += bytes
}

export type CellFetchOrigin = 'cache' | 'inflight' | 'miss'

/**
 * Returns the cached result for `cellId` if present. Otherwise, if another caller is
 * already fetching this exact cell (an overlapping search), awaits and shares that same
 * in-flight promise rather than issuing a second ALU+AMED request. Only a genuine miss
 * calls `fetcher()` and registers it for anyone else to join while it's pending.
 *
 * A rejected fetch is not cached (so the next attempt retries for real) and is removed
 * from `inFlight` as soon as it settles, propagating the same error to every caller that
 * was sharing it.
 */
export async function getOrFetchCell(
  cellId: string,
  fetcher: () => Promise<NormalizedFieldCollection>,
): Promise<{ collection: NormalizedFieldCollection; origin: CellFetchOrigin }> {
  const cached = getCachedCell(cellId)
  if (cached) return { collection: cached, origin: 'cache' }

  const pending = inFlight.get(cellId)
  if (pending) return { collection: await pending, origin: 'inflight' }

  const promise = fetcher()
    .then((collection) => {
      setCachedCell(cellId, collection)
      return collection
    })
    .finally(() => {
      inFlight.delete(cellId)
    })
  inFlight.set(cellId, promise)

  return { collection: await promise, origin: 'miss' }
}
