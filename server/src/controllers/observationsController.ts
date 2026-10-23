import type { Request, Response } from 'express'
import { getCropObservations } from '../services/observations/observationsClient.js'

/** GET /agriculture/observations — the team's logged crop observations, newest first, with place names. */
export async function listCropObservations(_req: Request, res: Response) {
  try {
    res.json(await getCropObservations())
  } catch (error) {
    console.error('Crop observations fetch failed:', error)
    res.status(502).json({ error: 'Could not load crop observations from the production API.' })
  }
}
