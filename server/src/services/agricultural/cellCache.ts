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
