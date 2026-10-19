/**
 * Config for the Fennel Random Forest v0 integration (training/fennel/assemble_and_train.py). AMED has no Fennel class
 * (its 12 crops: Bajra, Chilli, Corn, Cotton, Gram, Groundnut, Mustard, Rice, Sorghum, Soybeans, Sugarcane, Wheat),
 * so this is an ADDITIVE, isolated signal that never overrides or modifies AMED.
 *
 * v0 (first experimental model) -- HONEST STATE: there is no public ground-truth fennel dataset for India.
 * Exactly ONE real, geotagged fennel field was found (Wikimedia Commons "Fennel farming", 13 Jan 2020, Kotra tehsil,
 * Udaipur; training/fennel/ref_commons_fennel_2020.json) and it was NOT a training row; it is used only as a check
 * (the model scores it 0.64). All 91 training positives are WEAK LABELS: fields in documented fennel belts whose
 * rabi-2025-26 NDVI curve matches fennel's calendar (training/fennel/fennel_rules.py): Gujarat 61 (Sabarkantha 31,
 * Mehsana 19, Banaskantha 11, Morbi 0) and Rajasthan only 30 (Nagaur 25, Sirohi 4, Bilara 1). Negatives (728) are
 * AMED-confident other-crop fields (mustard/wheat/gram/cotton/...) plus ordinary fields from the same belts; fields near
 * the rule boundary were excluded. The model therefore learns "fennel-like curve", NOT verified fennel.
 *
 * What the checks show (training/fennel/assemble_and_train.py, leave-one-belt-out; labels are the weak rules, so this
 * measures consistency, not accuracy against real fennel): Gujarat belts precision 0.92-0.94 and recall 0.63-1.0 at the
 * 0.5 UI threshold, flagging 2.3-3.6% of eligible fields (official fennel share is roughly 1-3%); Rajasthan belts recall
 * only ~0.2 (too few Rajasthan positives), so Rajasthan fennel is under-detected. Gram, castor and other late-rabi crops
 * can produce similar curves. Sentinel-1 radar (not used at inference) separated the candidates from AMED mustard
 * strongly and from wheat/gram only modestly. Scores are not calibrated probabilities. Inference features come from
 * the production Statistical API while training used per-cell chips; the measured difference in model score was 0.00-0.09.
 * Do not treat a result as more than an experimental signal until fields are verified on the ground.
 */
export const FENNEL_RF_MODEL_VERSION = 'fennel-rf-v0'

/** AMED confidence at or above this is "strong" and the RF is not run (same value as Sunflower/Safflower/Coriander). */
export const AMED_STRONG_CONFIDENCE_THRESHOLD = 0.8

/** Rabi 2025-26 season requested from CDSE in ONE statistics call; features are then computed locally from the daily series. */
export const FENNEL_SEASON = { start: '2025-10-01', end: '2026-04-30', startYear: 2025 } as const

/** 13 calendar windows (month/day inclusive). Must match training/fennel/fennel_features.py WINDOWS exactly. */
export const FENNEL_WINDOWS = [
  { name: 'oct', a: [10, 1], b: [10, 31] },
  { name: 'nov1', a: [11, 1], b: [11, 15] },
  { name: 'nov2', a: [11, 16], b: [11, 30] },
  { name: 'dec1', a: [12, 1], b: [12, 15] },
  { name: 'dec2', a: [12, 16], b: [12, 31] },
  { name: 'jan1', a: [1, 1], b: [1, 15] },
  { name: 'jan2', a: [1, 16], b: [1, 31] },
  { name: 'feb1', a: [2, 1], b: [2, 14] },
  { name: 'feb2', a: [2, 15], b: [2, 28] },
  { name: 'mar1', a: [3, 1], b: [3, 15] },
  { name: 'mar2', a: [3, 16], b: [3, 31] },
  { name: 'apr1', a: [4, 1], b: [4, 15] },
  { name: 'apr2', a: [4, 16], b: [4, 30] },
] as const

/** A field with more than this many empty windows (of 13) is unscoreable -- never padded with invented values. */
export const MAX_EMPTY_WINDOWS = 3

export const FEATURE_WINDOW_VERSION = '2025-26-rabi-13win-ndvi-ndre-v0-unvalidated'

/** Crops AMED already knows that Fennel is spectrally confusable with on this calendar (same set as Coriander's gate):
 *  a confident AMED call of any of these is the strongest disambiguating signal, so the RF is not run for them. */
export const FENNEL_KNOWN_CONFUSION_CROPS = ['MUSTARD', 'WHEAT', 'GRAM'] as const

/** Ordered feature vector the model expects: ndvi_<13 windows> then ndre_<13 windows>. */
export const EXPECTED_FEATURE_ORDER = [
  ...FENNEL_WINDOWS.map((w) => `ndvi_${w.name}`),
  ...FENNEL_WINDOWS.map((w) => `ndre_${w.name}`),
] as const
