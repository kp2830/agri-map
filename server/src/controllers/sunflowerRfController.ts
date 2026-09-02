import type { Request, Response } from 'express'
import { buildAmedHypotheses } from '../services/agricultural/sunflower/amedHypotheses.js'
import { isSupportedFieldGeometry } from '../services/google/cdseClient.js'
import { getSunflowerRfPrediction, isEligibleForSunflowerRf } from '../services/agricultural/sunflowerRf/service.js'
import type { NormalizedFieldFeature } from '../types/agricultural.js'

/**
 * Sunflower RF v0 — an ADDITIVE signal only. Gated on the existing production AMED
 * strong-confidence logic (buildAmedHypotheses + the same 0.8 threshold overridePolicy.ts
 * already uses): if AMED already has a confidently-observed prediction, this endpoint returns
 * `unavailable: AMED_HIGH_CONFIDENCE` immediately without spending any CDSE credits. The client
 * decides whether to call this at all (see FieldDetailsPanel) — but the gate is re-checked
 * server-side too, so a client bug can never cause an unnecessary CDSE spend.
 *
 * Never overrides, modifies, or is merged into the AMED crop prediction — this is a separate
 * field in the response, displayed as its own section.
 */
export async function getSunflowerRf(req: Request, res: Response) {
  const feature = req.body?.feature as NormalizedFieldFeature | undefined
  if (!feature || !feature.geometry || !feature.properties || (feature.id === undefined || feature.id === null)) {
    res.status(400).json({ error: 'body must be { feature: NormalizedFieldFeature } — the same feature object returned by /agriculture/fields, including its id' })
    return
  }
  if (!isSupportedFieldGeometry(feature.geometry)) {
    res.json({ available: false, reason: 'SATELLITE_DATA_UNAVAILABLE' })
    return
  }

  const { amedTop } = buildAmedHypotheses(feature.properties)
  if (!isEligibleForSunflowerRf(amedTop)) {
    res.json({ available: false, reason: 'AMED_HIGH_CONFIDENCE' })
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
