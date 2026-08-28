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
/** Bounded so a long-lived server process can't grow this without limit; oldest entries
 *  (by insertion order) are evicted first once the cap is hit. */
const MAX_ENTRIES = 5000

interface CacheEntry {
  collection: NormalizedFieldCollection
  expiresAt: number
}

const cache = new Map<string, CacheEntry>()

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
    return undefined
  }
  return entry.collection
}

export function setCachedCell(cellId: string, collection: NormalizedFieldCollection): void {
  if (!cache.has(cellId) && cache.size >= MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value
    if (oldestKey !== undefined) cache.delete(oldestKey)
  }
  cache.set(cellId, { collection, expiresAt: Date.now() + TTL_MS })
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
