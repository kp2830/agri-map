import { useEffect, useRef, useState } from 'react'
import { getSunflowerRf } from '../../lib/api'
import { getActiveCropOutcome, isEligibleForSunflowerCheck } from '../fields/cropDisplay'
import { featureCentroid } from '../fields/fieldGeometry'
import { SUNFLOWER_UI_ENABLED } from '../../lib/featureFlags'
import type { NormalizedFieldCollection, NormalizedFieldFeature } from '../../types/agricultural'

/**
 * Drives Sunflower RF v0's automatic, cluster-wide checking: given the full result of a
 * lat/lng search (the whole returned field cluster, not just whatever crop filter happens to
 * be applied to the map view), calls the EXISTING sunflower-rf endpoint (the same one
 * FieldDetailsPanel uses for the selected field — never a duplicated/separate calculation)
 * once per AMED-eligible field, sequentially with a real delay between calls. Powers BOTH the
 * map's gold coloring and the crop-distribution panel's Sunflower row — both read this same
 * Map, so a field is checked exactly once no matter how many places display its result.
 *
 * Fires automatically as soon as real search data arrives, with no click on any individual
 * field required — see the effect's own comment below for exactly why `fieldCollection`'s own
 * identity (not a separately-constructed "search token") is the correct, and only reliable,
 * trigger for this.
 *
 * Why sequential + throttled, not "just fire them all": each single sunflower-rf call already
 * makes 3 concurrent real CDSE Statistical API requests server-side (one per Apr/May/June
 * window). Firing that for many different fields back-to-back with no delay is exactly the
 * pattern that tripped CDSE's real rate limit during this project's own training-data
 * extraction (documented in training/sunflower/ — a faster 1.2s/2s throttle worked for ~180
 * fields then hit sustained 429s; 3s/6s fully resolved it). This reuses that same proven-safe
 * spacing rather than inventing a new rate.
 *
 * Capped at MAX_FIELDS_PER_VIEW so a very dense result (this project's own Haryana discovery
 * work found single S2 cells with 300-500+ real fields) can't turn one search into an
 * unbounded, multi-minute CDSE fan-out. Already-cached fields (repeat searches hitting the
 * same field_id) resolve near-instantly server-side regardless of this cap.
 *
 * Which fields fall inside that cap matters: a dense real cluster (754 fields observed at one
 * Haryana test location) has eligible fields in raw ALU API response order, which has no
 * relationship to relevance. Verified directly against real data that this let a field the user
 * clicked essentially on top of (centroid ~10m from the search point) land at eligibility rank
 * 324 — outside a 40-field cap — while an unrelated field 26th in raw order got auto-checked
 * instead. Fixed by sorting the eligible list by distance from `center` (the actual search
 * point) before capping, so "the 40 fields nearest to where the user clicked" — not an arbitrary
 * API-order prefix — is what gets auto-colored. This is also the semantically correct choice:
 * fields near the click are what the user is looking at.
 */
const THROTTLE_MS = 3000
const MAX_FIELDS_PER_VIEW = 40

export function useSunflowerFieldColors(
  fieldCollection: NormalizedFieldCollection | null,
  center: { lat: number; lng: number } | null,
): Map<string, number> {
  const [probabilities, setProbabilities] = useState<Map<string, number>>(new Map())
  const cancelledRef = useRef(false)

  // Keyed on fieldCollection's own identity — NOT a separately-constructed "search token"
  // string. App.tsx's fieldCollection becomes `null` the instant a new search starts
  // (state.status transitions to 'loading' before the fetch resolves — see
  // useAgriculturalFields.ts) and only gets a genuinely NEW reference once real data actually
  // arrives. That means this effect naturally clears on search-start and re-fires exactly once
  // real field data is in hand — no separate reset key needed, and critically, no risk of
  // firing once against stale/empty data and then never re-running once the real cluster loads
  // (a real bug an earlier version of this hook had: keying on a token that changes at
  // search-*start*, before fetchFields resolves, meant the loop below ran once against the
  // previous search's leftover data and never re-ran when the real new collection showed up a
  // moment later — meaning the map cluster was never actually being auto-colored in practice).
  // `center` is intentionally NOT in the dependency array: it's read fresh inside the effect but
  // always changes in lockstep with fieldCollection (both are set from the same search), so
  // keying on fieldCollection alone is sufficient and avoids a second, redundant trigger.
  useEffect(() => {
    cancelledRef.current = false
    setProbabilities(new Map())

    // Sunflower is temporarily hidden from the frontend (see lib/featureFlags.ts) — this hook
    // becomes a true no-op while the flag is off, never firing a single CDSE request, so no
    // credits are spent on a signal nobody can currently see. Every line below is otherwise
    // untouched and ready to resume the instant the flag flips back to true.
    if (!SUNFLOWER_UI_ENABLED) return

    const features = fieldCollection?.features ?? []
    const eligible: NormalizedFieldFeature[] = []
    for (const feature of features) {
      if (feature.properties.aluType !== 'field' || feature.id === undefined) continue
      const outcome = getActiveCropOutcome(feature.properties)
      if (isEligibleForSunflowerCheck(outcome)) eligible.push(feature)
    }

    // Nearest-to-search-point first, so the cap below keeps the fields most relevant to what
    // the user actually clicked rather than an arbitrary prefix of the raw API response order.
    // A field with no computable centroid sorts last (still eligible, just deprioritized) rather
    // than being dropped.
    if (center) {
      const distanceSqCache = new Map<NormalizedFieldFeature, number>()
      const distanceSq = (feature: NormalizedFieldFeature): number => {
        const cached = distanceSqCache.get(feature)
        if (cached !== undefined) return cached
        const centroid = featureCentroid(feature.geometry)
        const value = centroid ? (centroid.lat - center.lat) ** 2 + (centroid.lng - center.lng) ** 2 : Number.POSITIVE_INFINITY
        distanceSqCache.set(feature, value)
        return value
      }
      eligible.sort((a, b) => distanceSq(a) - distanceSq(b))
    }
    const capped = eligible.slice(0, MAX_FIELDS_PER_VIEW)

    async function run() {
      for (const feature of capped) {
        if (cancelledRef.current) return
        try {
          const response = await getSunflowerRf(feature)
          if (cancelledRef.current) return
          if (response.available) {
            setProbabilities((prev) => {
              const next = new Map(prev)
              next.set(String(feature.id), response.probabilityPercent)
              return next
            })
          }
        } catch {
          // Never lets one field's failure stop the rest of the cluster from being checked,
          // and never affects AMED/field-details rendering — this hook only ever adds a color.
        }
        await new Promise((resolve) => setTimeout(resolve, THROTTLE_MS))
      }
    }

    void run()

    return () => {
      cancelledRef.current = true
    }
    // center intentionally excluded: it always changes in lockstep with fieldCollection (both
    // set from the same search), and including it would risk a spurious extra firing against
    // fieldCollection's stale/previous value if center ever updates first (see comment above).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fieldCollection])

  return probabilities
}
