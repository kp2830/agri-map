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
