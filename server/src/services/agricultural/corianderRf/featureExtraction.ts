/**
 * Prediction-time feature extraction for Coriander RF v0 -- reuses the production CDSE Statistical API
 * client (requestPolygonStatistics). Computes the exact 4 features in the exact order the model was
 * trained on (config.ts's EXPECTED_FEATURE_ORDER) on the same fixed 2025-26 rabi windows as training.
 * Each feature is the MEDIAN of the per-scene field means in its window (training used the median).
 */
import type { MultiPolygon, Polygon } from 'geojson'
import { requestPolygonStatistics } from '../../google/cdseClient.js'
import { CORIANDER_FEATURE_WINDOWS as W } from './config.js'

function medianIgnoringNull(values: (number | null)[]): number | null {
  const valid = values.filter((v): v is number => v !== null && !Number.isNaN(v)).sort((a, b) => a - b)
  if (valid.length === 0) return null
  const mid = Math.floor(valid.length / 2)
  return valid.length % 2 ? valid[mid] : (valid[mid - 1] + valid[mid]) / 2
}

export interface CorianderRfFeatures {
  ndvi_dec: number | null
  ndyi_decfeb: number | null
  ndvi_feb: number | null
  ndvi_mar: number | null
}

/** The exact ordered vector rfInference.ts expects. `null` means no usable observation in that window --
 *  callers treat any null as unavailable, never substituting a made-up value (see service.ts). */
export function toOrderedVector(f: CorianderRfFeatures): (number | null)[] {
  return [f.ndvi_dec, f.ndyi_decfeb, f.ndvi_feb, f.ndvi_mar]
}

export async function extractCorianderRfFeatures(geometry: Polygon | MultiPolygon, signal?: AbortSignal): Promise<CorianderRfFeatures> {
  const [dec, decFeb, feb, mar] = await Promise.all([
    requestPolygonStatistics(geometry, W.dec.start, W.dec.end, signal),
    requestPolygonStatistics(geometry, W.decFeb.start, W.decFeb.end, signal),
    requestPolygonStatistics(geometry, W.feb.start, W.feb.end, signal),
    requestPolygonStatistics(geometry, W.mar.start, W.mar.end, signal),
  ])
  return {
    ndvi_dec: medianIgnoringNull(dec.dailySeriesByIndex.ndvi.map((o) => o.mean)),
    ndyi_decfeb: medianIgnoringNull(decFeb.dailySeriesByIndex.ndyi.map((o) => o.mean)),
    ndvi_feb: medianIgnoringNull(feb.dailySeriesByIndex.ndvi.map((o) => o.mean)),
    ndvi_mar: medianIgnoringNull(mar.dailySeriesByIndex.ndvi.map((o) => o.mean)),
  }
}
