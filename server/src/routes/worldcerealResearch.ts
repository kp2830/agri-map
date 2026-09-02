import { Router } from 'express'
import { getWorldCerealForField, triggerWorldCerealForField } from '../controllers/worldCerealResearchController.js'

/**
 * Isolated research routes, gated by ENABLE_WORLDCEREAL_RESEARCH (checked per-request in the
 * controller, not just at mount time, so the flag can be flipped without a restart in dev).
 * Never referenced by the production /agriculture routes or the default client UI — see
 * training/esa/worldcereal_agrimap_100_field_evaluation.md for what this demonstrates and why
 * it stays isolated. The backend owns all cache state (server/.worldcereal-research-cache/,
 * see resultStore.ts) — the frontend just asks for a field's result.
 */
export const worldcerealResearchRouter = Router()

worldcerealResearchRouter.get('/:fieldId', getWorldCerealForField)
worldcerealResearchRouter.post('/:fieldId/trigger', triggerWorldCerealForField)
