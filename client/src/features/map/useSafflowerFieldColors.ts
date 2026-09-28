import { useEffect, useRef, useState } from 'react'
import { getSafflowerRf } from '../../lib/api'
import { getActiveCropOutcome, isEligibleForSafflowerCheck } from '../fields/cropDisplay'
import { featureCentroid } from '../fields/fieldGeometry'
import { SAFFLOWER_UI_ENABLED } from '../../lib/featureFlags'
import type { NormalizedFieldCollection, NormalizedFieldFeature } from '../../types/agricultural'

/**
 * Drives Safflower RF v0's automatic, cluster-wide checking -- exact same structure and
 * reasoning as useSunflowerFieldColors.ts (see that file's own docstring for the full
 * explanation of the throttle/cap/distance-sort design, all reused verbatim here). The only
 * real differences: calls safflower-rf instead of sunflower-rf, and uses
 * isEligibleForSafflowerCheck (Safflower's own Mustard-conflict logic) instead of Sunflower's
 * Corn/Maize exception.
 */
const THROTTLE_MS = 3000
const MAX_FIELDS_PER_VIEW = 40

export function useSafflowerFieldColors(
  fieldCollection: NormalizedFieldCollection | null,
  center: { lat: number; lng: number } | null,
  selectedMonth: number,
): Map<string, number> {
  const [probabilities, setProbabilities] = useState<Map<string, number>>(new Map())
  const cancelledRef = useRef(false)

  useEffect(() => {
    cancelledRef.current = false
    setProbabilities(new Map())

    if (!SAFFLOWER_UI_ENABLED) return

    const features = fieldCollection?.features ?? []
    const eligible: NormalizedFieldFeature[] = []
    for (const feature of features) {
      if (feature.properties.aluType !== 'field' || feature.id === undefined) continue
      const outcome = getActiveCropOutcome(feature.properties)
      if (isEligibleForSafflowerCheck(outcome)) eligible.push(feature)
    }

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
          const response = await getSafflowerRf(feature, selectedMonth)
          if (cancelledRef.current) return
          if (response.available) {
            setProbabilities((prev) => {
              const next = new Map(prev)
              next.set(String(feature.id), response.probabilityPercent)
              return next
            })
          }
        } catch {
          // Never lets one field's failure stop the rest of the cluster from being checked.
        }
        await new Promise((resolve) => setTimeout(resolve, THROTTLE_MS))
      }
    }

    void run()

    return () => {
      cancelledRef.current = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fieldCollection, selectedMonth])

  return probabilities
}
