/**
 * Frontend-only presentation flags — never gate whether the underlying backend logic exists or
 * runs by editing these; they exist to hide/show already-built UI, not to delete features.
 */

/**
 * Sunflower RF v0 is temporarily hidden from the visible product while the broader month-based
 * predictive crop outlook work is underway. Every backend piece (the RF model, sunflower-rf-v0
 * service, CDSE feature extraction, caching, the AMED confidence gate, the Corn/Maize exception)
 * remains fully intact and unmodified — this flag only controls whether the FRONTEND calls into
 * it and renders its results. Flip back to `true` to fully re-enable the feature with no backend
 * changes required.
 *
 * Set to false: the bulk automatic RF-checking hook (useSunflowerFieldColors) becomes a no-op —
 * it never fires a single CDSE request, so no credits are spent on a signal nobody can see.
 * FieldDetailsPanel's on-demand per-field Sunflower checks are likewise skipped. The map never
 * applies the gold color, the crop filter dropdown never gets a "Sunflower" option, and the crop
 * distribution never gets a Sunflower row.
 */
export const SUNFLOWER_UI_ENABLED = false
