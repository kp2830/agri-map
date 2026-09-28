/**
 * Prediction-time feature extraction for Safflower RF v0 -- reuses the EXISTING production CDSE
 * Statistical API client (requestPolygonStatistics, same one Sunflower's own featureExtraction.ts
 * uses) rather than a new satellite client. Computes the exact 12 features in the exact order the
 * model was trained on (config.ts's EXPECTED_FEATURE_ORDER), using the SAME fixed 2025-26
 * Nov/Dec-Jan/Feb-Mar windows as training -- never a different or "current" window.
 */
import type { MultiPolygon, Polygon } from 'geojson'
import { requestPolygonStatistics } from '../../google/cdseClient.js'
import { FEATURE_WINDOWS } from './config.js'

function meanIgnoringNull(values: (number | null)[]): number | null {
  const valid = values.filter((v): v is number => v !== null && !Number.isNaN(v))
  if (valid.length === 0) return null
  return valid.reduce((a, b) => a + b, 0) / valid.length
}

export interface SafflowerRfFeatures {
  ndvi_establishment: number | null; ndvi_flowering: number | null; ndvi_harvest: number | null
  ndre_establishment: number | null; ndre_flowering: number | null; ndre_harvest: number | null
  ndwi_establishment: number | null; ndwi_flowering: number | null; ndwi_harvest: number | null
  ndyi_establishment: number | null; ndyi_flowering: number | null; ndyi_harvest: number | null
}

/** The exact ordered vector rfInference.ts expects. `null` here means "no usable satellite
 *  observation for this window" -- callers must treat any null as unavailable, never substitute
 *  a fabricated value (see service.ts). */
export function toOrderedVector(f: SafflowerRfFeatures): (number | null)[] {
  return [
    f.ndvi_establishment, f.ndvi_flowering, f.ndvi_harvest,
    f.ndre_establishment, f.ndre_flowering, f.ndre_harvest,
    f.ndwi_establishment, f.ndwi_flowering, f.ndwi_harvest,
    f.ndyi_establishment, f.ndyi_flowering, f.ndyi_harvest,
  ]
}

export async function extractSafflowerRfFeatures(geometry: Polygon | MultiPolygon, signal?: AbortSignal): Promise<SafflowerRfFeatures> {
  const [establishment, flowering, harvest] = await Promise.all([
    requestPolygonStatistics(geometry, FEATURE_WINDOWS.establishment.start, FEATURE_WINDOWS.establishment.end, signal),
    requestPolygonStatistics(geometry, FEATURE_WINDOWS.flowering.start, FEATURE_WINDOWS.flowering.end, signal),
    requestPolygonStatistics(geometry, FEATURE_WINDOWS.harvest.start, FEATURE_WINDOWS.harvest.end, signal),
  ])

  return {
    ndvi_establishment: meanIgnoringNull(establishment.dailySeriesByIndex.ndvi.map((o) => o.mean)),
    ndvi_flowering: meanIgnoringNull(flowering.dailySeriesByIndex.ndvi.map((o) => o.mean)),
    ndvi_harvest: meanIgnoringNull(harvest.dailySeriesByIndex.ndvi.map((o) => o.mean)),
    ndre_establishment: meanIgnoringNull(establishment.dailySeriesByIndex.ndre.map((o) => o.mean)),
    ndre_flowering: meanIgnoringNull(flowering.dailySeriesByIndex.ndre.map((o) => o.mean)),
    ndre_harvest: meanIgnoringNull(harvest.dailySeriesByIndex.ndre.map((o) => o.mean)),
    ndwi_establishment: meanIgnoringNull(establishment.dailySeriesByIndex.ndwi.map((o) => o.mean)),
    ndwi_flowering: meanIgnoringNull(flowering.dailySeriesByIndex.ndwi.map((o) => o.mean)),
    ndwi_harvest: meanIgnoringNull(harvest.dailySeriesByIndex.ndwi.map((o) => o.mean)),
    ndyi_establishment: meanIgnoringNull(establishment.dailySeriesByIndex.ndyi.map((o) => o.mean)),
    ndyi_flowering: meanIgnoringNull(flowering.dailySeriesByIndex.ndyi.map((o) => o.mean)),
    ndyi_harvest: meanIgnoringNull(harvest.dailySeriesByIndex.ndyi.map((o) => o.mean)),
  }
}
