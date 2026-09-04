import type { NormalizedFieldCollection, NormalizedFieldProperties } from '../../types/agricultural'
import { formatCropLabel, getPrimaryCrop, SUNFLOWER_MAP_COLOR_THRESHOLD_PERCENT } from './cropDisplay'
import { SUNFLOWER_CROP_KEY } from './cropSummary'

/** Sentinel meaning "no crop filter applied" — every field is shown, exactly as returned. */
export const ALL_CROPS = 'ALL_CROPS' as const
export type CropFilterValue = typeof ALL_CROPS | string

/**
 * The crop-filter identity for a field — mirrors the grouping summarizeCropShares already
 * uses. A field with no AMED monitoring data at all (getPrimaryCrop returns null) and one
 * whose monitoring explicitly says NO_PREDICTION render identically ("No prediction
 * available"), so they share one filter bucket instead of two visually-identical options.
 *
 * `nowSec` defaults to real "now" but passes straight through to getPrimaryCrop so the whole
 * filter/distribution view can be recomputed for a different reference month (see
 * monthToReferenceDateSec) without a new ALU/AMED fetch — same already-loaded monitoring data,
 * just re-evaluated against a different date.
 */
export function cropFilterKey(properties: NormalizedFieldProperties, nowSec: number = Date.now() / 1000): string {
  return getPrimaryCrop(properties, nowSec) ?? 'NO_PREDICTION'
}

export interface CropOption {
  value: string
  label: string
}

/** Crop filter options actually present among the loaded field-type features, sorted by label. */
export function getAvailableCrops(fieldCollection: NormalizedFieldCollection, nowSec: number = Date.now() / 1000): CropOption[] {
  const labelByValue = new Map<string, string>()

  for (const feature of fieldCollection.features) {
    if (feature.properties.aluType !== 'field') continue
    const value = cropFilterKey(feature.properties, nowSec)
    if (!labelByValue.has(value)) labelByValue.set(value, formatCropLabel(value))
  }

  return [...labelByValue.entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

/** Total real field area (m²) across all field-type features — never trees/water/wells. */
export function totalFieldAreaSqM(fieldCollection: NormalizedFieldCollection): number {
  return fieldCollection.features
    .filter((feature) => feature.properties.aluType === 'field')
    .reduce((sum, feature) => sum + feature.properties.areaSqM, 0)
}

/**
 * Filters the already-loaded field collection down to the fields matching the selected
 * crop. Purely client-side — no network request, no new S2/ALU/AMED lookup, and the
 * input collection is never mutated. Returns it unchanged when no filter is applied.
 *
 * SUNFLOWER_CROP_KEY is a special case: it's not a real AMED crop (cropFilterKey never
 * produces it), so this matches by `sunflowerProbabilities` instead — the SAME real per-field
 * RF results driving the map's gold coloring, never a separate calculation, and NOT affected
 * by `nowSec` (the Sunflower RF signal is deliberately independent of the selected reference
 * month — see colorForFeatureWithSunflower). `sunflowerProbabilities` is optional so every
 * other crop selection stays a pure function of `fieldCollection`/`selectedCrop`/`nowSec` alone,
 * unaffected by Sunflower RF results still arriving in the background.
 */
export function filterFieldsByCrop(
  fieldCollection: NormalizedFieldCollection,
  selectedCrop: CropFilterValue,
  sunflowerProbabilities?: Map<string, number>,
  sunflowerThresholdPercent: number = SUNFLOWER_MAP_COLOR_THRESHOLD_PERCENT,
  nowSec: number = Date.now() / 1000,
): NormalizedFieldCollection {
  if (selectedCrop === ALL_CROPS) return fieldCollection

  if (selectedCrop === SUNFLOWER_CROP_KEY) {
    return {
      type: 'FeatureCollection',
      features: fieldCollection.features.filter((feature) => {
        if (feature.properties.aluType !== 'field' || feature.id === undefined) return false
        const probabilityPercent = sunflowerProbabilities?.get(String(feature.id))
        return probabilityPercent !== undefined && probabilityPercent > sunflowerThresholdPercent
      }),
    }
  }

  return {
    type: 'FeatureCollection',
    features: fieldCollection.features.filter(
      (feature) => feature.properties.aluType === 'field' && cropFilterKey(feature.properties, nowSec) === selectedCrop,
    ),
  }
}
