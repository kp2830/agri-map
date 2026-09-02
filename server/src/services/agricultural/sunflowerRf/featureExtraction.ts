/**
 * Prediction-time feature extraction for Sunflower RF v0 — reuses the EXISTING production CDSE
 * Statistical API client (requestPolygonStatistics, already used by the older likeness model and
 * throughout training/sunflower/) rather than a new satellite client. Computes the exact 13
 * features in the exact order the model was trained on (config.ts's EXPECTED_FEATURE_ORDER),
 * using the SAME fixed 2026 April/May/June windows as training — never a different or
 * "current" window.
 */
import type { MultiPolygon, Polygon } from 'geojson'
import { requestPolygonStatistics } from '../../google/cdseClient.js'
import { FEATURE_WINDOWS } from './config.js'

function meanIgnoringNull(values: (number | null)[]): number | null {
  const valid = values.filter((v): v is number => v !== null && !Number.isNaN(v))
  if (valid.length === 0) return null
  return valid.reduce((a, b) => a + b, 0) / valid.length
}

export interface SunflowerRfFeatures {
  ndvi_apr: number | null; ndvi_may: number | null; ndvi_june: number | null; ndvi_apr_june_change: number | null
  ndre_apr: number | null; ndre_may: number | null; ndre_june: number | null
  ndwi_apr: number | null; ndwi_may: number | null; ndwi_june: number | null
  ndyi_apr: number | null; ndyi_may: number | null; ndyi_june: number | null
}

/** The exact ordered vector rfInference.ts expects. `null` here means "no usable satellite
 *  observation for this window" — callers must treat any null as unavailable, never substitute
 *  a fabricated value (see service.ts). */
export function toOrderedVector(f: SunflowerRfFeatures): (number | null)[] {
  return [
    f.ndvi_apr, f.ndvi_may, f.ndvi_june, f.ndvi_apr_june_change,
    f.ndre_apr, f.ndre_may, f.ndre_june,
    f.ndwi_apr, f.ndwi_may, f.ndwi_june,
    f.ndyi_apr, f.ndyi_may, f.ndyi_june,
  ]
}

export async function extractSunflowerRfFeatures(geometry: Polygon | MultiPolygon, signal?: AbortSignal): Promise<SunflowerRfFeatures> {
  const [april, may, june] = await Promise.all([
    requestPolygonStatistics(geometry, FEATURE_WINDOWS.april.start, FEATURE_WINDOWS.april.end, signal),
    requestPolygonStatistics(geometry, FEATURE_WINDOWS.may.start, FEATURE_WINDOWS.may.end, signal),
    requestPolygonStatistics(geometry, FEATURE_WINDOWS.june.start, FEATURE_WINDOWS.june.end, signal),
  ])

  const ndviApr = meanIgnoringNull(april.dailySeriesByIndex.ndvi.map((o) => o.mean))
  const ndviMay = meanIgnoringNull(may.dailySeriesByIndex.ndvi.map((o) => o.mean))
  const ndviJune = meanIgnoringNull(june.dailySeriesByIndex.ndvi.map((o) => o.mean))

  return {
    ndvi_apr: ndviApr, ndvi_may: ndviMay, ndvi_june: ndviJune,
    ndvi_apr_june_change: ndviApr !== null && ndviJune !== null ? ndviApr - ndviJune : null,
    ndre_apr: meanIgnoringNull(april.dailySeriesByIndex.ndre.map((o) => o.mean)),
    ndre_may: meanIgnoringNull(may.dailySeriesByIndex.ndre.map((o) => o.mean)),
    ndre_june: meanIgnoringNull(june.dailySeriesByIndex.ndre.map((o) => o.mean)),
    ndwi_apr: meanIgnoringNull(april.dailySeriesByIndex.ndwi.map((o) => o.mean)),
    ndwi_may: meanIgnoringNull(may.dailySeriesByIndex.ndwi.map((o) => o.mean)),
    ndwi_june: meanIgnoringNull(june.dailySeriesByIndex.ndwi.map((o) => o.mean)),
    ndyi_apr: meanIgnoringNull(april.dailySeriesByIndex.ndyi.map((o) => o.mean)),
    ndyi_may: meanIgnoringNull(may.dailySeriesByIndex.ndyi.map((o) => o.mean)),
    ndyi_june: meanIgnoringNull(june.dailySeriesByIndex.ndyi.map((o) => o.mean)),
  }
}
