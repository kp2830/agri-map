import cors from 'cors'
import express from 'express'
import { geoRouter } from './routes/geo.js'
import { healthRouter } from './routes/health.js'

export function createApp() {
  const app = express()

  app.use(cors())
  app.use(express.json())

  app.use('/health', healthRouter)
  app.use('/geo', geoRouter)

  return app
}
