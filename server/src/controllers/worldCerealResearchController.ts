import type { Request, Response } from 'express'
import { isWorldCerealResearchEnabled } from '../services/agricultural/worldcereal/config.js'
import { compareAmedAndWorldCereal } from '../services/agricultural/worldcereal/consensus.js'
import { getCachedResultForField, getOrSubmitWorldCerealJob } from '../services/agricultural/worldcereal/worldCerealService.js'
import { WorldCerealApiError, WorldCerealAuthRequiredError } from '../services/agricultural/worldcereal/openeoClient.js'

/**
 * Research-only endpoints (see routes/worldcerealResearch.ts — mounted only when
 * ENABLE_WORLDCEREAL_RESEARCH=true). The backend owns all WorldCereal cache state — the frontend
 * never has to track job IDs or poll CDSE itself, it just asks for a field's result.
 *
 *  - GET  /research/worldcereal/:fieldId            pure cache read, never contacts CDSE
 *  - POST /research/worldcereal/:fieldId/trigger     check-cache-or-submit (may spend real credits
 *                                                     only when nothing is cached/in-flight yet)
 *
 * Never called from, and never mutates, the production /agriculture/fields flow.
 */
function ensureEnabled(res: Response): boolean {
  if (!isWorldCerealResearchEnabled()) {
    res.status(404).json({ error: 'WorldCereal research integration is disabled (set ENABLE_WORLDCEREAL_RESEARCH=true to enable).' })
    return false
  }
  return true
}

function attachComparison(res: Response, record: Awaited<ReturnType<typeof getCachedResultForField>>, req: Request) {
  const amedCropLabel = typeof req.query.amedCropLabel === 'string' ? req.query.amedCropLabel : null
  const amedConfidenceRaw = req.query.amedConfidence
  const amedConfidence = amedConfidenceRaw !== undefined ? Number(amedConfidenceRaw) : null

  if (!record) {
    res.json({ status: 'not_started', record: null, comparison: null })
    return
  }
  const comparison = amedCropLabel ? compareAmedAndWorldCereal({ cropLabel: amedCropLabel, confidence: amedConfidence }, record.result) : null
  res.json({ status: record.status, record, comparison })
}

/** Pure cache read — never submits a job, never calls CDSE. Returns the field's cached record
 *  (whatever state it's in: queued/running/finished/error) or `not_started` if nothing exists. */
export async function getWorldCerealForField(req: Request, res: Response) {
  if (!ensureEnabled(res)) return
  const fieldId = typeof req.params.fieldId === 'string' ? req.params.fieldId : null
  if (!fieldId) {
    res.status(400).json({ error: 'fieldId path param is required' })
    return
  }

  try {
    const record = await getCachedResultForField(fieldId)
    attachComparison(res, record, req)
  } catch (error) {
    console.error('[worldcereal-research] cache read failed:', error instanceof Error ? error.message : error)
    res.status(500).json({ error: 'Failed to read WorldCereal cache unexpectedly.' })
  }
}

/** Check-cache-or-submit. Real CDSE credits are spent only when nothing usable is already
 *  cached or in-flight for this exact field (see worldCerealService.ts's getOrSubmitWorldCerealJob
 *  for the full precedence: cached result > in-flight job (deduped, even across concurrent
 *  requests) > new submission). */
export async function triggerWorldCerealForField(req: Request, res: Response) {
  if (!ensureEnabled(res)) return
  const fieldId = typeof req.params.fieldId === 'string' ? req.params.fieldId : null
  const lat = Number(req.body?.lat)
  const lng = Number(req.body?.lng)
  const geometryHash = typeof req.body?.geometryHash === 'string' ? req.body.geometryHash : null
  if (!fieldId || Number.isNaN(lat) || Number.isNaN(lng)) {
    res.status(400).json({ error: 'fieldId path param and numeric lat/lng in the body are required' })
    return
  }

  try {
    const result = await getOrSubmitWorldCerealJob({ fieldId, lat, lng, geometryHash })
    res.json(result)
  } catch (error) {
    if (error instanceof WorldCerealAuthRequiredError) {
      res.status(503).json({ error: error.message })
      return
    }
    if (error instanceof WorldCerealApiError) {
      res.status(502).json({ error: error.message })
      return
    }
    console.error('[worldcereal-research] trigger failed:', error instanceof Error ? error.message : error)
    res.status(500).json({ error: 'WorldCereal job submission failed unexpectedly.' })
  }
}
