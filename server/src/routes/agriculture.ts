import { Router } from 'express'
import { getFields, getSunflowerLikelihood } from '../controllers/agriculturalController.js'
import { getSunflowerRf } from '../controllers/sunflowerRfController.js'
import { getSafflowerRf } from '../controllers/safflowerRfController.js'
import { getCorianderRf } from '../controllers/corianderRfController.js'
import { getFennelRf } from '../controllers/fennelRfController.js'

export const agricultureRouter = Router()

agricultureRouter.get('/fields', getFields)
agricultureRouter.post('/sunflower-likelihood', getSunflowerLikelihood)
// Sunflower RF v0 (India-native, weakly-supervised) — a SEPARATE experimental signal from the
// EuroCrops-trained likeness model above. See controllers/sunflowerRfController.ts.
agricultureRouter.post('/sunflower-rf', getSunflowerRf)
// Safflower RF v0 — same shape as Sunflower RF, its own model/season. See
// controllers/safflowerRfController.ts.
agricultureRouter.post('/safflower-rf', getSafflowerRf)

// Coriander RF v0 — same shape as Safflower RF, its own model/season. See
// controllers/corianderRfController.ts.
agricultureRouter.post('/coriander-rf', getCorianderRf)

// Fennel RF v0 — same shape as Coriander RF, its own model/season. See controllers/fennelRfController.ts.
agricultureRouter.post('/fennel-rf', getFennelRf)
