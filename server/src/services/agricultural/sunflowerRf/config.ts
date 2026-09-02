/**
 * Config for the Sunflower Random Forest v0 integration — the new, India-native, weakly-
 * supervised model (training/sunflower/train_rf_experiments_ab.py, Experiment A), distinct from
 * the older EuroCrops-trained "likeness" model already in production
 * (server/src/services/agricultural/sunflower/ — Mahalanobis/kNN, exposed via
 * POST /agriculture/sunflower-likelihood). Both are independent experimental signals; this one
 * does not replace or modify the other.
 */

/** Explicit model version — part of the cache key (see resultStore.ts) so a future v1 model
 *  can never be silently served from a v0 cache entry. */
export const SUNFLOWER_RF_MODEL_VERSION = 'sunflower-rf-v0'

/**
 * Real, fixed training windows (see training/sunflower/train_rf_experiments_ab.py /
 * assemble_final_rf_datasets.py) — April 15-30, May 1-20, June 1-15, **2026** specifically. The
 * model was trained on real Sentinel-2 features computed for these exact calendar dates for the
 * Kurukshetra-Karnal positives (the existing 205 negatives used the same day-of-month windows
 * recomputed from their own real 2021 daily series). Prediction-time feature extraction MUST use
 * these same 2026 windows for every field, regardless of when it's clicked or where in India it
 * is — using a different window would evaluate the model outside the exact regime it was
 * calibrated on. Re-verify/retrain before extending past this window in a future model version.
 */
export const FEATURE_WINDOWS = {
  april: { start: '2026-04-15', end: '2026-04-30' },
  may: { start: '2026-05-01', end: '2026-05-20' },
  june: { start: '2026-06-01', end: '2026-06-15' },
} as const

/** Versions the exact feature-window definition above — bump this (independently of
 *  MODEL_VERSION) only if the window dates themselves ever change without retraining, so a
 *  cached prediction from the old window definition is never silently reused. */
export const FEATURE_WINDOW_VERSION = '2026-apr-may-jun-v1'

/** Reused verbatim from the existing production Sunflower override policy
 *  (overridePolicy.ts's DEFAULT_SUNFLOWER_DECISION_CONFIG.amedStrongConfidenceThreshold) — not a
 *  new arbitrary number. AMED confidence at or above this is "strong" and the RF is not run. */
export const AMED_STRONG_CONFIDENCE_THRESHOLD = 0.8

/** The exact ordered feature vector the model expects — copied verbatim from the verified model
 *  artifact's own `features` field (training/sunflower/experiment_a_rf_model.pkl), never
 *  hand-retyped from memory. rfInference.ts asserts this matches the loaded model JSON's own
 *  `features` field at load time, so a mismatch fails loudly instead of silently mispredicting. */
export const EXPECTED_FEATURE_ORDER = [
  'ndvi_apr', 'ndvi_may', 'ndvi_june', 'ndvi_apr_june_change',
  'ndre_apr', 'ndre_may', 'ndre_june',
  'ndwi_apr', 'ndwi_may', 'ndwi_june',
  'ndyi_apr', 'ndyi_may', 'ndyi_june',
] as const
