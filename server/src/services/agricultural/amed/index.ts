import { AgriculturalUnderstandingApiError, callAgriculturalUnderstanding } from '../../google/agriculturalUnderstandingClient.js'

interface MonitorLandscapeResponse {
  monitoredLandscape?: {
    geojson?: string
  }
}

const EMPTY_FEATURE_COLLECTION: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }

/**
 * Fetches AMED crop monitoring features for the given S2 Level-13 cell (decimal cell ID).
 * A 404 from the API means the cell genuinely has no monitoring data — that's a
 * real empty result (e.g. a cell with only non-field features), not a failure.
 */
export async function fetchMonitoring(s2CellId: string): Promise<GeoJSON.FeatureCollection> {
  let response: MonitorLandscapeResponse
  try {
    response = await callAgriculturalUnderstanding<MonitorLandscapeResponse>('monitorLandscape', {
      locationSpecifier: { s2CellId },
    })
  } catch (error) {
    if (error instanceof AgriculturalUnderstandingApiError && error.status === 404) {
      return EMPTY_FEATURE_COLLECTION
    }
    throw error
  }

  if (!response.monitoredLandscape?.geojson) {
    return EMPTY_FEATURE_COLLECTION
  }

  return JSON.parse(response.monitoredLandscape.geojson) as GeoJSON.FeatureCollection
}
