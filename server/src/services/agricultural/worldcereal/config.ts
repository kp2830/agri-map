/**
 * Feature flag + fixed defaults for the WorldCereal research integration. Off by default —
 * this module is never reached from the production AMED flow unless an operator explicitly
 * sets ENABLE_WORLDCEREAL_RESEARCH=true, and even then it only powers the isolated
 * /research/worldcereal routes (see routes/worldcerealResearch.ts), never the production
 * /agriculture/fields response.
 */
export function isWorldCerealResearchEnabled(): boolean {
  return process.env.ENABLE_WORLDCEREAL_RESEARCH === 'true'
}

/**
 * Real, measured finding (training/esa/): every Indian location we've queried — Gadag,
 * the 5-field batch, Siddipet, Kurukshetra — logged
 * "No crop-calendar lookup points found inside extent; falling back to nearest point" and all
 * resolved to the SAME tc-annual season window. WorldCereal has no dense local crop-calendar
 * reference for India yet, so there is currently nothing gained by re-deriving this per field
 * via the (Python-only) `worldcereal.seasons.get_season_dates_for_extent` call — a fixed
 * default reproduces the real, already-observed behavior exactly.
 *
 * Re-verify this assumption if ESA ships Indian crop-calendar reference data (see report
 * §21 "Remaining technical gaps") — at that point per-region season windows may start to
 * differ and this fixed default would need to become a real per-extent lookup again.
 */
export const DEFAULT_INDIA_SEASON = { start: '2024-12-01', end: '2025-11-30' } as const

/** Half of the real ~640m x 640m box used in every prior manual test (BUF=0.003 degrees). */
export const FIELD_BBOX_BUFFER_DEGREES = 0.003

/** Identifies which model produced a cached result — part of the cache key (see
 *  resultStore.ts's buildCacheKey) so a future model/version upgrade never silently serves a
 *  stale result computed by a different model. Bump this if the captured process graph
 *  (processGraphTemplate.json) is ever re-captured against a newer worldcereal package version. */
export const WORLDCEREAL_MODEL_VERSION = 'worldcereal-2.8.0-croptype24-tc-annual'
