import type { AluFeatureType, MonitoringSeason, NormalizedFieldProperties } from '../../types/agricultural'
import type { CropShare } from './cropSummary'

/** AMED had a real crop for this field at some point, but its season has ended and no
 *  newer/current season exists in the data — distinct from NO_PREDICTION (AMED never had
 *  a prediction at all). Named like the existing NO_PREDICTION/UNKNOWN_CROP sentinels. */
export const HARVESTED_FALLOW = 'HARVESTED_FALLOW'

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
/** A real crop existed but its season has ended with nothing newer — muted earthy tone,
 *  visually distinct from the two "no data" grays above. */
const HARVESTED_FALLOW_COLOR = '#a67c52'

/** Non-crop ALU landscape types — deliberately muted so crop colors read as the primary signal. */
const NEUTRAL_ALU_COLORS: Record<Exclude<AluFeatureType, 'field'>, string> = {
  trees: '#8fae7c',
  farm_pond: '#7fa8c9',
  other_water: '#a9c4d9',
  dug_well: '#b3a58f',
}

export type ActiveCropOutcome =
  | { kind: 'active'; season: MonitoringSeason }
  | { kind: 'harvested'; lastSeason: MonitoringSeason }
  | { kind: 'none' }

/**
 * Determines which AMED monitoring season represents what's actually growing today, rather
 * than naively trusting whichever season has the latest *start* date even if it has already
 * ended (the bug this replaces: a field could sit labeled "Wheat" for months after Wheat's
 * own harvest date had passed, simply because no later season existed in the data yet).
 *
 * `nowSec` is the runtime/viewer's current time (seconds since epoch) — exposed as a
 * parameter so tests can pin "today" to a fixed date; defaults to the real current time.
 *
 * Logic, using only the start/end timestamps AMED already provides per season (no invented
 * "harvest_date"/"season name" fields — see server/src/services/agricultural/normalize.ts):
 *
 * 1. If any season's [start, end] window genuinely covers `nowSec`, that's the active one
 *    (its harvest date is still in the future). Ties (unusual — overlapping windows) are
 *    broken by the latest start.
 * 2. Otherwise, every season either hasn't started yet or has already ended. If at least one
 *    has started (and therefore already ended, since it didn't satisfy rule 1), the field's
 *    most recent real crop has been harvested and nothing newer exists in this response —
 *    report 'harvested', still carrying that season (`lastSeason`) so its own sowing/harvest
 *    dates remain available for display as history, without labeling it as currently active.
 * 3. If nothing has started at all, there's no current or historical crop to report.
 *
 * A season with a missing/invalid end timestamp is treated leniently as possibly still
 * ongoing (never wrongly downgraded to "harvested" from incomplete data).
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
    return { kind: 'active', season }
  }

  const started = seasons.filter((season) => season.startTimestampSec <= nowSec)
  if (started.length > 0) {
    const lastSeason = started.reduce((latest, season) => (season.endTimestampSec > latest.endTimestampSec ? season : latest))
    return { kind: 'harvested', lastSeason }
  }

  return { kind: 'none' }
}

/** The crop that should be shown as active today: the current season's top prediction, the
 *  HARVESTED_FALLOW sentinel if the last real season has ended with nothing newer, or null if
 *  AMED never had monitoring data for this field at all. */
export function getPrimaryCrop(properties: NormalizedFieldProperties): string | null {
  const outcome = getActiveCropOutcome(properties)
  if (outcome.kind === 'active') return outcome.season.predictions[0]?.crop ?? null
  if (outcome.kind === 'harvested') return HARVESTED_FALLOW
  return null
}

/**
 * Assigns the 8 fixed categorical colors to the largest real crops (by mapped
 * area) in a dataset, in rank order. Crops beyond the 8th, plus the null/
 * NO_PREDICTION/UNKNOWN_CROP/HARVESTED_FALLOW sentinels, are handled separately by colorForCropLabel.
 */
export function buildCropColorMap(shares: CropShare[]): Map<string, string> {
  const colorMap = new Map<string, string>()
  const realCrops = shares.filter(
    (share): share is CropShare & { crop: string } =>
      share.crop !== null &&
      share.crop !== 'NO_PREDICTION' &&
      share.crop !== 'UNKNOWN_CROP' &&
      share.crop !== HARVESTED_FALLOW,
  )

  realCrops.slice(0, CATEGORICAL_CROP_COLORS.length).forEach((share, index) => {
    colorMap.set(share.crop, CATEGORICAL_CROP_COLORS[index])
  })

  return colorMap
}

export function colorForCropLabel(crop: string | null, colorMap: Map<string, string>): string {
  if (crop === null || crop === 'NO_PREDICTION') return NO_PREDICTION_COLOR
  if (crop === 'UNKNOWN_CROP') return UNKNOWN_CROP_COLOR
  if (crop === HARVESTED_FALLOW) return HARVESTED_FALLOW_COLOR
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

/** Turns an API crop code (or the NO_PREDICTION/UNKNOWN_CROP/HARVESTED_FALLOW sentinels) into a display label. */
export function formatCropLabel(crop: string | null): string {
  if (crop === null || crop === 'NO_PREDICTION') return 'No prediction available'
  if (crop === 'UNKNOWN_CROP') return 'Unknown crop'
  if (crop === HARVESTED_FALLOW) return 'Harvested / Fallow'
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
