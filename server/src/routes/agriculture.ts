import { Router } from 'express'
import { getFields, getSunflowerLikelihood } from '../controllers/agriculturalController.js'
import { getSunflowerRf } from '../controllers/sunflowerRfController.js'
import { getSafflowerRf } from '../controllers/safflowerRfController.js'

export const agricultureRouter = Router()

agricultureRouter.get('/fields', getFields)
agricultureRouter.post('/sunflower-likelihood', getSunflowerLikelihood)
// Sunflower RF v0 (India-native, weakly-supervised) — a SEPARATE experimental signal from the
// EuroCrops-trained likeness model above. See controllers/sunflowerRfController.ts.
agricultureRouter.post('/sunflower-rf', getSunflowerRf)
// Safflower RF v0 — same shape as Sunflower RF, its own model/season. See
// controllers/safflowerRfController.ts.
agricultureRouter.post('/safflower-rf', getSafflowerRf)
