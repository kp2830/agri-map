import type { NormalizedFieldProperties } from '../../../types/agricultural.js'
import type { SunflowerHistoricalFeatures } from './types.js'

/**
 * Derives the "historical crop rotation" signal the founder's document calls for directly from
 * this field's own real AMED monitoring history (`properties.monitoring`) — the same data
 * already powering the existing recency-first seasonal crop inference. This is NOT a second
 * historical database: it is a read of data the app already has, with zero new external calls.
 *
 * `UNKNOWN_CROP` and `NO_PREDICTION` are deliberately excluded from `distinctHistoricalCrops`
 * and never counted as evidence of anything — a season AMED couldn't classify is not evidence
 * that the field was, or wasn't, ever Sunflower. Treating it otherwise would be exactly the
 * "silently treat UNKNOWN_CROP as a confirmed negative" mistake this project has been warned
 * against.
 */
export function extractHistoricalFeatures(properties: NormalizedFieldProperties): SunflowerHistoricalFeatures {
  const seasons = properties.monitoring ?? []

  const distinctHistoricalCrops = [
    ...new Set(
      seasons
        .map((season) => season.predictions[0]?.crop)
        .filter((crop): crop is string => crop !== undefined && crop !== 'UNKNOWN_CROP' && crop !== 'NO_PREDICTION'),
    ),
  ]

  return {
    seasonCount: seasons.length,
    // Always false today: AMED has no Sunflower class in any real data observed from this
    // application (verified against ~36,000 real live-fetched fields spanning 12 distinct
    // AMED crop classes, none of which was Sunflower). Kept as a real field, not hardcoded to
    // a comment, so it reflects reality automatically if AMED's crop vocabulary ever changes.
    hasHistoricalSunflowerOccurrence: distinctHistoricalCrops.includes('SUNFLOWER'),
    distinctHistoricalCrops,
  }
}
