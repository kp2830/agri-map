import type { NormalizedFieldCollection } from '../../types/agricultural'
import { getPrimaryCrop, SUNFLOWER_MAP_COLOR_THRESHOLD_PERCENT } from './cropDisplay'

export interface CropShare {
  crop: string | null
  areaSqM: number
  percentage: number
}

/** The crop key used for the Sunflower RF row in the distribution — never a real AMED crop
 *  label (AMED has no Sunflower class at all, which is the entire reason this model exists),
 *  so there's no risk of colliding with a genuine AMED-predicted crop of the same name. */
export const SUNFLOWER_CROP_KEY = 'SUNFLOWER'

/** Percentage of total mapped field area associated with each predicted crop (fields only, not
 *  trees/water/wells). `nowSec` defaults to real "now" but passes through to getPrimaryCrop so
 *  the distribution can be recomputed for a different reference month (see
 *  monthToReferenceDateSec) from the same already-loaded data — no new fetch. */
export function summarizeCropShares(fieldCollection: NormalizedFieldCollection, nowSec: number = Date.now() / 1000): CropShare[] {
  const fields = fieldCollection.features.filter((feature) => feature.properties.aluType === 'field')
  const totalAreaSqM = fields.reduce((sum, feature) => sum + feature.properties.areaSqM, 0)

  const areaByCrop = new Map<string | null, number>()
  for (const feature of fields) {
    const crop = getPrimaryCrop(feature.properties, nowSec)
    areaByCrop.set(crop, (areaByCrop.get(crop) ?? 0) + feature.properties.areaSqM)
  }

  return [...areaByCrop.entries()]
    .map(([crop, areaSqM]) => ({
      crop,
      areaSqM,
      percentage: totalAreaSqM > 0 ? areaSqM / totalAreaSqM : 0,
    }))
    .sort((a, b) => b.areaSqM - a.areaSqM)
}

/**
 * Sunflower's share, computed from the SAME real per-field RF probabilities the map coloring
 * uses (sunflowerProbabilities — never a separate/duplicated calculation, never fabricated).
 * Uses the same field-area denominator as summarizeCropShares so the percentage is on a
 * comparable scale, but this is an ADDITIVE, independent signal, not a partition of the same
 * pie: a field already counted under its AMED crop (e.g. Corn) also counts here if its RF
 * probability clears the threshold, so the full set of percentages is not expected to sum to
 * 100%. Returns `null` (render nothing) rather than a fabricated zero row when no field in this
 * search has been checked yet or none cleared the threshold.
 */
export function computeSunflowerShare(
  fieldCollection: NormalizedFieldCollection,
  sunflowerProbabilities: Map<string, number>,
  thresholdPercent: number = SUNFLOWER_MAP_COLOR_THRESHOLD_PERCENT,
): CropShare | null {
  const fields = fieldCollection.features.filter((feature) => feature.properties.aluType === 'field')
  const totalAreaSqM = fields.reduce((sum, feature) => sum + feature.properties.areaSqM, 0)

  let sunflowerAreaSqM = 0
  let sunflowerFieldCount = 0
  for (const feature of fields) {
    if (feature.id === undefined) continue
    const probabilityPercent = sunflowerProbabilities.get(String(feature.id))
    if (probabilityPercent !== undefined && probabilityPercent > thresholdPercent) {
      sunflowerAreaSqM += feature.properties.areaSqM
      sunflowerFieldCount++
    }
  }

  if (sunflowerFieldCount === 0) return null
  return { crop: SUNFLOWER_CROP_KEY, areaSqM: sunflowerAreaSqM, percentage: totalAreaSqM > 0 ? sunflowerAreaSqM / totalAreaSqM : 0 }
}
