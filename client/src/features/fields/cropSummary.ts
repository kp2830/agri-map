import type { NormalizedFieldCollection } from '../../types/agricultural'
import { getPrimaryCrop } from './cropDisplay'

export interface CropShare {
  crop: string | null
  areaSqM: number
  percentage: number
}

/** Percentage of total mapped field area associated with each predicted crop (fields only, not trees/water/wells). */
export function summarizeCropShares(fieldCollection: NormalizedFieldCollection): CropShare[] {
  const fields = fieldCollection.features.filter((feature) => feature.properties.aluType === 'field')
  const totalAreaSqM = fields.reduce((sum, feature) => sum + feature.properties.areaSqM, 0)

  const areaByCrop = new Map<string | null, number>()
  for (const feature of fields) {
    const crop = getPrimaryCrop(feature.properties)
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
