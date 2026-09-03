import type { AluFeatureType, MonitoringSeason, NormalizedFieldProperties } from '../../types/agricultural'
import type { CropShare } from './cropSummary'

/**
 * Fixed-order categorical palette (8 hues), validated for CVD-safe adjacency
 * and normal-vision separation. Assigned to real crop names by rank (largest
 * mapped area first), never cycled or hashed — see buildCropColorMap.
 *
 * No yellow/gold hue in this palette, deliberately: SUNFLOWER_LIKELY_FILL_COLOR below is the
 * ONLY color on the map meant to read as "sunflower." An earlier version of this palette
 * included a yellow slot (#eda100) that could be assigned to any AMED crop by area rank — e.g.
 * Corn, if it happened to be the 4th-largest crop in a given search — which risked exactly the
 * ambiguity this app exists to avoid, regardless of how distinct SUNFLOWER_LIKELY_FILL_COLOR
 * itself looks. Replaced with a brown, matching the product requirement that no crop other than
 * a real >50% Sunflower RF result can ever render yellow/gold, including Corn/Maize.
 */
const CATEGORICAL_CROP_COLORS = [
  '#2a78d6', // blue
  '#eb6834', // orange
  '#1baf7a', // aqua
  '#8b5a2b', // brown
  '#e87ba4', // magenta
  '#008300', // green
  '#4a3aa7', // violet
  '#e34948', // red
]

/** Real crops beyond the 8 fixed slots fold into this shared "other" color rather than a generated hue. */
const OTHER_CROP_COLOR = '#52514e'
/**
 * Sunflower RF v0 map coloring. The first choice here (#ffc107) turned out to sit almost
 * exactly between the existing orange (#eb6834) and amber (#eda100) CATEGORICAL_CROP_COLORS —
 * a real Corn field could read as "sunflower-golden" at a glance, exactly the ambiguity this
 * was supposed to avoid. Fixed two ways, not just a hue tweak: (1) a much more saturated,
 * near-fluorescent true yellow, clearly brighter than either muted existing hue; (2) a distinct
 * dark-brown stroke AND a visibly thicker outline (see SUNFLOWER_LIKELY_STROKE_WEIGHT in
 * MapView.tsx) — a real sunflower's dark center against bright petals — so the field reads as
 * "flagged," not just "a slightly different shade of an existing crop color." Applied only when
 * probability exceeds 50% (see colorForFeatureWithSunflower) — never replaces the AMED crop
 * data itself, only the polygon's rendered color.
 */
export const SUNFLOWER_LIKELY_FILL_COLOR = '#ffe600'
export const SUNFLOWER_LIKELY_STROKE_COLOR = '#5c3d00'
/** Fields must clear this RF probability (%) to render gold on the map — matches the product
 *  requirement exactly; not the same number as AMED_STRONG_CONFIDENCE_THRESHOLD above, which
 *  gates whether the model runs at all, not how its result is colored. */
export const SUNFLOWER_MAP_COLOR_THRESHOLD_PERCENT = 50
/** AMED returned no monitoring data at all for this field. */
const NO_PREDICTION_COLOR = '#c3c2b7'
/** AMED explicitly returned the UNKNOWN_CROP sentinel. */
const UNKNOWN_CROP_COLOR = '#898781'

/** Non-crop ALU landscape types — deliberately muted so crop colors read as the primary signal. */
const NEUTRAL_ALU_COLORS: Record<Exclude<AluFeatureType, 'field'>, string> = {
  trees: '#8fae7c',
  farm_pond: '#7fa8c9',
  other_water: '#a9c4d9',
  dug_well: '#b3a58f',
}

export type ActiveCropOutcome =
  | { kind: 'observed'; season: MonitoringSeason }
  | { kind: 'seasonal'; crop: string; matchedSeason: MonitoringSeason }
  | { kind: 'fallback'; season: MonitoringSeason }
  | { kind: 'none' }

/** Cumulative days before each month (0-indexed, non-leap reference year) — used to convert a
 *  timestamp to a "day of year" ordinal (1-365) with the year itself discarded, so calendar
 *  position can be compared across different years. A Feb 29 in a leap year lands on the same
 *  ordinal as Mar 1 (a one-day ambiguity on a rare date, harmless for this comparison). */
const CUMULATIVE_DAYS_BEFORE_MONTH = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]

function dayOfYear(sec: number): number {
  const date = new Date(sec * 1000)
  return CUMULATIVE_DAYS_BEFORE_MONTH[date.getUTCMonth()] + date.getUTCDate()
}

/** Whether calendar-day `ordinal` (1-365) falls inside the [startOrdinal, endOrdinal] window,
 *  handling windows that wrap across the year boundary (e.g. a Nov-to-Mar Rabi season). */
function ordinalInWindow(ordinal: number, startOrdinal: number, endOrdinal: number): boolean {
  if (startOrdinal <= endOrdinal) return ordinal >= startOrdinal && ordinal <= endOrdinal
  return ordinal >= startOrdinal || ordinal <= endOrdinal
}

/**
 * Among a field's historical seasons, finds the crop grown during the NEWEST historical
 * occurrence of today's calendar period — e.g. "what was this field growing around this same
 * time of year, most recently?" Compares calendar month/day windows (year discarded) to decide
 * whether a season covers today's position, but uses the season's actual (year-bearing) start
 * timestamp purely to rank which matching occurrence is most recent.
 *
 * A single matching season is sufficient — this is recency-first selection, not a vote. When
 * multiple seasons match, the newest one wins outright regardless of what any other year grew;
 * there is no requirement that a crop recur or be any kind of majority among matches.
 *
 * Returns null only when no historical season's calendar window covers today at all — the
 * caller falls back to existing most-recent-available behavior in that case.
 */
function inferSeasonalCrop(seasons: MonitoringSeason[], nowSec: number): { crop: string; matchedSeason: MonitoringSeason } | null {
  const todayOrdinal = dayOfYear(nowSec)

  const matching = seasons.filter((season) => {
    if (!Number.isFinite(season.startTimestampSec) || !Number.isFinite(season.endTimestampSec)) return false
    if (season.predictions[0]?.crop === undefined) return false
    return ordinalInWindow(todayOrdinal, dayOfYear(season.startTimestampSec), dayOfYear(season.endTimestampSec))
  })

  if (matching.length === 0) return null

  const newest = matching.reduce((latest, season) => (season.startTimestampSec > latest.startTimestampSec ? season : latest))
  return { crop: newest.predictions[0].crop, matchedSeason: newest }
}

/**
 * Determines the crop to show for this field today, in order of decreasing certainty:
 *
 * 1. 'observed' — a monitoring season's [start, end] window genuinely covers `nowSec`. The
 *    strongest possible signal AMED could give; used directly.
 * 2. 'seasonal' — no season is currently active (the normal case in practice — see below), but
 *    a past season's calendar month/day window covers today's calendar position (see
 *    inferSeasonalCrop) — i.e. "what was this field growing around this time of year, most
 *    recently?" This is an inference from the field's own history, not a direct AMED
 *    observation for today, and callers must present it as such (distinguishing it from a
 *    directly-observed crop) rather than implying AMED observed it happening right now.
 * 3. 'fallback' — no active season and no reliable recurring pattern: use the most recently
 *    *started* season, exactly as this app behaved before any date-aware detection existed.
 *    Its own end date having passed is not treated as evidence of anything.
 * 4. 'none' — no monitoring data at all.
 *
 * Why case 1 rarely fires with real data: verified directly against live AMED responses across
 * many real fields, the most recently available monitoring season for essentially every field
 * ends somewhere between weeks and several months before the real current date — a uniform
 * data-freshness/processing-lag characteristic of the AMED pipeline (a season must finish,
 * then be classified, before it can be published), not a per-field signal of anything. An
 * earlier version of this function treated "ended" alone as proof the field was fallow and,
 * because that lag is universal, mislabeled essentially every field as Harvested/Fallow. This
 * function does not repeat that: an ended season is never itself evidence of a harvested/
 * fallow state, and cases 2-3 exist specifically to give a real answer instead.
 *
 * `nowSec` is the runtime/viewer's current time (seconds since epoch) — exposed as a
 * parameter so tests can pin "today" to a fixed date; defaults to the real current time.
 */
export function getActiveCropOutcome(
  properties: NormalizedFieldProperties,
  nowSec: number = Date.now() / 1000,
): ActiveCropOutcome {
  const seasons = properties.monitoring ?? []
  if (seasons.length === 0) return { kind: 'none' }

  const isOngoing = (season: MonitoringSeason) =>
    season.startTimestampSec <= nowSec && (!Number.isFinite(season.endTimestampSec) || season.endTimestampSec >= nowSec)

  const ongoing = seasons.filter(isOngoing)
  if (ongoing.length > 0) {
    const season = ongoing.reduce((latest, season) => (season.startTimestampSec > latest.startTimestampSec ? season : latest))
    return { kind: 'observed', season }
  }

  const seasonal = inferSeasonalCrop(seasons, nowSec)
  if (seasonal) return { kind: 'seasonal', crop: seasonal.crop, matchedSeason: seasonal.matchedSeason }

  const season = seasons.reduce((latest, season) => (season.startTimestampSec > latest.startTimestampSec ? season : latest))
  return { kind: 'fallback', season }
}

/** Default "high confidence" cutoff — mirrors
 *  server/src/services/agricultural/sunflower/overridePolicy.ts's
 *  DEFAULT_SUNFLOWER_OVERRIDE_CONFIG.amedStrongConfidenceThreshold exactly (same 0.8 value; kept
 *  in sync manually — no shared client/server code path, per CLAUDE.md). Used ONLY to decide
 *  whether it's worth calling the real-time Sunflower likelihood endpoint at all — the actual
 *  override decision always happens server-side in overridePolicy.ts, never here. */
export const AMED_STRONG_CONFIDENCE_THRESHOLD = 0.8

/** Crops where AMED and Sunflower are real-world confusable enough that even a high-confidence
 *  AMED call is still worth cross-checking against the Sunflower RF — mirrors
 *  server/src/services/agricultural/sunflowerRf/service.ts's ALWAYS_RUN_FOR_CROPS exactly (kept
 *  in sync manually, same as AMED_STRONG_CONFIDENCE_THRESHOLD above). Doesn't change the 0.8
 *  threshold for any other crop, and never affects what AMED displays. */
const SUNFLOWER_ALWAYS_RUN_CROPS = new Set(['CORN', 'MAIZE'])

/**
 * Whether this field's current AMED result is Unknown or low-confidence enough to be worth a
 * real-time Sunflower likelihood check. A 'seasonal' (inferred-from-history, not a direct
 * observation) or 'none' outcome is always eligible; Corn/Maize is always eligible regardless of
 * confidence; every other 'observed'/'fallback' outcome is eligible only when its own prediction
 * confidence is below the threshold. A high-confidence 'observed'/'fallback' result for any
 * other crop is never eligible — matches "preserve the existing AMED classification for
 * high-confidence known crops."
 */
export function isEligibleForSunflowerCheck(outcome: ActiveCropOutcome, threshold: number = AMED_STRONG_CONFIDENCE_THRESHOLD): boolean {
  if (outcome.kind === 'none' || outcome.kind === 'seasonal') return true
  const prediction = outcome.season.predictions[0]
  if (prediction && SUNFLOWER_ALWAYS_RUN_CROPS.has(prediction.crop.toUpperCase())) return true
  return prediction === undefined || prediction.confidence < threshold
}

/** The crop to show for this field: the determined outcome's crop, or null if AMED never had
 *  monitoring data for it at all. Used everywhere a flat crop identity is needed — crop
 *  filtering, crop distribution, and map coloring — so an inferred seasonal crop (e.g. Rice)
 *  is treated identically to a directly-observed one for grouping purposes. */
export function getPrimaryCrop(properties: NormalizedFieldProperties): string | null {
  const outcome = getActiveCropOutcome(properties)
  if (outcome.kind === 'observed' || outcome.kind === 'fallback') return outcome.season.predictions[0]?.crop ?? null
  if (outcome.kind === 'seasonal') return outcome.crop
  return null
}

/** The single season that produced the current crop determination — whichever one
 *  getActiveCropOutcome actually used ('observed'/'fallback' -> its season, 'seasonal' -> the
 *  matched historical season), or null when there's no crop determination at all ('none'). This
 *  is "why we're showing this crop," independent of presentation — used to drive the Current
 *  Season History filter below without re-deriving or duplicating the selection logic. */
export function getSeasonalReferenceSeason(outcome: ActiveCropOutcome): MonitoringSeason | null {
  if (outcome.kind === 'observed' || outcome.kind === 'fallback') return outcome.season
  if (outcome.kind === 'seasonal') return outcome.matchedSeason
  return null
}

/** Whether calendar windows [aStart, aEnd] and [bStart, bEnd] (day-of-year ordinals, each
 *  possibly wrapping the year boundary) share any point on the calendar — i.e. either window
 *  contains either endpoint of the other. Covers partial overlap and full containment. */
function windowsOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return (
    ordinalInWindow(bStart, aStart, aEnd) ||
    ordinalInWindow(bEnd, aStart, aEnd) ||
    ordinalInWindow(aStart, bStart, bEnd) ||
    ordinalInWindow(aEnd, bStart, bEnd)
  )
}

/**
 * The subset of a field's historical monitoring seasons that share the same time-of-year
 * period as the season behind the current crop determination (see getSeasonalReferenceSeason)
 * — i.e. "which historical records explain why we're showing this crop." Matched purely by
 * calendar month/day window overlap (year discarded), the same concept the recency-first
 * selection itself uses — not by crop name, so this works identically for any crop AMED
 * returns.
 *
 * This is a presentation-only filter: it never mutates `properties.monitoring`, and always
 * includes the reference season itself (its window trivially overlaps itself), so the record
 * that actually produced the current crop is always visible in this view. Returns an empty
 * array only when there's no crop determination to explain in the first place ('none').
 */
export function getCurrentSeasonHistory(
  properties: NormalizedFieldProperties,
  outcome: ActiveCropOutcome,
): MonitoringSeason[] {
  const seasons = properties.monitoring ?? []
  const reference = getSeasonalReferenceSeason(outcome)
  if (!reference) return []

  const refStart = dayOfYear(reference.startTimestampSec)
  const refEnd = dayOfYear(reference.endTimestampSec)
  if (!Number.isFinite(refStart) || !Number.isFinite(refEnd)) return seasons.filter((season) => season === reference)

  return seasons.filter((season) => {
    if (!Number.isFinite(season.startTimestampSec) || !Number.isFinite(season.endTimestampSec)) return false
    return windowsOverlap(refStart, refEnd, dayOfYear(season.startTimestampSec), dayOfYear(season.endTimestampSec))
  })
}

/**
 * Assigns the 8 fixed categorical colors to the largest real crops (by mapped
 * area) in a dataset, in rank order. Crops beyond the 8th, plus the null/
 * NO_PREDICTION/UNKNOWN_CROP sentinels, are handled separately by colorForCropLabel.
 */
export function buildCropColorMap(shares: CropShare[]): Map<string, string> {
  const colorMap = new Map<string, string>()
  const realCrops = shares.filter(
    (share): share is CropShare & { crop: string } =>
      share.crop !== null && share.crop !== 'NO_PREDICTION' && share.crop !== 'UNKNOWN_CROP',
  )

  realCrops.slice(0, CATEGORICAL_CROP_COLORS.length).forEach((share, index) => {
    colorMap.set(share.crop, CATEGORICAL_CROP_COLORS[index])
  })

  return colorMap
}

export function colorForCropLabel(crop: string | null, colorMap: Map<string, string>): string {
  if (crop === null || crop === 'NO_PREDICTION') return NO_PREDICTION_COLOR
  if (crop === 'UNKNOWN_CROP') return UNKNOWN_CROP_COLOR
  return colorMap.get(crop) ?? OTHER_CROP_COLOR
}

export function colorForFeature(properties: NormalizedFieldProperties, colorMap: Map<string, string>): string {
  if (properties.aluType !== 'field') {
    return NEUTRAL_ALU_COLORS[properties.aluType]
  }

  return colorForCropLabel(getPrimaryCrop(properties), colorMap)
}

/**
 * Same as colorForFeature, but renders a field gold when its Sunflower RF v0 probability
 * (already computed by the existing sunflower-rf service/endpoint — never recomputed here)
 * exceeds SUNFLOWER_MAP_COLOR_THRESHOLD_PERCENT. `sunflowerProbabilityPercent` is `null`/
 * `undefined` for a field that hasn't been checked yet (still uses its normal AMED color) or
 * that isn't eligible for a Sunflower check at all (see isEligibleForSunflowerCheck) — this
 * function never decides eligibility itself, only whether to apply the color once a real
 * probability is already known. AMED's own crop data is never touched; only the rendered color.
 */
export function colorForFeatureWithSunflower(
  properties: NormalizedFieldProperties,
  colorMap: Map<string, string>,
  sunflowerProbabilityPercent: number | null | undefined,
): string {
  if (properties.aluType === 'field' && sunflowerProbabilityPercent != null && sunflowerProbabilityPercent > SUNFLOWER_MAP_COLOR_THRESHOLD_PERCENT) {
    return SUNFLOWER_LIKELY_FILL_COLOR
  }
  return colorForFeature(properties, colorMap)
}

export function colorForAluType(aluType: Exclude<AluFeatureType, 'field'>): string {
  return NEUTRAL_ALU_COLORS[aluType]
}

/** Turns an API crop code (or the NO_PREDICTION/UNKNOWN_CROP sentinels) into a display label. */
export function formatCropLabel(crop: string | null): string {
  if (crop === null || crop === 'NO_PREDICTION') return 'No prediction available'
  if (crop === 'UNKNOWN_CROP') return 'Unknown crop'
  return crop.charAt(0) + crop.slice(1).toLowerCase()
}

export function formatAluType(aluType: AluFeatureType): string {
  return aluType
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

export function formatTimestamp(seconds: number): string {
  return new Date(seconds * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export function formatPercent(value: number): string {
  return `${(value * 100).toFixed(0)}%`
}

export function formatHectares(areaSqM: number): string {
  return `${(areaSqM / 10000).toFixed(2)} ha`
}

export function formatArea(areaSqM: number): string {
  return `${areaSqM.toLocaleString(undefined, { maximumFractionDigits: 0 })} m² (${formatHectares(areaSqM)})`
}
