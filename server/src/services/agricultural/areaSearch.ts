import { cellTokenToCellId, cellTokenToLatLng, getCellTokensForSquareArea } from '../../lib/s2/index.js'
import type { NormalizedFieldCollection, NormalizedFieldFeature } from '../../types/agricultural.js'
import { fetchLandscape } from './alu/index.js'
import { fetchMonitoring } from './amed/index.js'
import { getOrFetchCell } from './cellCache.js'
import { joinLandscapeWithMonitoring } from './normalize.js'

/** Thrown when a search is abandoned because the caller's AbortSignal fired (e.g. the
 *  HTTP client that requested it already disconnected — a newer click superseded it). Not
 *  a real failure: the controller recognizes this by name and simply sends no response. */
export class SearchAbortedError extends Error {
  constructor() {
    super('Agricultural area search aborted')
    this.name = 'AbortError'
  }
}

/** Allowed values for the user-configurable initial grid/coverage side length (km). Mirrored
 *  in client/src/features/fields/CentroidForm.tsx for the dropdown options — kept in sync
 *  manually since this repo has no shared client/server code path (see CLAUDE.md). */
export const ALLOWED_GRID_KM = [1, 2, 3, 4, 5]
/** Allowed values for the user-configurable maximum fallback search distance (km). Mirrored
 *  in client/src/features/fields/CentroidForm.tsx for the dropdown options. */
export const ALLOWED_MAX_SEARCH_KM = [10, 15, 20, 25, 30]
export const DEFAULT_GRID_KM = 3
export const DEFAULT_MAX_SEARCH_KM = 10

/**
 * Candidate expansion radii (km) the fallback search steps through, filtered down to those
 * strictly beyond the selected grid's own half-width and up to the selected max search
 * distance. Every allowed ALLOWED_MAX_SEARCH_KM value is itself a candidate, so the search
 * always reaches exactly the user-selected maximum as its final stage. This generalizes what
 * was previously a fixed [10, 16, 20, 30, 40, 50, 60] (km sides) progression — for the old
 * fixed grid=5/maxSearch=30 case this produces the identical stages.
 */
const CANDIDATE_EXPANSION_RADII_KM = [5, 8, 10, 15, 20, 25, 30]

/** Builds the cumulative square side lengths (km) to try, in order, beyond the initial grid,
 *  stopping exactly at `maxSearchKm`. */
function buildExpansionStepsSideKm(gridKm: number, maxSearchKm: number): number[] {
  const gridRadiusKm = gridKm / 2
  const radii = CANDIDATE_EXPANSION_RADII_KM.filter((radius) => radius > gridRadiusKm && radius <= maxSearchKm)
  if (radii[radii.length - 1] !== maxSearchKm) radii.push(maxSearchKm)
  return radii.map((radius) => radius * 2)
}

/**
 * Max cells queried across the whole search (initial + all expansion stages combined) — a
 * last-resort safety valve only, NOT a per-stage design lever. Fallback stages are no longer
 * capped to an arbitrary closest-N subset (that was the bug: a stage genuinely needing hundreds
 * of cells to fully cover its ring was silently truncated to 25, so real coverage outside that
 * subset was missed and incorrectly reported as absent). Every cell a stage's ring actually
 * needs is now queried. This budget is sized from direct measurement of the true worst case —
 * a full 30km-radius (60km-side) square needs ~2,400-3,400 S2 Level-13 cells depending on
 * latitude — with margin, so it should never actually trigger for a genuine 30km search; it
 * only guards against a truly unexpected/pathological geometry.
 */
const TOTAL_CELL_BUDGET = 4000
/**
 * Max concurrent per-cell analyses (each is 1 ALU + 1 AMED request in parallel). Doubled from
 * 5 after an empirical A/B test on fresh (uncached) coordinates: concurrency=5 took ~7.4s for
 * a 24-cell stage; concurrency=10 took ~4.2-4.7s for comparably-sized stages, with zero errors
 * or rate-limit responses observed. Not pushed further than this modest, measured increase —
 * the goal is a reliably fast search, not the maximum possible number of simultaneous requests.
 */
const CONCURRENCY_LIMIT = 10

export interface CoverageInfo {
  /** 'found_in_area': coverage was within the initial gridKm x gridKm area. 'found_nearby': expansion was needed. 'not_found': nothing within maxSearchKm. */
  status: 'found_in_area' | 'found_nearby' | 'not_found'
  /** Side length (km) of the square area that was searched when this result was produced. */
  searchAreaSideKm: number
  /** Distance (km) from the selected point to the nearest returned field, or null if none found. */
  nearestDistanceKm: number | null
  /** Approximate centroid of the nearest returned field (mean of its geometry's vertices), or null if none found. */
  nearestFieldCentroid: LatLng | null
  /** The configured maximum search radius (km) — the search never looks further than this. */
  maxSearchRadiusKm: number
}

export interface AreaSearchResult {
  /** Decimal S2 cell IDs that were queried. */
  s2CellIds: string[]
  fieldCollection: NormalizedFieldCollection
  coverage: CoverageInfo
}

type LatLng = { lat: number; lng: number }

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0

  async function worker() {
    while (next < items.length) {
      const index = next++
      results[index] = await fn(items[index])
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

interface CellResult {
  collection: NormalizedFieldCollection | null
  error: unknown
  /** 'cache': a completed result from an earlier fetch. 'inflight': shared another
   *  concurrent search's still-pending fetch of this same cell instead of duplicating it.
   *  'miss': this call actually issued the ALU+AMED request. */
  origin: 'cache' | 'inflight' | 'miss'
}

/**
 * Fetches ALU+AMED data for a single S2 cell — via the shared cache/in-flight-request
 * registry in cellCache.ts, which also coalesces this exact cell being requested by
 * another concurrent (e.g. overlapping-search) caller at the same time into one network
 * call. Never throws — a failed cell is reported via `error` so it can't take down the
 * whole multi-cell search; the caller decides what a run of all-failed cells means.
 */
async function fetchCell(token: string, signal?: AbortSignal): Promise<CellResult> {
  const s2CellId = cellTokenToCellId(token)

  try {
    const { collection, origin } = await getOrFetchCell(s2CellId, async () => {
      const [landscape, monitoring] = await Promise.all([
        fetchLandscape(s2CellId, signal),
        fetchMonitoring(s2CellId, signal),
      ])
      return joinLandscapeWithMonitoring(landscape, monitoring)
    })
    return { collection, error: null, origin }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { collection: null, error, origin: 'miss' }
    }
    console.error(`Agricultural cell analysis failed for cell ${token}:`, error instanceof Error ? error.message : error)
    return { collection: null, error, origin: 'miss' }
  }
}

/**
 * A feature the API tagged as a field but whose geometry isn't a Polygon/MultiPolygon
 * can't actually be rendered or measured as a field — drop it rather than passing it
 * through as if it were real field coverage. Non-field feature types (trees, ponds,
 * wells) are untouched; their geometry isn't used for field rendering or crop math.
 */
function isMalformedField(feature: NormalizedFieldFeature): boolean {
  return feature.properties.aluType === 'field' && feature.geometry.type !== 'Polygon' && feature.geometry.type !== 'MultiPolygon'
}

/** Merges normalized field collections, deduplicating by the existing stable feature id (first occurrence wins). */
function mergeCollections(collections: NormalizedFieldCollection[]): NormalizedFieldCollection {
  const byId = new Map<string, NormalizedFieldFeature>()

  for (const collection of collections) {
    for (const feature of collection.features) {
      if (feature.id === undefined) continue
      if (isMalformedField(feature)) continue
      const id = String(feature.id)
      if (!byId.has(id)) byId.set(id, feature)
    }
  }

  return { type: 'FeatureCollection', features: [...byId.values()] }
}

function collectCoordinates(geometry: GeoJSON.Geometry, out: GeoJSON.Position[]): void {
  switch (geometry.type) {
    case 'Point':
      out.push(geometry.coordinates)
      break
    case 'MultiPoint':
    case 'LineString':
      out.push(...geometry.coordinates)
      break
    case 'MultiLineString':
    case 'Polygon':
      for (const ring of geometry.coordinates) out.push(...ring)
      break
    case 'MultiPolygon':
      for (const polygon of geometry.coordinates) for (const ring of polygon) out.push(...ring)
      break
    case 'GeometryCollection':
      for (const g of geometry.geometries) collectCoordinates(g, out)
      break
  }
}

/** Approximate centroid (mean of all vertices) of a feature's geometry — good enough for "how far away" messaging. */
function featureCentroid(geometry: GeoJSON.Geometry): LatLng | null {
  const coords: GeoJSON.Position[] = []
  collectCoordinates(geometry, coords)
  if (coords.length === 0) return null

  const [lngSum, latSum] = coords.reduce((acc, [lng, lat]) => [acc[0] + lng, acc[1] + lat], [0, 0])
  return { lng: lngSum / coords.length, lat: latSum / coords.length }
}

function haversineKm(a: LatLng, b: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const EARTH_RADIUS_KM = 6371
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h))
}

/** True for the field-type features with the Polygon/MultiPolygon geometry an actual mapped field has. */
function isValidFieldFeature(feature: NormalizedFieldFeature): boolean {
  return (
    feature.properties.aluType === 'field' &&
    (feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon')
  )
}

/** Whether a collection contains at least one real, validly-shaped agricultural field — not just any landscape feature. */
function hasValidField(collection: NormalizedFieldCollection): boolean {
  return collection.features.some(isValidFieldFeature)
}

/**
 * Distance and centroid of the nearest real returned agricultural FIELD to the selected
 * point, based only on actual ALU/AMED field geometry — never the search-square center,
 * and never a non-field feature (trees, ponds, wells) even if one happens to be closer.
 * Returns null when the collection has no valid field feature.
 */
function nearestField(selected: LatLng, collection: NormalizedFieldCollection): { distanceKm: number; centroid: LatLng } | null {
  let nearest: { distanceKm: number; centroid: LatLng } | null = null
  for (const feature of collection.features) {
    if (!isValidFieldFeature(feature)) continue
    const centroid = featureCentroid(feature.geometry)
    if (!centroid) continue
    const distanceKm = haversineKm(selected, centroid)
    if (nearest === null || distanceKm < nearest.distanceKm) nearest = { distanceKm, centroid }
  }
  return nearest
}

/** Last-resort truncation to at most `limit` tokens, keeping the ones whose cell center is
 *  closest to the selected point — only used if the overall TOTAL_CELL_BUDGET safety valve is
 *  actually hit, so that if truncation is ever unavoidable it drops the farthest cells first. */
function capToClosest(tokens: string[], selected: LatLng, limit: number): string[] {
  if (tokens.length <= limit) return tokens

  return tokens
    .map((token) => ({ token, distance: haversineKm(selected, cellTokenToLatLng(token)) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit)
    .map((entry) => entry.token)
}

/**
 * Runs the existing ALU+AMED pipeline over a `gridKm` x `gridKm` area around the clicked
 * point, merging and deduplicating results across the underlying Level-13 cells. If that
 * area has no agricultural coverage, progressively expands the search outward (in bounded
 * rings, with a controlled concurrency limit and a hard cell/radius budget) until real
 * coverage is found or `maxSearchKm` is reached. `signal`, if given, lets the caller (the
 * HTTP controller) abandon the search once its client has disconnected — e.g. a newer map
 * click superseded this one — so cells not yet queried are never fetched, and in-flight
 * ALU/AMED HTTP calls are cancelled rather than run to completion for a result nobody will
 * read. `gridKm`/`maxSearchKm` are trusted to already be validated by the caller (see
 * ALLOWED_GRID_KM/ALLOWED_MAX_SEARCH_KM and the controller's validation of the request).
 */
export async function searchAgriculturalArea(
  lat: number,
  lng: number,
  gridKm: number = DEFAULT_GRID_KM,
  maxSearchKm: number = DEFAULT_MAX_SEARCH_KM,
  signal?: AbortSignal,
): Promise<AreaSearchResult> {
  const searchStartedAt = Date.now()
  const selected: LatLng = { lat, lng }
  const expansionStepsSideKm = buildExpansionStepsSideKm(gridKm, maxSearchKm)
  const queriedTokens = new Set<string>()
  let attempted = 0
  let succeeded = 0
  let cacheHits = 0
  let coalescedHits = 0
  let mergeMs = 0
  let nearestMs = 0
  let firstError: unknown = null

  function throwIfAborted(): void {
    if (signal?.aborted) throw new SearchAbortedError()
  }

  function timedMerge(collections: NormalizedFieldCollection[]): NormalizedFieldCollection {
    const startedAt = Date.now()
    const result = mergeCollections(collections)
    mergeMs += Date.now() - startedAt
    return result
  }

  function timedNearest(collection: NormalizedFieldCollection) {
    const startedAt = Date.now()
    const result = nearestField(selected, collection)
    nearestMs += Date.now() - startedAt
    return result
  }

  async function queryNewTokens(tokens: string[], stageLabel: string): Promise<NormalizedFieldCollection[]> {
    throwIfAborted()
    tokens.forEach((token) => queriedTokens.add(token))
    attempted += tokens.length

    const stageStartedAt = Date.now()
    const results = await mapWithConcurrency(tokens, CONCURRENCY_LIMIT, (token) => fetchCell(token, signal))
    const collections: NormalizedFieldCollection[] = []
    let stageCacheHits = 0
    let stageCoalesced = 0
    for (const result of results) {
      if (result.origin === 'cache') stageCacheHits++
      if (result.origin === 'inflight') stageCoalesced++
      if (result.collection) {
        succeeded++
        collections.push(result.collection)
      } else if (firstError === null) {
        firstError = result.error
      }
    }
    cacheHits += stageCacheHits
    coalescedHits += stageCoalesced
    console.log(
      `[areaSearch] stage=${stageLabel} cells=${tokens.length} cacheHits=${stageCacheHits} coalesced=${stageCoalesced} concurrency=${CONCURRENCY_LIMIT} tookMs=${Date.now() - stageStartedAt}`,
    )
    return collections
  }

  function remainingBudget(): number {
    return TOTAL_CELL_BUDGET - queriedTokens.size
  }

  // Every cell a stage's ring actually needs is queried — no arbitrary closest-N subset. The
  // only possible truncation is the last-resort TOTAL_CELL_BUDGET valve, which is sized well
  // above any real 30km search's true cell count and should never actually trigger in practice.
  function newTokensForStage(sideKm: number): string[] {
    const candidates = getCellTokensForSquareArea(lat, lng, sideKm).filter((token) => !queriedTokens.has(token))
    return candidates.length > remainingBudget() ? capToClosest(candidates, selected, Math.max(remainingBudget(), 0)) : candidates
  }

  async function fail(): Promise<never> {
    throw firstError instanceof Error ? firstError : new Error('Agricultural data lookup failed for every searched cell')
  }

  function logSummary(status: string): void {
    console.log(
      `[areaSearch] done status=${status} cellsQueried=${queriedTokens.size} attempted=${attempted} cacheHits=${cacheHits} coalesced=${coalescedHits} mergeMs=${mergeMs} nearestMs=${nearestMs} totalMs=${Date.now() - searchStartedAt}`,
    )
  }

  // Stage 0: the normal gridKm x gridKm analysis area — the full square, not a closest-N subset.
  const initialTokens = newTokensForStage(gridKm)
  const initialCollections = await queryNewTokens(initialTokens, `initial-${gridKm}km`)
  let merged = timedMerge(initialCollections)

  if (attempted > 0 && succeeded === 0) await fail()

  // A stage only counts as "coverage found" when it contains an actual field — a stage
  // that returned only trees/water/wells (no fields) must not stop the search early, and
  // must never be reported to the user as agricultural coverage (see hasValidField).
  if (hasValidField(merged)) {
    const nearest = timedNearest(merged)
    logSummary('found_in_area')
    return {
      s2CellIds: [...queriedTokens].map(cellTokenToCellId),
      fieldCollection: merged,
      coverage: {
        status: 'found_in_area',
        searchAreaSideKm: gridKm,
        nearestDistanceKm: nearest?.distanceKm ?? null,
        nearestFieldCentroid: nearest?.centroid ?? null,
        maxSearchRadiusKm: maxSearchKm,
      },
    }
  }

  // Progressive expansion: query only the newly-covered ring of cells at each step. Stops
  // immediately at the first stage with real coverage — later, larger stages are never queried.
  for (const sideKm of expansionStepsSideKm) {
    throwIfAborted()
    if (remainingBudget() <= 0) break

    const newTokens = newTokensForStage(sideKm)
    if (newTokens.length === 0) continue

    const stageCollections = await queryNewTokens(newTokens, `expand-${sideKm}km`)
    if (attempted > 0 && succeeded === 0) await fail()

    merged = timedMerge(stageCollections)
    if (hasValidField(merged)) {
      const nearest = timedNearest(merged)
      logSummary('found_nearby')
      return {
        s2CellIds: [...queriedTokens].map(cellTokenToCellId),
        fieldCollection: merged,
        coverage: {
          status: 'found_nearby',
          searchAreaSideKm: sideKm,
          nearestDistanceKm: nearest?.distanceKm ?? null,
          nearestFieldCentroid: nearest?.centroid ?? null,
          maxSearchRadiusKm: maxSearchKm,
        },
      }
    }
  }

  logSummary('not_found')
  return {
    s2CellIds: [...queriedTokens].map(cellTokenToCellId),
    fieldCollection: { type: 'FeatureCollection', features: [] },
    coverage: {
      status: 'not_found',
      searchAreaSideKm: expansionStepsSideKm[expansionStepsSideKm.length - 1] ?? gridKm,
      nearestDistanceKm: null,
      nearestFieldCentroid: null,
      maxSearchRadiusKm: maxSearchKm,
    },
  }
}
