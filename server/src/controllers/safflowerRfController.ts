import type { Request, Response } from 'express'
import { buildAmedHypotheses } from '../services/agricultural/sunflower/amedHypotheses.js'
import { isSupportedFieldGeometry } from '../services/google/cdseClient.js'
import { getSafflowerRfPrediction, isEligibleForSafflowerRf } from '../services/agricultural/safflowerRf/service.js'
import type { NormalizedFieldFeature } from '../types/agricultural.js'

/**
 * Safflower RF v0 -- an ADDITIVE signal only. Gated on: (1) the caller's selected month actually
 * being one Safflower could plausibly be growing in (see growingSeasonGate.ts -- this is the
 * real fix for the same reason Sunflower RF was temporarily hidden: a prediction must never be
 * shown against a month it has no real relationship to), then (2) the existing AMED
 * strong-confidence / Mustard-conflict logic. Never overrides, modifies, or is merged into the
 * AMED crop prediction -- this is a separate field in the response, displayed as its own
 * section, same as Sunflower RF.
 */
export async function getSafflowerRf(req: Request, res: Response) {
  const feature = req.body?.feature as NormalizedFieldFeature | undefined
  const selectedMonth = Number(req.body?.selectedMonth)
  if (!feature || !feature.geometry || !feature.properties || feature.id === undefined || feature.id === null) {
    res.status(400).json({ error: 'body must be { feature: NormalizedFieldFeature, selectedMonth: number } -- the same feature object returned by /agriculture/fields, including its id, and the 1-12 month currently selected in the UI' })
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
  const gate = isEligibleForSafflowerRf(amedTop, selectedMonth)
  if (!gate.eligible) {
    res.json({ available: false, reason: gate.reason })
    return
  }

  const controller = new AbortController()
  res.on('close', () => {
    if (!res.writableEnded) controller.abort()
  })

  try {
    const result = await getSafflowerRfPrediction(String(feature.id), feature.geometry, controller.signal)
    if (controller.signal.aborted) return
    res.json(result)
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') return
    console.error('[safflower-rf] request failed unexpectedly:', error instanceof Error ? error.message : error)
    res.json({ available: false, reason: 'PREDICTION_FAILED' })
  }
}
