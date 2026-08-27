import type { Request, Response } from 'express'
import { latLngToCellId } from '../lib/s2/index.js'
import { fetchLandscape } from '../services/agricultural/alu/index.js'
import { fetchMonitoring } from '../services/agricultural/amed/index.js'
import { joinLandscapeWithMonitoring } from '../services/agricultural/normalize.js'
import { AgriculturalUnderstandingApiError } from '../services/google/agriculturalUnderstandingClient.js'

/** Returns normalized ALU+AMED fields for the S2 Level-13 cell containing the given lat/lng. */
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

  const s2CellId = latLngToCellId(lat, lng)

  try {
    const [landscape, monitoring] = await Promise.all([fetchLandscape(s2CellId), fetchMonitoring(s2CellId)])
    const fieldCollection = joinLandscapeWithMonitoring(landscape, monitoring)
    res.json({ s2CellId, fieldCollection })
  } catch (error) {
    if (error instanceof AgriculturalUnderstandingApiError) {
      res.status(502).json({ error: error.message })
      return
    }
    res.status(502).json({ error: 'Failed to fetch agricultural data' })
  }
}
