import type { AluFeatureType, MonitoringSeason, NormalizedFieldProperties } from '../../types/agricultural'
import type { CropShare } from './cropSummary'

/**
 * Fixed-order categorical palette (8 hues), validated for CVD-safe adjacency
 * and normal-vision separation. Assigned to real crop names by rank (largest
 * mapped area first), never cycled or hashed — see buildCropColorMap.
 */
const CATEGORICAL_CROP_COLORS = [
  '#2a78d6', // blue
  '#eb6834', // orange
  '#1baf7a', // aqua
  '#eda100', // yellow
  '#e87ba4', // magenta
  '#008300', // green
  '#4a3aa7', // violet
  '#e34948', // red
]

/** Real crops beyond the 8 fixed slots fold into this shared "other" color rather than a generated hue. */
const OTHER_CROP_COLOR = '#52514e'
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
  | { kind: 'seasonal'; crop: string; matchingSeasons: MonitoringSeason[] }
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
 * Among a field's historical seasons, finds a crop with a strong recurring pattern covering
 * today's calendar position — e.g. "this field has grown Rice every July-November for the
 * last five years" — regardless of which absolute year each occurrence happened in. Compares
 * calendar month/day windows, not array position or absolute recency alone.
 *
 * Requires at least 2 historical occurrences overlapping today's calendar day (a single match
 * isn't "recurring"), and requires the dominant crop among those to be a strict majority
 * (>50%) — so a 2-for-2 or 2-of-3 agreement counts as strong, but an even split or fields with
 * a different crop every occurrence (no reliable pattern) correctly return null rather than
 * guessing. Ties in occurrence count are broken by whichever crop's most recent matching
 * occurrence is more recent, per "give priority to the most recent historical year."
 *
 * Returns null (no confident pattern) rather than fabricating a crop when evidence is thin or
 * conflicting — the caller falls back to existing behavior in that case.
 */
function inferSeasonalCrop(
  seasons: MonitoringSeason[],
  nowSec: number,
): { crop: string; matchingSeasons: MonitoringSeason[] } | null {
  const todayOrdinal = dayOfYear(nowSec)

  const matching = seasons.filter((season) => {
    if (!Number.isFinite(season.startTimestampSec) || !Number.isFinite(season.endTimestampSec)) return false
    if (season.predictions[0]?.crop === undefined) return false
    return ordinalInWindow(todayOrdinal, dayOfYear(season.startTimestampSec), dayOfYear(season.endTimestampSec))
  })

  if (matching.length < 2) return null

  const seasonsByCrop = new Map<string, MonitoringSeason[]>()
  for (const season of matching) {
    const crop = season.predictions[0].crop
    const list = seasonsByCrop.get(crop)
    if (list) list.push(season)
    else seasonsByCrop.set(crop, [season])
  }

  const mostRecentStart = (group: MonitoringSeason[]) => Math.max(...group.map((season) => season.startTimestampSec))

  let bestCrop: string | null = null
  let bestGroup: MonitoringSeason[] = []
  for (const [crop, group] of seasonsByCrop) {
    const isBetter =
      bestCrop === null ||
      group.length > bestGroup.length ||
      (group.length === bestGroup.length && mostRecentStart(group) > mostRecentStart(bestGroup))
    if (isBetter) {
      bestCrop = crop
      bestGroup = group
    }
  }

  if (bestCrop === null || bestGroup.length / matching.length <= 0.5) return null
  return { crop: bestCrop, matchingSeasons: bestGroup }
}

/**
 * Determines the crop to show for this field today, in order of decreasing certainty:
 *
 * 1. 'observed' — a monitoring season's [start, end] window genuinely covers `nowSec`. The
 *    strongest possible signal AMED could give; used directly.
 * 2. 'seasonal' — no season is currently active (the normal case in practice — see below),
 *    but the field's own history shows a strong recurring crop for this calendar period (see
 *    inferSeasonalCrop). This is an inference from the field's own pattern, not a direct AMED
 *    observation for today, and callers must present it as such (e.g. "Seasonal crop", not
 *    "Current crop") rather than implying AMED observed it happening right now.
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
  if (seasonal) return { kind: 'seasonal', crop: seasonal.crop, matchingSeasons: seasonal.matchingSeasons }

  const season = seasons.reduce((latest, season) => (season.startTimestampSec > latest.startTimestampSec ? season : latest))
  return { kind: 'fallback', season }
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
