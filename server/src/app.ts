import cors from 'cors'
import express from 'express'
import { agricultureRouter } from './routes/agriculture.js'
import { geoRouter } from './routes/geo.js'
import { healthRouter } from './routes/health.js'
import { worldcerealResearchRouter } from './routes/worldcerealResearch.js'

export function createApp() {
  const app = express()

  app.use(cors())
  app.use(express.json())

  app.use('/health', healthRouter)
  app.use('/geo', geoRouter)
  app.use('/agriculture', agricultureRouter)
  // Isolated research integration, disabled unless ENABLE_WORLDCEREAL_RESEARCH=true (see
  // controllers/worldCerealResearchController.ts) — never touches the production AMED flow.
  app.use('/research/worldcereal', worldcerealResearchRouter)

  return app
}
