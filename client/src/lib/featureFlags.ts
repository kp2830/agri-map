/**
 * Frontend-only presentation flags — never gate whether the underlying backend logic exists or
 * runs by editing these; they exist to hide/show already-built UI, not to delete features.
 */

/**
 * Sunflower RF v0 was temporarily hidden from the visible product because it always evaluated
 * its fixed April/May/June training window regardless of which month the user had selected in
 * the new month-based predictive Crop Outlook feature — showing a Sunflower result next to, say,
 * an October outlook would have been genuinely misleading. That gap is now fixed: both the
 * sunflower-rf and safflower-rf endpoints take the selected month and return `OUT_OF_SEASON`
 * (no CDSE spend) when it falls outside that crop's real growing season — see
 * server/src/services/agricultural/growingSeasonGate.ts. Re-enabled now that the gate exists.
 *
 * Set to false: the bulk automatic RF-checking hook (useSunflowerFieldColors) becomes a no-op —
 * it never fires a single CDSE request, so no credits are spent on a signal nobody can see.
 * FieldDetailsPanel's on-demand per-field Sunflower checks are likewise skipped. The map never
 * applies the gold color, the crop filter dropdown never gets a "Sunflower" option, and the crop
 * distribution never gets a Sunflower row.
 */
export const SUNFLOWER_UI_ENABLED = true

/**
 * Safflower RF v0 — same shape as Sunflower RF, gated the same way (AMED confidence + the
 * selected month falling inside Safflower's real Oct-March growing season, plus a Mustard-
 * conflict gate specific to Safflower — see server/src/services/agricultural/safflower/config.ts
 * and safflowerRf/service.ts). First experimental model, trained on only 16 real weak-label
 * positives with no independently confirmed ground truth — see safflowerRf/config.ts's own
 * honest-state note before treating its output as more than an experimental signal.
 */
export const SAFFLOWER_UI_ENABLED = true
