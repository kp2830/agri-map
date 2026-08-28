import { geojson, s1, s2 } from 's2js'

const { degrees } = s1.angle

/** Default S2 cell level used when one isn't specified (~1km cell width). */
const DEFAULT_LEVEL = 13

/** Converts a lat/lng coordinate to the token of the S2 cell containing it. */
export function latLngToCellToken(lat: number, lng: number, level: number = DEFAULT_LEVEL): string {
  const leaf = s2.cellid.fromLatLng(s2.LatLng.fromDegrees(lat, lng))
  const cell = s2.cellid.parent(leaf, level)
  return s2.cellid.toToken(cell)
}

/**
 * Converts a lat/lng coordinate to the decimal string form of the S2 cell ID
 * containing it — the format the Agricultural Understanding API's
 * `locationSpecifier.s2CellId` expects (a 64-bit unsigned integer as a
 * decimal string), distinct from the hex `token` form used elsewhere.
 */
export function latLngToCellId(lat: number, lng: number, level: number = DEFAULT_LEVEL): string {
  const leaf = s2.cellid.fromLatLng(s2.LatLng.fromDegrees(lat, lng))
  const cell = s2.cellid.parent(leaf, level)
  return cell.toString()
}

/** Returns the center lat/lng of the S2 cell identified by the given token. */
export function cellTokenToLatLng(token: string): { lat: number; lng: number } {
  const cell = s2.cellid.fromToken(token)
  const center = s2.cellid.latLng(cell)
  return { lat: degrees(center.lat), lng: degrees(center.lng) }
}

export interface CoveringOptions {
  minLevel?: number
  maxLevel?: number
  maxCells?: number
}

/** Returns the tokens of the S2 cells that cover a GeoJSON geometry. */
export function getCoveringCellTokens(
  geometry: GeoJSON.Geometry,
  options: CoveringOptions = {},
): string[] {
  const coverer = new geojson.RegionCoverer({
    minLevel: options.minLevel ?? DEFAULT_LEVEL,
    maxLevel: options.maxLevel ?? DEFAULT_LEVEL,
    maxCells: options.maxCells ?? 64,
  })

  return coverer.covering(geometry).map((cell) => s2.cellid.toToken(cell))
}

/** Converts an S2 cell token to the decimal cell-ID string the Agricultural Understanding API expects. */
export function cellTokenToCellId(token: string): string {
  return s2.cellid.fromToken(token).toString()
}

const KM_PER_DEGREE_LAT = 111.32

/** Approximate square GeoJSON polygon of the given side length (km), centered on lat/lng. */
function squareAroundPoint(lat: number, lng: number, sideKm: number): GeoJSON.Polygon {
  const halfKm = sideKm / 2
  const dLat = halfKm / KM_PER_DEGREE_LAT
  const cosLat = Math.max(Math.cos((lat * Math.PI) / 180), 0.01)
  const dLng = halfKm / (KM_PER_DEGREE_LAT * cosLat)

  return {
    type: 'Polygon',
    coordinates: [
      [
        [lng - dLng, lat - dLat],
        [lng + dLng, lat - dLat],
        [lng + dLng, lat + dLat],
        [lng - dLng, lat + dLat],
        [lng - dLng, lat - dLat],
      ],
    ],
  }
}

/**
 * Returns the Level-13 S2 cell tokens covering an approximately `sideKm` x `sideKm`
 * square area centered on lat/lng. The S2 cell level itself is unchanged (still
 * Level 13, ~1km cell width) — this only determines how many of those existing
 * cells are needed to cover an area larger than a single cell.
 */
export function getCellTokensForSquareArea(lat: number, lng: number, sideKm: number): string[] {
  return getCoveringCellTokens(squareAroundPoint(lat, lng, sideKm), {
    minLevel: DEFAULT_LEVEL,
    maxLevel: DEFAULT_LEVEL,
    maxCells: 4096,
  })
}
