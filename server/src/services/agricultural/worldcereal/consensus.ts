/**
 * Plain comparison between an existing AMED result and a WorldCereal result for the same field.
 * NEVER decides which one is "right" and NEVER overrides the AMED result — this only classifies
 * the relationship between the two into one of the ConsensusVerdict cases so a UI (or a human
 * reviewing the 100-field evaluation) can see it at a glance. See
 * training/esa/worldcereal_agrimap_100_field_evaluation.md for why this stays advisory-only.
 */
import type { AmedReference, WorldCerealAmedComparison, WorldCerealResult } from './types.js'

/** AMED crop labels (production taxonomy) that map to a real WorldCereal CROPTYPE24 class.
 *  Deliberately conservative — only crops with a genuine, close real-world correspondence, not
 *  a loose "same food group" guess. See the report's crop coverage matrix for the full picture,
 *  including AMED/AgriMap-target crops that have NO WorldCereal counterpart at all. */
const AMED_TO_WORLDCEREAL_CLASS: Record<string, string> = {
  RICE: 'rice', CORN: 'maize', SUGARCANE: 'sugar_cane', SORGHUM: 'sorghum',
  GROUNDNUT: 'groundnuts', SOYBEANS: 'soy_soybeans', WHEAT: 'wheat', BAJRA: 'millet',
  COTTON: 'fibre_crops', GRAM: 'dry_pulses_legumes', MUSTARD: 'rapeseed_rape',
  SUNFLOWER: 'sunflower',
}

const AMED_LOW_CONFIDENCE_THRESHOLD = 0.35
const WORLDCEREAL_MIN_USABLE_PROBABILITY_PCT = 30
const WORLDCEREAL_MIN_VALID_PIXEL_COVERAGE_PCT = 5

export function compareAmedAndWorldCereal(amed: AmedReference, worldCereal: WorldCerealResult | null): WorldCerealAmedComparison {
  if (!worldCereal || worldCereal.status !== 'finished') {
    return {
      amed, worldCereal,
      verdict: 'worldcereal_unavailable',
      note: worldCereal?.status === 'error'
        ? `WorldCereal job failed (${worldCereal.errorMessage ?? 'unknown cause'}) — no independent evidence available for this field.`
        : 'WorldCereal result not yet available for this field.',
    }
  }

  const coveragePct = worldCereal.validPixelCoveragePct
  const pixel = worldCereal.nearestValidPixel
  if (!pixel || coveragePct < WORLDCEREAL_MIN_VALID_PIXEL_COVERAGE_PCT) {
    return {
      amed, worldCereal,
      verdict: 'insufficient_worldcereal_data',
      note: `Only ${worldCereal.validPixelCount}/${worldCereal.totalPixelCount} pixels (${coveragePct.toFixed(1)}%) had valid data near this point (real cloud cover / seasonal gaps) — too sparse to treat as independent evidence.`,
    }
  }

  const amedLower = amed.cropLabel.trim().toUpperCase()
  const isAmedUnknownOrLow = amedLower === 'UNKNOWN' || amed.confidence === null || amed.confidence < AMED_LOW_CONFIDENCE_THRESHOLD

  if (pixel.topClassProbabilityPct < WORLDCEREAL_MIN_USABLE_PROBABILITY_PCT) {
    return {
      amed, worldCereal,
      verdict: 'insufficient_worldcereal_data',
      note: `WorldCereal's top class (${pixel.topClass}) only reached ${pixel.topClassProbabilityPct}% probability at the nearest valid pixel — too weak to treat as a usable signal either way.`,
    }
  }

  const expectedWorldCerealClass = AMED_TO_WORLDCEREAL_CLASS[amedLower]
  const agrees = expectedWorldCerealClass !== undefined && expectedWorldCerealClass === pixel.topClass

  if (isAmedUnknownOrLow) {
    return {
      amed, worldCereal,
      verdict: 'second_opinion',
      note: `AMED is ${amedLower === 'UNKNOWN' ? 'Unknown' : `low-confidence (${((amed.confidence ?? 0) * 100).toFixed(0)}%)`} for this field; WorldCereal independently suggests ${pixel.topClass} at ${pixel.topClassProbabilityPct}% — a second opinion, not a replacement for AMED's own result.`,
    }
  }

  if (agrees) {
    return {
      amed, worldCereal,
      verdict: 'agreement',
      note: `AMED (${amedLower}) and WorldCereal (${pixel.topClass} at ${pixel.topClassProbabilityPct}%) agree — two independently-trained models reaching the same conclusion.`,
    }
  }

  return {
    amed, worldCereal,
    verdict: 'disagreement',
    note: `AMED says ${amedLower}${amed.confidence !== null ? ` (${(amed.confidence * 100).toFixed(0)}%)` : ''}; WorldCereal independently suggests ${pixel.topClass} (${pixel.topClassProbabilityPct}%). Shown as a disagreement for the record — AMED's result is NOT overridden.`,
  }
}
