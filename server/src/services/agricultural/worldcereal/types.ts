/**
 * Types for the ESA WorldCereal research integration (server/src/services/agricultural/worldcereal/).
 *
 * This is a RESEARCH/EVALUATION integration, gated by ENABLE_WORLDCEREAL_RESEARCH (see config.ts).
 * It is isolated from the production AMED decision flow: nothing here overrides, replaces, or
 * modifies an AMED result. See training/esa/worldcereal_agrimap_100_field_evaluation.md for the
 * evidence behind this integration's design and its verdict on whether WorldCereal is worth using.
 */

/** The 23 real crop classes the deployed WorldCereal CROPTYPE24 model outputs probabilities for
 *  (plus `no_crop`) — confirmed from real GeoTIFF band names, not assumed from documentation. */
export const WORLDCEREAL_CROPTYPE24_CLASSES = [
  'wheat', 'barley', 'rye', 'oats', 'maize', 'sorghum', 'rice', 'other_temporary_crops',
  'millet', 'vegetables', 'beet', 'dry_pulses_legumes', 'sunflower', 'soy_soybeans',
  'rapeseed_rape', 'other_oilseed', 'groundnuts', 'fibre_crops', 'potatoes', 'cassava',
  'tobacco', 'grass_fodder_crops', 'sugar_cane', 'no_crop',
] as const

export type WorldCerealCropType24Class = (typeof WORLDCEREAL_CROPTYPE24_CLASSES)[number]

export type WorldCerealJobStatus = 'queued' | 'running' | 'finished' | 'error' | 'unknown'

export interface WorldCerealJobHandle {
  jobId: string
  s2CellToken: string
  lat: number
  lng: number
  submittedAtIso: string
  seasonStart: string
  seasonEnd: string
}

/** Per-class probabilities at the nearest valid (non-cloud-masked) real pixel to the requested
 *  point, plus how much real valid data was actually available -- never fabricated when no
 *  valid pixel exists within the search window. */
export interface WorldCerealPixelResult {
  topClass: WorldCerealCropType24Class
  topClassProbabilityPct: number
  classProbabilitiesPct: Partial<Record<WorldCerealCropType24Class, number>>
  distanceFromRequestedPointMeters: number
}

export interface WorldCerealResult {
  jobId: string
  status: WorldCerealJobStatus
  seasonStart: string
  seasonEnd: string
  processingTimeSeconds: number | null
  realCreditsSpent: number | null
  /** Real valid-pixel accounting inside the inspection window -- the honest data-quality signal
   *  (e.g. Kurukshetra: 14 of 900 pixels valid due to real cloud cover). */
  validPixelCount: number
  totalPixelCount: number
  validPixelCoveragePct: number
  nearestValidPixel: WorldCerealPixelResult | null
  errorMessage: string | null
}

export type ConsensusVerdict =
  | 'agreement'
  | 'disagreement'
  | 'second_opinion' // AMED unknown/low-confidence, WorldCereal has a real usable result
  | 'insufficient_worldcereal_data'
  | 'worldcereal_unavailable' // job errored, still running, or crop not in CROPTYPE24 scope

export interface AmedReference {
  cropLabel: string
  confidence: number | null
}

export interface WorldCerealAmedComparison {
  amed: AmedReference
  worldCereal: WorldCerealResult | null
  verdict: ConsensusVerdict
  /** Plain-language note for a UI to display -- never a directive to change the AMED result. */
  note: string
}
