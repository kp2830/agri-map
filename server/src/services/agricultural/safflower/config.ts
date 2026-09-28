/**
 * Config for a research/training-only Safflower classification pathway — same shape and intent
 * as the existing Sunflower module (../sunflower/, ../sunflowerRf/), sitting ALONGSIDE AMED
 * (never replacing it). AMED's 12 crop classes (Bajra, Chilli, Corn, Cotton, Gram, Groundnut,
 * Mustard, Rice, Sorghum, Soybeans, Sugarcane, Wheat — confirmed real, not assumed) do not
 * include Safflower, so this exists to evaluate a Safflower hypothesis only when AMED's own
 * result for a field is weak, unknown, or one of its known crops is NOT already a confident
 * match — using the same ALU field polygon as the spatial unit, exactly like Sunflower does.
 *
 * IMPORTANT — current state: this is config/scaffolding only, written before any real candidate
 * field or Sentinel-2 feature has been pulled for Safflower. No model exists yet. Nothing here
 * is trained, validated, or wired into a route. See training/safflower/ for the discovery and
 * extraction scripts that will populate real data against this config.
 *
 * WHY THE WINDOWS ARE DIFFERENT FROM SUNFLOWER'S: Safflower is a real ~130-135 day rabi crop
 * (sown late September-October, harvested February-March) — a much longer cycle than
 * Sunflower's short one, so Sunflower's April/May/June windows do not apply and are not reused.
 * These dates come from published agronomic crop-calendar sources (not observed by anyone on
 * this team, unlike Sunflower's original co-founder field-drive hypothesis) — see the citations
 * in training/safflower/README.md. They are a STARTING hypothesis for the discovery pass, not a
 * validated rule.
 */

/**
 * Three real calendar windows spanning Safflower's real rabi cycle, for the SAME 2026 season
 * used throughout this project's other real extraction work. Recomputed per field from real
 * daily Sentinel-2 series, same as Sunflower's FEATURE_WINDOWS.
 *
 * - `establishment`: several weeks after typical sowing (early-mid Nov) — vegetative canopy
 *   should be developing; NDVI expected low-to-moderate, rising.
 * - `flowering`: Safflower's real, documented flowering window — bright orange-red flower heads
 *   for roughly 2-3 weeks, typically ~90-110 days after an Oct sowing, i.e. mid-December to
 *   mid-January. This is the window the NDYI (yellow/warm-color) signal is expected to matter
 *   most, not NDVI alone — flower heads are not pure green canopy, so NDVI can plateau or dip
 *   slightly here even as the field is genuinely in-crop.
 * - `harvest`: capsules and leaves yellow/brown as the crop matures (Feb-Mar per the crop
 *   calendar); NDVI expected to fall sharply.
 */
export const SAFFLOWER_FEATURE_WINDOWS = {
  establishment: { start: '2025-11-01', end: '2025-11-15' },
  flowering: { start: '2025-12-15', end: '2026-01-15' },
  harvest: { start: '2026-02-15', end: '2026-03-01' },
} as const

/** Versions the window definition above, same convention as Sunflower's FEATURE_WINDOW_VERSION —
 *  bump only if the dates themselves change without retraining.
 *
 *  Uses the 2025-26 rabi cycle specifically (sown ~Oct 2025) rather than the 2026-27 cycle,
 *  because as of when this was written (Sep 2026) the 2026-27 cycle has not finished — its
 *  Dec 2026-Mar 2027 flowering/harvest windows are still in the future and no real Sentinel-2
 *  imagery for them exists yet. 2025-26 is the most recent fully COMPLETED cycle. */
export const SAFFLOWER_FEATURE_WINDOW_VERSION = '2025-nov-2026-jan-mar-v0-unvalidated'

/**
 * A REAL, known confusability risk, stated honestly rather than glossed over: Mustard — one of
 * AMED's own 12 crops, and heavily grown in the same Oct-sown / Jan-flowering rabi window across
 * India — also flowers with a strong warm-color (yellow) signal at a similar time. NDYI as
 * literally defined (green/blue contrast) targets "yellow" broadly and may not cleanly separate
 * Safflower's orange-red from Mustard's pure yellow on its own. The real mitigation available
 * today: cross-check every Safflower candidate field against AMED's own real prediction for the
 * same field/season FIRST (same conflict-check pattern as
 * training/sunflower/amed_conflict_check_round4.py) — any field AMED already confidently calls
 * Mustard (or any of its other 11 crops) is excluded as a Safflower candidate outright, the same
 * way Sunflower's decision policy defers to a confident AMED result. This does not fully resolve
 * the confusability risk (AMED may not always be confident), but it removes the easy cases.
 */
export const SAFFLOWER_KNOWN_CONFUSION_CROPS = ['Mustard'] as const

/** Reused verbatim from Sunflower's own production threshold (not a new arbitrary number) —
 *  AMED confidence at or above this is treated as "strong" and no Safflower hypothesis is
 *  evaluated for that field. */
export const AMED_STRONG_CONFIDENCE_THRESHOLD = 0.8

/**
 * NOT YET SET. Sunflower's baseline rule (ndvi_apr > 0.50 AND ndvi_june < 0.25) came from a real,
 * specific field someone on the team actually observed (the co-founder's Delhi-Chandigarh drive).
 * No equivalent real observed Safflower field exists yet. Deliberately left undefined here rather
 * than filled with an invented number — see training/safflower/README.md for the real candidate
 * discovery pass this config supports; a baseline rule gets written only after real Sentinel-2
 * values from real candidate fields in the real Marathwada/north-Karnataka belt exist to derive
 * it from, the same way Sunflower's pilot derived its own thresholds from its own pilot's
 * observed extremes.
 */
export const SAFFLOWER_BASELINE_RULE = undefined
