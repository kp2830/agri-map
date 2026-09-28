/**
 * Config for the Safflower Random Forest v0 integration — the first servable Safflower model
 * (training/safflower/train_rf.py), distinct from the research-only scaffolding in
 * ../safflower/config.ts (which this reuses the windows from). AMED does not have a Safflower
 * class (see ../safflower/config.ts's own docstring for the real, confirmed 12-crop list), so
 * this is an ADDITIVE, isolated signal, never overriding or modifying AMED.
 */
import { SAFFLOWER_FEATURE_WINDOWS, SAFFLOWER_FEATURE_WINDOW_VERSION } from '../safflower/config.js'

export { SAFFLOWER_FEATURE_WINDOWS as FEATURE_WINDOWS, SAFFLOWER_FEATURE_WINDOW_VERSION as FEATURE_WINDOW_VERSION }

/**
 * v0 (current, first experimental model): trained on 16 real weak-label positives from the
 * Latur, Maharashtra pilot (5 HIGH-tier + 11 MEDIUM-tier -- see
 * training/safflower/score_and_tier.py) against the SAME 100 real AMED-confirmed Indian
 * competing-crop fields used for Sunflower's own negative pool
 * (training/data/pilot/amed_negative_manifest.jsonl), but re-extracted on Safflower's own real
 * 2025-26 rabi windows rather than reused from Sunflower's April/May/June feature values (see
 * training/safflower/extract_negative_features.py's docstring for why that reuse would have
 * been dishonest -- comparing two different real calendars).
 *
 * HONEST STATE OF THIS MODEL, stated plainly: with only 16 positives (versus Sunflower's own
 * first real experiment at 26), and zero independently confirmed ground truth for ANY of them
 * (a real, high-resolution visual spot-check of a subset of the HIGH-tier positives found some
 * that look like tree/scrub cover, not cropland), this is a first experiment to check whether
 * the real feature set carries ANY separable signal -- NOT a validated or production-ready
 * classifier. Held-out test evaluation (n=3 positives in the test split) is too small to trust
 * as a real accuracy number; see training/safflower/train_rf.py's own printed caveat.
 */
export const SAFFLOWER_RF_MODEL_VERSION = 'safflower-rf-v0'

/** Reused verbatim from Sunflower's own production threshold (not a new arbitrary number) -- AMED
 *  confidence at or above this is "strong" and the RF is not run. */
export const AMED_STRONG_CONFIDENCE_THRESHOLD = 0.8

/** The exact ordered feature vector the model expects -- copied verbatim from the verified model
 *  artifact's own `features` field (training/safflower/safflower_rf_v0_model.pkl), never
 *  hand-retyped from memory. rfInference.ts asserts this matches the loaded model JSON's own
 *  `features` field at load time. */
export const EXPECTED_FEATURE_ORDER = [
  'ndvi_establishment', 'ndvi_flowering', 'ndvi_harvest',
  'ndre_establishment', 'ndre_flowering', 'ndre_harvest',
  'ndwi_establishment', 'ndwi_flowering', 'ndwi_harvest',
  'ndyi_establishment', 'ndyi_flowering', 'ndyi_harvest',
] as const
