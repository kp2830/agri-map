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

export type ActiveCropOutcome = { kind: 'active'; season: MonitoringSeason } | { kind: 'none' }

/**
 * Determines which AMED monitoring season represents the field's crop to show.
 *
 * IMPORTANT — a season's own end date having passed is NOT, by itself, evidence that a field
 * is currently fallow. Verified directly against live AMED data across many real fields: the
 * *most recently available* monitoring season for essentially every field ends somewhere
 * between weeks and several months before the real current date — a uniform data-freshness/
 * processing-lag characteristic of the AMED pipeline (a growing season has to finish, then be
 * classified, before it can be published), not a per-field signal that that specific field
 * has gone fallow. An earlier version of this function treated "ended" as proof of a
 * "Harvested / Fallow" state and, because that lag is universal, ended up mislabeling
 * essentially every field in every search as fallow — this function does not repeat that.
 *
 * The raw AMED response (server/src/services/agricultural/normalize.ts) provides no field
 * beyond `start_timestamp_sec`/`end_timestamp_sec` and up to three ranked crop predictions
 * per season — no explicit "current season" flag, no snapshot/as-of date, no fallow/no-crop
 * sentinel distinct from the existing NO_PREDICTION/UNKNOWN_CROP values already handled
 * elsewhere. So:
 *
 * 1. If a season's [start, end] window genuinely covers `nowSec`, that's the strongest
 *    possible signal AMED could give — use it directly.
 * 2. Otherwise (the normal case in practice, per the lag above), fall back to the most
 *    recently *started* season — the best available information, and the same behavior this
 *    app used before date-aware detection was introduced. Its own end date having passed is
 *    not treated as evidence of anything beyond "this is the most recent classified season."
 * 3. Only when there is no monitoring data at all is there truly nothing to report.
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
  const candidates = ongoing.length > 0 ? ongoing : seasons
  const season = candidates.reduce((latest, season) => (season.startTimestampSec > latest.startTimestampSec ? season : latest))
  return { kind: 'active', season }
}

/** The crop to show for this field: the determined season's top prediction, or null if AMED
 *  never had monitoring data for it at all. */
export function getPrimaryCrop(properties: NormalizedFieldProperties): string | null {
  const outcome = getActiveCropOutcome(properties)
  return outcome.kind === 'active' ? (outcome.season.predictions[0]?.crop ?? null) : null
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
