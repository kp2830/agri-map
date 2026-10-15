/**
 * Config for the Coriander Random Forest v0 integration (training/coriander/train_rf.py). AMED has no
 * Coriander class (its 12 crops: Bajra, Chilli, Corn, Cotton, Gram, Groundnut, Mustard, Rice, Sorghum,
 * Soybeans, Sugarcane, Wheat), so this is an ADDITIVE, isolated signal that never overrides or modifies AMED.
 *
 * v0 (first experimental model): 14 real ground-collected AgriFieldNet coriander fields (rabi 2021-22;
 * UP/Rajasthan/Bihar/Odisha) as positives against 66 wheat/mustard/gram fields (36 AgriFieldNet + 30
 * AMED-confirmed fields from the Hadoti belt, Rajasthan).
 *
 * HONEST STATE: far fewer than the 100 positives we want, positives come from one real year, and a
 * transfer check was poor -- a model trained only on the AgriFieldNet fields flagged 19 of 30 AMED-confirmed
 * Hadoti wheat/mustard/gram fields as coriander. 4-fold repeated CV on all 80 rows: AUC 0.84 +/- 0.12,
 * precision 0.56, recall 0.72. This is an experiment, NOT a validated classifier, and its score is not a
 * calibrated probability.
 */
export const CORIANDER_RF_MODEL_VERSION = 'coriander-rf-v0'

/** AMED confidence at or above this is "strong" and the RF is not run (same value as Sunflower/Safflower). */
export const AMED_STRONG_CONFIDENCE_THRESHOLD = 0.8

/**
 * Rabi 2025-26 calendar windows. The same month/day windows were used to build the training features
 * (AgriFieldNet fields: 2021-22; Hadoti fields: 2025-26). Each feature is the MEDIAN of the per-scene
 * field means inside the window, matching training/coriander/extract_and_apply_rule.py's `win()`.
 */
export const CORIANDER_FEATURE_WINDOWS = {
  dec: { start: '2025-12-01', end: '2025-12-31' }, // ndvi_dec
  decFeb: { start: '2025-12-15', end: '2026-02-15' }, // ndyi_decfeb
  feb: { start: '2026-02-01', end: '2026-03-10' }, // ndvi_feb
  mar: { start: '2026-03-01', end: '2026-03-31' }, // ndvi_mar
} as const

export const FEATURE_WINDOW_VERSION = '2025-26-rabi-dec-decfeb-feb-mar-v0-unvalidated'

/** Crops AMED already knows that Coriander is spectrally confusable with on this calendar (found in
 *  training/coriander's analysis: wheat, mustard and gram all pass the weak rule at some rate). A confident
 *  AMED call of any of these is the strongest disambiguating signal, so the RF is not run for them. */
export const CORIANDER_KNOWN_CONFUSION_CROPS = ['MUSTARD', 'WHEAT', 'GRAM'] as const

/** Ordered feature vector the model expects (copied from the model artifact's own `features`). */
export const EXPECTED_FEATURE_ORDER = ['ndvi_dec', 'ndyi_decfeb', 'ndvi_feb', 'ndvi_mar'] as const
