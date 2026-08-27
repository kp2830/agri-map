import type { AluFeatureType, NormalizedFieldProperties } from '../../types/agricultural'

const NEUTRAL_COLORS: Record<Exclude<AluFeatureType, 'field'>, string> = {
  trees: '#16a34a',
  farm_pond: '#0ea5e9',
  other_water: '#38bdf8',
  dug_well: '#78716c',
}

const NO_PREDICTION_COLOR = '#94a3b8'
const UNKNOWN_CROP_COLOR = '#64748b'

/** Deterministic color for a crop name so the same crop always renders the same color. */
function colorForCropName(crop: string): string {
  let hash = 0
  for (let i = 0; i < crop.length; i++) {
    hash = (hash * 31 + crop.charCodeAt(i)) >>> 0
  }
  return `hsl(${hash % 360}, 65%, 45%)`
}

/** The most recent monitored crop season's top prediction, or null if AMED has no monitoring data. */
export function getPrimaryCrop(properties: NormalizedFieldProperties): string | null {
  if (!properties.monitoring || properties.monitoring.length === 0) return null

  const latestSeason = properties.monitoring.reduce((latest, season) =>
    season.startTimestampSec > latest.startTimestampSec ? season : latest,
  )

  return latestSeason.predictions[0]?.crop ?? null
}

/** Color for a crop label as used in the summary legend (independent of ALU feature type). */
export function colorForCropSwatch(crop: string | null): string {
  if (crop === null || crop === 'NO_PREDICTION') return NO_PREDICTION_COLOR
  if (crop === 'UNKNOWN_CROP') return UNKNOWN_CROP_COLOR
  return colorForCropName(crop)
}

export function colorForFeature(properties: NormalizedFieldProperties): string {
  if (properties.aluType !== 'field') {
    return NEUTRAL_COLORS[properties.aluType]
  }

  return colorForCropSwatch(getPrimaryCrop(properties))
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

export function formatArea(areaSqM: number): string {
  return `${areaSqM.toLocaleString(undefined, { maximumFractionDigits: 0 })} m² (${(areaSqM / 10000).toFixed(2)} ha)`
}
