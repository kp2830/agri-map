import { useEffect, useRef, useState } from 'react'
import { getSunflowerRf } from '../../lib/api'
import { getActiveCropOutcome, isEligibleForSunflowerCheck } from '../fields/cropDisplay'
import type { NormalizedFieldCollection, NormalizedFieldFeature } from '../../types/agricultural'

/**
 * Drives the map's Sunflower gold-coloring (see cropDisplay.ts's colorForFeatureWithSunflower):
 * for the current visible field collection, calls the EXISTING sunflower-rf endpoint (the same
 * one FieldDetailsPanel uses for the selected field — never a duplicated/separate calculation)
 * once per AMED-eligible field, sequentially with a real delay between calls.
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
 * work found single S2 cells with 300-500+ real fields) can't turn one map view into an
 * unbounded, multi-minute CDSE fan-out. Already-cached fields (repeat views, same field_id)
 * resolve near-instantly server-side regardless of this cap.
 */
const THROTTLE_MS = 3000
const MAX_FIELDS_PER_VIEW = 40

export function useSunflowerFieldColors(
  visibleFieldCollection: NormalizedFieldCollection | null,
  /** Reset key — a new search should abandon any in-flight checking for the previous result's
   *  fields, not keep spending CDSE credits on a collection the user has moved on from. */
  resetKey: string | number,
): Map<string, number> {
  const [probabilities, setProbabilities] = useState<Map<string, number>>(new Map())
  const cancelledRef = useRef(false)

  useEffect(() => {
    cancelledRef.current = false
    setProbabilities(new Map())

    const features = visibleFieldCollection?.features ?? []
    const eligible: NormalizedFieldFeature[] = []
    for (const feature of features) {
      if (feature.properties.aluType !== 'field' || feature.id === undefined) continue
      const outcome = getActiveCropOutcome(feature.properties)
      if (isEligibleForSunflowerCheck(outcome)) eligible.push(feature)
      if (eligible.length >= MAX_FIELDS_PER_VIEW) break
    }

    async function run() {
      for (const feature of eligible) {
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
          // Never lets one field's failure stop the rest of the view from being checked, and
          // never affects AMED/field-details rendering — this hook only ever adds a color.
        }
        await new Promise((resolve) => setTimeout(resolve, THROTTLE_MS))
      }
    }

    void run()

    return () => {
      cancelledRef.current = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resetKey is the intended trigger; visibleFieldCollection is read once per key change
  }, [resetKey])

  return probabilities
}
