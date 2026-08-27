import { Router } from 'express'
import { getFields } from '../controllers/agriculturalController.js'

export const agricultureRouter = Router()

agricultureRouter.get('/fields', getFields)
