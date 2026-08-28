import type { NormalizedFieldCollection, NormalizedFieldProperties } from '../../types/agricultural'
import { formatCropLabel, getPrimaryCrop } from './cropDisplay'

/** Sentinel meaning "no crop filter applied" — every field is shown, exactly as returned. */
export const ALL_CROPS = 'ALL_CROPS' as const
export type CropFilterValue = typeof ALL_CROPS | string

/**
 * The crop-filter identity for a field — mirrors the grouping summarizeCropShares already
 * uses. A field with no AMED monitoring data at all (getPrimaryCrop returns null) and one
 * whose monitoring explicitly says NO_PREDICTION render identically ("No prediction
 * available"), so they share one filter bucket instead of two visually-identical options.
 */
export function cropFilterKey(properties: NormalizedFieldProperties): string {
  return getPrimaryCrop(properties) ?? 'NO_PREDICTION'
}

export interface CropOption {
  value: string
  label: string
}

/** Crop filter options actually present among the loaded field-type features, sorted by label. */
export function getAvailableCrops(fieldCollection: NormalizedFieldCollection): CropOption[] {
  const labelByValue = new Map<string, string>()

  for (const feature of fieldCollection.features) {
    if (feature.properties.aluType !== 'field') continue
    const value = cropFilterKey(feature.properties)
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
 */
export function filterFieldsByCrop(
  fieldCollection: NormalizedFieldCollection,
  selectedCrop: CropFilterValue,
): NormalizedFieldCollection {
  if (selectedCrop === ALL_CROPS) return fieldCollection

  return {
    type: 'FeatureCollection',
    features: fieldCollection.features.filter(
      (feature) => feature.properties.aluType === 'field' && cropFilterKey(feature.properties) === selectedCrop,
    ),
  }
}
