/**
 * Real, published vegetation/SAR index formulas used by the Sunflower feature pipeline. These
 * are pure math functions — correct regardless of whether real satellite reflectance values are
 * ever wired in (see featureExtraction.ts for why they aren't yet). Nothing here invents a
 * band value or a crop's expected index value; it only computes an index FROM given values.
 *
 * All reflectance inputs are expected as calibrated surface reflectance in [0, 1] (i.e. already
 * divided by the sensor's scale factor — Sentinel-2 SR products are typically delivered as
 * integers up to 10000, so callers must divide by 10000 before calling these).
 */

/** NDVI (Normalized Difference Vegetation Index), Rouse et al. 1974 — the standard vegetation
 *  greenness index: (NIR − Red) / (NIR + Red). Sentinel-2: NIR = B8, Red = B4. */
export function ndvi(nir: number, red: number): number | null {
  const denom = nir + red
  if (denom === 0) return null
  return (nir - red) / denom
}

/** NDRE (Normalized Difference Red Edge), Barnes et al. 2000 — canopy nitrogen/biomass-sensitive
 *  index using a red-edge band instead of red, more sensitive to canopy structure once NDVI has
 *  saturated at moderate-to-high biomass: (NIR − RedEdge) / (NIR + RedEdge). Sentinel-2:
 *  NIR = B8 (or the narrower B8A), RedEdge = B5 (705nm). */
export function ndre(nir: number, redEdge: number): number | null {
  const denom = nir + redEdge
  if (denom === 0) return null
  return (nir - redEdge) / denom
}

/**
 * NDWI (Normalized Difference Water Index) — canopy water content variant, Gao 1996:
 * (NIR − SWIR) / (NIR + SWIR). Sentinel-2: NIR = B8A, SWIR = B11.
 *
 * NOTE: "NDWI" is an overloaded name in the remote-sensing literature. McFeeters 1996 defines a
 * DIFFERENT formula — (Green − NIR) / (Green + NIR) — intended for detecting open water bodies,
 * not canopy water content. The founder's document describes NDWI for "canopy-water
 * information", which is the Gao (NIR/SWIR) definition, not the McFeeters (Green/NIR) one — that
 * is the formula implemented here. Documented explicitly so this choice can be checked against
 * the original document text, which this session has not had direct access to (only
 * paraphrased descriptions across the conversation).
 */
export function ndwiCanopyWater(nir: number, swir: number): number | null {
  const denom = nir + swir
  if (denom === 0) return null
  return (nir - swir) / denom
}

/**
 * Normalized Difference Yellowness Index (NDYI): (Green − Blue) / (Green + Blue). Published and
 * validated for detecting yellow-flowering crops from Sentinel-2/MODIS imagery in canola/
 * rapeseed bloom-mapping literature (e.g. Zhou et al., large-scale canola flowering detection).
 * Adapted here as the initial candidate Sunflower yellowness feature, since Sunflower shares the
 * same large-yellow-petal flowering signature canola work targets.
 *
 * IMPORTANT: this is a real, citable, currently-standard yellow-flower remote-sensing index —
 * but it is a CANDIDATE choice, not a value taken from the founder's original document (this
 * session only had paraphrased descriptions of that document, never the document itself). If
 * the original document specifies a different yellowness formula, this must be reconciled
 * against it before being treated as final.
 */
export function ndyiYellowness(green: number, blue: number): number | null {
  const denom = green + blue
  if (denom === 0) return null
  return (green - blue) / denom
}

/**
 * Ordinary least-squares slope of `values` against `daysSinceFirst` — the generic "temporal
 * growth rate" building block behind NDVI slope, NDRE slope, yellowness slope, and the SAR
 * VV/VH temporal-change feature. Returns null (not 0) when there are fewer than 2 points, since
 * a slope genuinely cannot be computed from a single observation — a missing signal must never
 * be silently reported as "no change".
 */
export function temporalSlope(observations: { daysSinceFirst: number; value: number }[]): number | null {
  const n = observations.length
  if (n < 2) return null

  const meanX = observations.reduce((sum, o) => sum + o.daysSinceFirst, 0) / n
  const meanY = observations.reduce((sum, o) => sum + o.value, 0) / n

  let numerator = 0
  let denominator = 0
  for (const { daysSinceFirst, value } of observations) {
    numerator += (daysSinceFirst - meanX) * (value - meanY)
    denominator += (daysSinceFirst - meanX) ** 2
  }

  if (denominator === 0) return null
  return numerator / denominator
}

/** Arithmetic mean, null-safe: ignores null entries rather than treating them as 0, and returns
 *  null (not 0) if every entry is null/absent — a missing observation must never read as "0". */
export function meanIgnoringNulls(values: (number | null)[]): number | null {
  const real = values.filter((v): v is number => v !== null && Number.isFinite(v))
  if (real.length === 0) return null
  return real.reduce((sum, v) => sum + v, 0) / real.length
}
