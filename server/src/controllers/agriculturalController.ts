import type { Request, Response } from 'express'
import { searchAgriculturalArea } from '../services/agricultural/areaSearch.js'
import { AgriculturalUnderstandingApiError } from '../services/google/agriculturalUnderstandingClient.js'

/**
 * Returns normalized ALU+AMED fields for the ~5km x 5km agricultural analysis area
 * around the given lat/lng, expanding the search outward to find the nearest real
 * coverage if that initial area has none. See services/agricultural/areaSearch.ts.
 */
export async function getFields(req: Request, res: Response) {
  const lat = Number(req.query.lat)
  const lng = Number(req.query.lng)

  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    res.status(400).json({ error: 'lat and lng query params are required and must be numbers' })
    return
  }

  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    res.status(400).json({ error: 'lat must be between -90 and 90, lng between -180 and 180' })
    return
  }

  // If the client disconnects before we've responded (e.g. the frontend aborted this
  // request because a newer map click superseded it), stop the search: no more cells get
  // queried, and any ALU/AMED HTTP calls already in flight are cancelled rather than run
  // to completion for a response nobody will read.
  const controller = new AbortController()
  res.on('close', () => {
    if (!res.writableEnded) controller.abort()
  })

  try {
    const { s2CellIds, fieldCollection, coverage } = await searchAgriculturalArea(lat, lng, controller.signal)
    // The search can finish (e.g. a partial result already had a valid field) in the same
    // tick the client disconnects. Don't attempt to write to an already-closed connection.
    if (controller.signal.aborted) return
    res.json({ selected: { lat, lng }, s2CellIds, fieldCollection, coverage })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return
    }
    if (error instanceof AgriculturalUnderstandingApiError) {
      res.status(502).json({ error: error.message })
      return
    }
    res.status(502).json({ error: 'Failed to fetch agricultural data' })
  }
}
