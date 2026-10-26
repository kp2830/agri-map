import type { MonitoringSeason, NormalizedFieldCollection, NormalizedFieldFeature } from '../../types/agricultural'
import { AMED_CROP_KEYS } from '../fields/cropFilter'

/** Crop-observation names that mean one of AMED's 12 crops under a different name. */
const NAME_ALIASES: Record<string, string> = {
  MAIZE: 'CORN',
  SOYBEAN: 'SOYBEANS',
  SOYABEAN: 'SOYBEANS',
  PEANUT: 'GROUNDNUT',
  CHICKPEA: 'GRAM',
  JOWAR: 'SORGHUM',
  PEARL: 'BAJRA',
  MILLET: 'BAJRA',
}

/** The AMED crop key(s) a team-logged crop name corresponds to ("Chickpea (Gram)" -> GRAM). */
export function observedCropKeys(name: string | null): string[] {
  if (!name) return []
  const keys = new Set<string>()
  for (const token of name.toUpperCase().split(/[^A-Z]+/)) {
    if (!token) continue
    keys.add(NAME_ALIASES[token] ?? token)
  }
  return [...keys]
}

/** True when AMED's crop label is the crop the team logged. CORN and MAIZE are the same crop. */
export function amedCropMatches(observedName: string | null, amedCrop: string | null): boolean {
  if (!amedCrop) return false
  const amed = NAME_ALIASES[amedCrop.toUpperCase()] ?? amedCrop.toUpperCase()
  return observedCropKeys(observedName).includes(amed)
}

/** Whether AMED can name this crop at all (it only classifies 12 crops). */
export function isAmedCoveredCrop(observedName: string | null): boolean {
  const keys = observedCropKeys(observedName)
  return (AMED_CROP_KEYS as readonly string[]).some((k) => keys.includes(k))
}

export type ModelKey = 'sunflower' | 'safflower' | 'coriander' | 'fennel'

const MODEL_KEYS_ORDER: ModelKey[] = ['sunflower', 'safflower', 'coriander', 'fennel']

/** How our models see a team-logged crop: one of AMED's 12, one of our 4 added crops, or neither. */
export type CropCoverage = 'amed' | 'added' | 'other'

export function cropCoverage(name: string | null): { coverage: CropCoverage; amedKey: string | null; modelKey: ModelKey | null } {
  const keys = observedCropKeys(name)
  const amedKey = (AMED_CROP_KEYS as readonly string[]).find((k) => keys.includes(k)) ?? null
  if (amedKey) return { coverage: 'amed', amedKey, modelKey: null }
  const modelKey = MODEL_KEYS_ORDER.find((m) => keys.includes(m.toUpperCase())) ?? null
  return modelKey ? { coverage: 'added', amedKey: null, modelKey } : { coverage: 'other', amedKey: null, modelKey: null }
}

const AMED_GROUP_LABELS: Record<string, string> = {
  CORN: 'Maize (Corn)',
  GRAM: 'Chickpea (Gram)',
  SOYBEANS: 'Soybean',
  BAJRA: 'Pearl Millet (Bajra)',
}

/** One display name per crop for grouping and filtering, so "Maize" and "Corn" are the same crop. */
export function cropGroupLabel(name: string | null): string {
  const { coverage, amedKey, modelKey } = cropCoverage(name)
  if (coverage === 'amed' && amedKey) return AMED_GROUP_LABELS[amedKey] ?? amedKey.charAt(0) + amedKey.slice(1).toLowerCase()
  if (coverage === 'added' && modelKey) return modelKey.charAt(0).toUpperCase() + modelKey.slice(1)
  return name?.trim() || 'Unknown crop'
}

/** Whether the team-logged crop is one that the given experimental model detects. */
export function isModelCrop(observedName: string | null, model: ModelKey): boolean {
  return observedCropKeys(observedName).includes(model.toUpperCase())
}

function ringContains(ring: GeoJSON.Position[], lng: number, lat: number): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function polygonContains(polygon: GeoJSON.Position[][], lng: number, lat: number): boolean {
  if (!ringContains(polygon[0], lng, lat)) return false
  return !polygon.slice(1).some((hole) => ringContains(hole, lng, lat))
}

function geometryContains(geometry: GeoJSON.Geometry, lng: number, lat: number): boolean {
  if (geometry.type === 'Polygon') return polygonContains(geometry.coordinates, lng, lat)
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.some((p) => polygonContains(p, lng, lat))
  return false
}

/** Distance from the point to the closest vertex of the geometry, in metres (rough, for "nearest field"). */
function nearestVertexMetres(geometry: GeoJSON.Geometry, lng: number, lat: number): number {
  const rings: GeoJSON.Position[][] =
    geometry.type === 'Polygon' ? geometry.coordinates : geometry.type === 'MultiPolygon' ? geometry.coordinates.flat() : []
  const cosLat = Math.cos((lat * Math.PI) / 180)
  let best = Number.POSITIVE_INFINITY
  for (const ring of rings) {
    for (const [x, y] of ring) {
      const dx = (x - lng) * 111320 * cosLat
      const dy = (y - lat) * 111320
      best = Math.min(best, Math.hypot(dx, dy))
    }
  }
  return best
}

export interface FieldMatch {
  feature: NormalizedFieldFeature
  /** 0 when the observation point is inside the field polygon. */
  distanceMetres: number
}

/** The mapped field the observation was logged in, or — when the point sits just outside every
 *  polygon — the nearest field within `maxMetres`. Null when no field is that close. */
export function findFieldAtPoint(fc: NormalizedFieldCollection, lat: number, lng: number, maxMetres = 30): FieldMatch | null {
  const fields = fc.features.filter((f) => f.properties.aluType === 'field')
  const inside = fields.find((f) => geometryContains(f.geometry, lng, lat))
  if (inside) return { feature: inside, distanceMetres: 0 }

  let best: FieldMatch | null = null
  for (const feature of fields) {
    const distanceMetres = nearestVertexMetres(feature.geometry, lng, lat)
    if (distanceMetres <= maxMetres && (!best || distanceMetres < best.distanceMetres)) best = { feature, distanceMetres }
  }
  return best
}

export type Verdict = 'match' | 'mismatch' | 'neutral'

/** Month (1-12) and year of the observation's capture date, in UTC like the AMED season dates. */
export function captureMonthYear(capturedAt: string): { month: number; year: number } {
  const d = new Date(capturedAt)
  return { month: d.getUTCMonth() + 1, year: d.getUTCFullYear() }
}

export type { MonitoringSeason }

function geometryBounds(geometry: GeoJSON.Geometry): { minLng: number; maxLng: number; minLat: number; maxLat: number } | null {
  const rings: GeoJSON.Position[][] =
    geometry.type === 'Polygon'
      ? geometry.coordinates
      : geometry.type === 'MultiPolygon'
        ? geometry.coordinates.flat()
        : geometry.type === 'LineString'
          ? [geometry.coordinates]
          : geometry.type === 'MultiLineString'
            ? geometry.coordinates
            : geometry.type === 'Point'
              ? [[geometry.coordinates]]
              : []
  let b: { minLng: number; maxLng: number; minLat: number; maxLat: number } | null = null
  for (const ring of rings)
    for (const [lng, lat] of ring) {
      b = b ? { minLng: Math.min(b.minLng, lng), maxLng: Math.max(b.maxLng, lng), minLat: Math.min(b.minLat, lat), maxLat: Math.max(b.maxLat, lat) } : { minLng: lng, maxLng: lng, minLat: lat, maxLat: lat }
    }
  return b
}

/** Keeps only the features that touch the `sideKm` x `sideKm` square centred on the point — the
 *  ALU search itself only comes in whole kilometres (min 1 km), so tighter views are cut client-side. */
export function clipToSquare(fc: NormalizedFieldCollection, lat: number, lng: number, sideKm: number): NormalizedFieldCollection {
  const half = sideKm / 2
  const dLat = half / 111.32
  const dLng = half / (111.32 * Math.max(Math.cos((lat * Math.PI) / 180), 0.01))
  return {
    type: 'FeatureCollection',
    features: fc.features.filter((f) => {
      const b = geometryBounds(f.geometry)
      return b !== null && b.maxLng >= lng - dLng && b.minLng <= lng + dLng && b.maxLat >= lat - dLat && b.minLat <= lat + dLat
    }),
  }
}
