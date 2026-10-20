/**
 * Config for the Fennel Random Forest v0 integration (training/fennel/assemble_and_train.py). AMED has no Fennel class
 * (its 12 crops: Bajra, Chilli, Corn, Cotton, Gram, Groundnut, Mustard, Rice, Sorghum, Soybeans, Sugarcane, Wheat),
 * so this is an ADDITIVE, isolated signal that never overrides or modifies AMED.
 *
 * v0 -- HONEST STATE: there is no public ground-truth fennel dataset for India. Exactly ONE real, geotagged fennel field was
 * found (Wikimedia Commons "Fennel farming", 13 Jan 2020, Kotra tehsil, Udaipur; training/fennel/ref_commons_fennel_2020.json); it
 * was NOT a training row and the model scores it 0.64. All 113 training positives are WEAK LABELS: fields in documented fennel belts
 * whose rabi-2025-26 NDVI curve matches a fennel calendar (training/fennel/fennel_rules.py), three regional rules:
 *   - Rajasthan (30 positives: Nagaur 25, Sirohi 4, Bilara 1): early-October sowing, plateau Dec-Feb, harvested by mid-March.
 *   - Gujarat (37: Mehsana 19, Banaskantha 8, Sabarkantha 10): November sowing, green through late March.
 *   - Madhya Pradesh (46, Dhar/Manawar): early-sown (Malwa trials sow from mid-September), standing crop from October, harvested by early
 *     March. Chosen from the cropping pattern found near Manawar tehsil, which also matches a farmer sheet for that area (Aug-Sep sowing,
 *     Feb-Mar harvest); the sheet has no coordinates, so it was not used as labels. MP is trained on the Dhar belt only.
 * Negatives are AMED-confident other-crop fields plus ordinary fields from the same belts; borderline fields were excluded.
 * AMED Corn/Maize is gated when AMED's confidence is 60% or more: rabi maize has the same long plateau (82 of 132 Dhar fields flagged
 * by an earlier version were AMED-Corn, and 26 of the first 91 positives were AMED-Corn with ~70% mean confidence). Below 60% the fennel
 * model still runs and such fields can be positives.
 *
 * What the checks show (training/fennel/assemble_and_train.py, leave-one-belt-out; labels are the weak rules, so this measures
 * consistency, not accuracy against real fennel): Gujarat and Rajasthan belts AUC 0.96-1.0; Dhar AUC ~0.5 when trained WITHOUT MP
 * positives (the MP pattern is new, hence the MP rule and MP positives). At the 0.5 threshold the model flags 0.2-4.2% of eligible
 * fields per belt. Rajasthan recall is low (~0.2-0.5). Gram, castor, cotton and other long-season crops can produce similar curves.
 * Scores are not calibrated probabilities. Inference features come from the production Statistical API while training used per-cell
 * chips (measured score difference 0.00-0.09). Do not treat a result as more than a model signal until fields are verified on the ground.
 */
/** Part of the prediction-cache key (resultStore.ts): bump it whenever the model file changes, or stale scores are served. */
export const FENNEL_RF_MODEL_VERSION = 'fennel-rf-v2'

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

/** Crops AMED already knows that Fennel is spectrally confusable with on this calendar. Mustard/wheat/gram (rabi): a call of any of them
 *  by AMED, at any confidence, is the strongest disambiguating signal, so the RF is not run. Corn/Maize (rabi maize has the same long
 *  late-rabi plateau; in the Dhar belt 82 of 132 flagged fields were AMED-Corn) is gated only from FENNEL_CORN_GATE_CONFIDENCE up. */
export const FENNEL_KNOWN_CONFUSION_CROPS = ['MUSTARD', 'WHEAT', 'GRAM'] as const

/** Corn/Maize is gated only when AMED is at least this sure: below it the fennel model still runs. */
export const FENNEL_CORN_CROPS = ['CORN', 'MAIZE'] as const
export const FENNEL_CORN_GATE_CONFIDENCE = 0.6

/** Ordered feature vector the model expects: ndvi_<13 windows> then ndre_<13 windows>. */
export const EXPECTED_FEATURE_ORDER = [
  ...FENNEL_WINDOWS.map((w) => `ndvi_${w.name}`),
  ...FENNEL_WINDOWS.map((w) => `ndre_${w.name}`),
] as const
