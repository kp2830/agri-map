import { Router } from 'express'
import { cellTokenToLatLng, getCoveringCellTokens, latLngToCellToken } from '../lib/s2/index.js'

export const geoRouter = Router()

/** Returns the S2 cell token containing the given lat/lng. */
geoRouter.get('/cell', (req, res) => {
  const lat = Number(req.query.lat)
  const lng = Number(req.query.lng)
  const level = req.query.level !== undefined ? Number(req.query.level) : undefined

  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    res.status(400).json({ error: 'lat and lng query params are required and must be numbers' })
    return
  }

  res.json({ token: latLngToCellToken(lat, lng, level) })
})

/** Returns the center lat/lng of the S2 cell for the given token. */
geoRouter.get('/cell/:token', (req, res) => {
  try {
    res.json(cellTokenToLatLng(req.params.token))
  } catch {
    res.status(400).json({ error: 'invalid cell token' })
  }
})

/** Returns the S2 cell tokens covering a GeoJSON geometry. */
geoRouter.post('/covering', (req, res) => {
  const { geometry, minLevel, maxLevel, maxCells } = req.body ?? {}

  if (!geometry || typeof geometry !== 'object') {
    res.status(400).json({ error: 'geometry (GeoJSON) is required in the request body' })
    return
  }

  try {
    res.json({ tokens: getCoveringCellTokens(geometry, { minLevel, maxLevel, maxCells }) })
  } catch {
    res.status(400).json({ error: 'unable to compute covering for the given geometry' })
  }
})
