import type { Request, Response } from 'express'
import { buildAmedHypotheses } from '../services/agricultural/sunflower/amedHypotheses.js'
import { isSupportedFieldGeometry } from '../services/google/cdseClient.js'
import { getSunflowerRfPrediction, isEligibleForSunflowerRf } from '../services/agricultural/sunflowerRf/service.js'
import type { NormalizedFieldFeature } from '../types/agricultural.js'

/**
 * Sunflower RF v0 — an ADDITIVE signal only. Gated on: (1) the caller's selected month actually
 * being one Sunflower could plausibly be growing in (see growingSeasonGate.ts — this is the real
 * fix for why Sunflower RF was temporarily hidden from the frontend), then (2) the existing
 * production AMED strong-confidence logic (buildAmedHypotheses + the same 0.8 threshold
 * overridePolicy.ts already uses). The client decides whether to call this at all (see
 * FieldDetailsPanel) — but both gates are re-checked server-side too, so a client bug can never
 * cause an unnecessary CDSE spend or a misleading result.
 *
 * Never overrides, modifies, or is merged into the AMED crop prediction — this is a separate
 * field in the response, displayed as its own section.
 */
export async function getSunflowerRf(req: Request, res: Response) {
  const feature = req.body?.feature as NormalizedFieldFeature | undefined
  const selectedMonth = Number(req.body?.selectedMonth)
  if (!feature || !feature.geometry || !feature.properties || (feature.id === undefined || feature.id === null)) {
    res.status(400).json({ error: 'body must be { feature: NormalizedFieldFeature, selectedMonth: number } — the same feature object returned by /agriculture/fields, including its id, and the 1-12 month currently selected in the UI' })
    return
  }
  if (!Number.isInteger(selectedMonth) || selectedMonth < 1 || selectedMonth > 12) {
    res.status(400).json({ error: 'selectedMonth must be an integer 1-12' })
    return
  }
  if (!isSupportedFieldGeometry(feature.geometry)) {
    res.json({ available: false, reason: 'SATELLITE_DATA_UNAVAILABLE' })
    return
  }

  const { amedTop } = buildAmedHypotheses(feature.properties)
  const gate = isEligibleForSunflowerRf(amedTop, selectedMonth)
  if (!gate.eligible) {
    res.json({ available: false, reason: gate.reason })
    return
  }

  const controller = new AbortController()
  res.on('close', () => {
    if (!res.writableEnded) controller.abort()
  })

  try {
    const result = await getSunflowerRfPrediction(String(feature.id), feature.geometry, controller.signal)
    if (controller.signal.aborted) return
    res.json(result)
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') return
    console.error('[sunflower-rf] request failed unexpectedly:', error instanceof Error ? error.message : error)
    res.json({ available: false, reason: 'PREDICTION_FAILED' })
  }
}
