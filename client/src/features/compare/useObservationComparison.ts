import { useEffect, useMemo, useState } from 'react'
import { getAgriculturalFields, getCorianderRf, getFennelRf, getSafflowerRf, getSunflowerRf } from '../../lib/api'
import type {
  CoverageInfo,
  CropObservation,
  NormalizedFieldCollection,
  NormalizedFieldFeature,
  CorianderRfResponse,
  FennelRfResponse,
  SafflowerRfResponse,
  SunflowerRfResponse,
} from '../../types/agricultural'
import { predictCropOutlook, type CropOutlook } from '../fields/cropPrediction'
import { captureMonthYear, clipToSquare, findFieldAtPoint, type FieldMatch } from './compareLogic'

type ModelResult<T> = { status: 'loading' } | { status: 'error' } | { status: 'done'; response: T }

interface ModelResults {
  sunflower: ModelResult<SunflowerRfResponse>
  safflower: ModelResult<SafflowerRfResponse>
  coriander: ModelResult<CorianderRfResponse>
  fennel: ModelResult<FennelRfResponse>
}

const LOADING_MODELS: ModelResults = {
  sunflower: { status: 'loading' },
  safflower: { status: 'loading' },
  coriander: { status: 'loading' },
  fennel: { status: 'loading' },
}

export interface ObservationComparison extends ModelResults {
  /** Fields around the observation (drawn on the map, summarised as "crops in nearby fields"). */
  fieldCollection: NormalizedFieldCollection
  coverage: CoverageInfo
  /** False when ALU had no field coverage around the point itself, so the fields shown are the nearest ones elsewhere. */
  hasLocalCoverage: boolean
  /** The field the observation was logged in, if any mapped field is at that exact spot. */
  field: NormalizedFieldFeature | null
  distanceMetres: number | null
  /** The month being predicted/compared (user-selectable) and the capture year. */
  month: number
  year: number
  /** What the predictive model says for `month`, run as of today (current year) — whenever the observation was made. */
  amedPredictive: CropOutlook | null
  /** What AMED actually recorded for the field in `month` of `year` (never a guess). */
  amedPast: CropOutlook | null
}

export type ComparisonState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: ObservationComparison }

type AreaState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; fieldCollection: NormalizedFieldCollection; coverage: CoverageInfo; match: FieldMatch | null; hasLocalCoverage: boolean }

/**
 * Compare for one observation. Fetches the fields around its exact lat/lng once (per
 * observation / nearby-area size), then — for whichever month is selected — reads the
 * predictive crop and AMED's recorded crop for the field at that spot, and asks the four
 * crop models about that same field and month. Changing the month re-reads the predictive
 * result instantly and re-runs only the models; nothing runs until an observation is selected.
 */
export function useObservationComparison(observation: CropObservation | null, monthOverride: number | null, gridKm: number): ComparisonState {
  const [area, setArea] = useState<AreaState>({ status: 'idle' })
  const [models, setModels] = useState<ModelResults>(LOADING_MODELS)

  const capture = observation ? captureMonthYear(observation.capturedAt) : null
  const month = monthOverride ?? capture?.month ?? 1
  const year = capture?.year ?? new Date().getFullYear()

  useEffect(() => {
    if (!observation) {
      setArea({ status: 'idle' })
      return
    }
    const controller = new AbortController()
    setArea({ status: 'loading' })
    // ALU only searches in whole kilometres (1-5 km); a tighter view is the same data cut down below.
    getAgriculturalFields(observation.lat, observation.lng, Math.max(1, Math.ceil(gridKm)), 10, controller.signal).then(
      (fields) => {
        // The field is only trusted when the search found coverage around the point itself; when it had to
        // expand outward, the returned fields are the nearest ones elsewhere and don't contain the point.
        const hasLocalCoverage = fields.coverage.status === 'found_in_area'
        const match = hasLocalCoverage ? findFieldAtPoint(fields.fieldCollection, observation.lat, observation.lng) : null
        const shown = hasLocalCoverage ? clipToSquare(fields.fieldCollection, observation.lat, observation.lng, gridKm) : fields.fieldCollection
        setArea({ status: 'ready', fieldCollection: shown, coverage: fields.coverage, match, hasLocalCoverage })
      },
      (error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setArea({ status: 'error', message: error instanceof Error ? error.message : 'Comparison failed' })
      },
    )
    return () => controller.abort()
  }, [observation, gridKm])

  const field = area.status === 'ready' ? (area.match?.feature ?? null) : null

  useEffect(() => {
    setModels(LOADING_MODELS)
    if (!field) return
    const controller = new AbortController()
    let cancelled = false
    const patch = (key: keyof ModelResults, value: ModelResults[keyof ModelResults]) => {
      if (!cancelled) setModels((prev) => ({ ...prev, [key]: value }))
    }
    const run = <T,>(key: keyof ModelResults, call: () => Promise<T>) =>
      call().then(
        (response) => patch(key, { status: 'done', response } as ModelResults[keyof ModelResults]),
        () => patch(key, { status: 'error' }),
      )
    ;(async () => {
      // One after another, not in parallel: the four checks share one rate-limited satellite quota.
      await run('sunflower', () => getSunflowerRf(field, month, controller.signal))
      await run('safflower', () => getSafflowerRf(field, month, controller.signal))
      await run('coriander', () => getCorianderRf(field, month, controller.signal))
      await run('fennel', () => getFennelRf(field, month, controller.signal))
    })()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [field, month])

  return useMemo((): ComparisonState => {
    if (!observation || area.status === 'idle') return { status: 'idle' }
    if (area.status === 'loading') return { status: 'loading' }
    if (area.status === 'error') return { status: 'error', message: area.message }
    return {
      status: 'ready',
      data: {
        ...models,
        fieldCollection: area.fieldCollection,
        coverage: area.coverage,
        hasLocalCoverage: area.hasLocalCoverage,
        field,
        distanceMetres: area.match ? area.match.distanceMetres : null,
        month,
        year,
        amedPredictive: field ? predictCropOutlook(field.properties, month, new Date().getFullYear(), 'predictive') : null,
        amedPast: field ? predictCropOutlook(field.properties, month, year, 'past') : null,
      },
    }
  }, [observation, area, models, field, month, year])
}
