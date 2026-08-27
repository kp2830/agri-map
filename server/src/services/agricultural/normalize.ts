import type {
  AluFeatureType,
  CropPrediction,
  MonitoringSeason,
  NormalizedFieldCollection,
} from '../../types/agricultural.js'

interface AluProperties {
  alu_type: string
  area_sq_m: number
  class_confidence: number
  capture_timestamp_sec: number
}

interface MonitoringPredictionRaw {
  start_timestamp_sec: number
  end_timestamp_sec: number
  crop_1?: string
  conf_1?: number
  crop_2?: string
  conf_2?: number
  crop_3?: string
  conf_3?: number
}

interface AmedProperties {
  monitoring_prediction?: MonitoringPredictionRaw[]
}

function toMonitoringSeasons(raw: MonitoringPredictionRaw[] | undefined): MonitoringSeason[] | null {
  if (!raw || raw.length === 0) return null

  return raw.map((season) => {
    const predictions: CropPrediction[] = []

    if (season.crop_1 !== undefined && season.conf_1 !== undefined) {
      predictions.push({ crop: season.crop_1, confidence: season.conf_1 })
    }
    if (season.crop_2 !== undefined && season.conf_2 !== undefined) {
      predictions.push({ crop: season.crop_2, confidence: season.conf_2 })
    }
    if (season.crop_3 !== undefined && season.conf_3 !== undefined) {
      predictions.push({ crop: season.crop_3, confidence: season.conf_3 })
    }

    return {
      startTimestampSec: season.start_timestamp_sec,
      endTimestampSec: season.end_timestamp_sec,
      predictions,
    }
  })
}

/**
 * Joins an ALU landscape FeatureCollection with an AMED monitoring FeatureCollection
 * for the same S2 cell, matching features by their shared `id` (a Plus Code derived
 * from the feature's centroid). Fields with no matching AMED feature, or whose AMED
 * feature carries no `monitoring_prediction`, get `monitoring: null` rather than a
 * guessed value.
 */
export function joinLandscapeWithMonitoring(
  landscape: GeoJSON.FeatureCollection,
  monitoring: GeoJSON.FeatureCollection,
): NormalizedFieldCollection {
  const monitoringById = new Map<string, AmedProperties>()
  for (const feature of monitoring.features) {
    if (feature.id !== undefined) {
      monitoringById.set(String(feature.id), (feature.properties ?? {}) as AmedProperties)
    }
  }

  return {
    type: 'FeatureCollection',
    features: landscape.features.map((feature) => {
      const props = (feature.properties ?? {}) as AluProperties
      const id = feature.id !== undefined ? String(feature.id) : ''
      const matched = monitoringById.get(id)

      return {
        type: 'Feature',
        id,
        geometry: feature.geometry,
        properties: {
          aluType: props.alu_type as AluFeatureType,
          areaSqM: props.area_sq_m,
          classConfidence: props.class_confidence,
          captureTimestampSec: props.capture_timestamp_sec,
          monitoring: toMonitoringSeasons(matched?.monitoring_prediction),
        },
      }
    }),
  }
}
