import { AgriculturalUnderstandingApiError, callAgriculturalUnderstanding } from '../../google/agriculturalUnderstandingClient.js'

interface LookupLandscapeResponse {
  landscape?: {
    geojson?: string
  }
}

const EMPTY_FEATURE_COLLECTION: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }

/**
 * Fetches ALU landscape features for the given S2 Level-13 cell (decimal cell ID).
 * A 404 from the API means the cell genuinely has no landscape data (e.g. it's
 * outside agricultural coverage) — that's a real empty result, not a failure.
 */
export async function fetchLandscape(s2CellId: string): Promise<GeoJSON.FeatureCollection> {
  let response: LookupLandscapeResponse
  try {
    response = await callAgriculturalUnderstanding<LookupLandscapeResponse>('lookupLandscape', {
      locationSpecifier: { s2CellId },
    })
  } catch (error) {
    if (error instanceof AgriculturalUnderstandingApiError && error.status === 404) {
      return EMPTY_FEATURE_COLLECTION
    }
    throw error
  }

  if (!response.landscape?.geojson) {
    return EMPTY_FEATURE_COLLECTION
  }

  return JSON.parse(response.landscape.geojson) as GeoJSON.FeatureCollection
}
