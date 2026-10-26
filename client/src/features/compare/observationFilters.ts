import type { CropObservation } from '../../types/agricultural'
import type { EvalMap } from './accuracy'
import { cropCoverage, cropGroupLabel, type CropCoverage } from './compareLogic'

export type ResultFilter = 'all' | 'right' | 'wrong' | 'unjudged'
export type SortKey = 'newest' | 'oldest' | 'wrong_first' | 'crop'

export interface ObservationFilters {
  /** Free text: every word must match the crop, city, district, state or growth stage. */
  query: string
  /** A crop's group label (see cropGroupLabel), '' for any. */
  crop: string
  state: string
  district: string
  coverage: '' | CropCoverage
  stage: string
  source: '' | 'ai' | 'manual'
  /** Capture dates (YYYY-MM-DD, UTC); both empty for any date, equal for one single day. */
  from: string
  to: string
  result: ResultFilter
}

export const DEFAULT_FILTERS: ObservationFilters = {
  query: '',
  crop: '',
  state: '',
  district: '',
  coverage: '',
  stage: '',
  source: '',
  from: '',
  to: '',
  result: 'all',
}

export const COVERAGE_LABELS: Record<CropCoverage, string> = {
  amed: 'AMED crops (12)',
  added: 'Our added crops (4)',
  other: 'Outside our models',
}

export const STAGE_LABELS: Record<string, string> = {
  sowing_seedling: 'Sowing / seedling',
  vegetative: 'Vegetative',
  flowering: 'Flowering',
  fruiting_grain: 'Fruiting / grain filling',
  harvesting_mature: 'Harvesting / mature',
}

export const UNKNOWN_PLACE = 'Place unknown'

export function observationState(o: CropObservation): string {
  return o.place?.state ?? UNKNOWN_PLACE
}

export function observationDistrict(o: CropObservation): string {
  return o.place?.district ?? o.place?.city ?? UNKNOWN_PLACE
}

function captureDate(o: CropObservation): string {
  return o.capturedAt.slice(0, 10)
}

function haystack(o: CropObservation): string {
  return [o.cropName, cropGroupLabel(o.cropName), o.place?.city, o.place?.district, o.place?.state, o.growthStage ? STAGE_LABELS[o.growthStage] ?? o.growthStage : null]
    .filter((part): part is string => !!part)
    .join(' ')
    .toLowerCase()
}

type FilterKey = keyof ObservationFilters

/** The observations that pass every filter except those in `omit` (used so a breakdown by crop still shows the other crops). */
export function applyFilters(
  observations: readonly CropObservation[],
  filters: ObservationFilters,
  evals: EvalMap,
  omit: readonly FilterKey[] = [],
): CropObservation[] {
  const skip = new Set<FilterKey>(omit)
  const words = skip.has('query') ? [] : filters.query.toLowerCase().split(/[\s,]+/).filter(Boolean)

  return observations.filter((o) => {
    if (words.length > 0) {
      const text = haystack(o)
      if (!words.every((w) => text.includes(w))) return false
    }
    if (!skip.has('crop') && filters.crop && cropGroupLabel(o.cropName) !== filters.crop) return false
    if (!skip.has('state') && filters.state && observationState(o) !== filters.state) return false
    if (!skip.has('district') && filters.district && observationDistrict(o) !== filters.district) return false
    if (!skip.has('coverage') && filters.coverage && cropCoverage(o.cropName).coverage !== filters.coverage) return false
    if (!skip.has('stage') && filters.stage && o.growthStage !== filters.stage) return false
    if (!skip.has('source') && filters.source && o.aiPredicted !== (filters.source === 'ai')) return false
    if (!skip.has('from') && filters.from && captureDate(o) < filters.from) return false
    if (!skip.has('to') && filters.to && captureDate(o) > filters.to) return false
    if (!skip.has('result') && filters.result !== 'all') {
      const status = evals.get(o.id)?.status
      if (status !== filters.result) return false
    }
    return true
  })
}

export function sortObservations(observations: readonly CropObservation[], sort: SortKey, evals: EvalMap): CropObservation[] {
  const byDate = (a: CropObservation, b: CropObservation) => b.capturedAt.localeCompare(a.capturedAt)
  const rank = (o: CropObservation) => {
    const status = evals.get(o.id)?.status
    return status === 'wrong' ? 0 : status === 'right' ? 1 : 2
  }
  const copy = [...observations]
  switch (sort) {
    case 'oldest':
      return copy.sort((a, b) => -byDate(a, b))
    case 'crop':
      return copy.sort((a, b) => cropGroupLabel(a.cropName).localeCompare(cropGroupLabel(b.cropName)) || byDate(a, b))
    case 'wrong_first':
      return copy.sort((a, b) => rank(a) - rank(b) || byDate(a, b))
    default:
      return copy.sort(byDate)
  }
}

export function activeFilterCount(filters: ObservationFilters): number {
  let count = 0
  if (filters.query.trim()) count += 1
  for (const key of ['crop', 'state', 'district', 'coverage', 'stage', 'source', 'from', 'to'] as const) if (filters[key]) count += 1
  if (filters.result !== 'all') count += 1
  return count
}

export interface FilterOption {
  value: string
  label: string
  count: number
}

function countBy(observations: readonly CropObservation[], keyOf: (o: CropObservation) => string | null): FilterOption[] {
  const counts = new Map<string, number>()
  for (const o of observations) {
    const key = keyOf(o)
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()].map(([value, count]) => ({ value, label: value, count })).sort((a, b) => a.label.localeCompare(b.label))
}

export interface FilterOptions {
  crops: Record<CropCoverage, FilterOption[]>
  states: FilterOption[]
  districts: FilterOption[]
  stages: FilterOption[]
}

/** Dropdown choices built from what is actually logged, so every option returns at least one observation. */
export function buildFilterOptions(observations: readonly CropObservation[], filters: ObservationFilters): FilterOptions {
  const cropsOf = (coverage: CropCoverage) =>
    countBy(
      observations.filter((o) => cropCoverage(o.cropName).coverage === coverage),
      (o) => cropGroupLabel(o.cropName),
    )
  const inState = filters.state ? observations.filter((o) => observationState(o) === filters.state) : observations
  return {
    crops: { amed: cropsOf('amed'), added: cropsOf('added'), other: cropsOf('other') },
    states: countBy(observations, (o) => (o.place?.state ? observationState(o) : null)),
    districts: countBy(inState, (o) => (o.place?.district || o.place?.city ? observationDistrict(o) : null)),
    stages: countBy(observations, (o) => o.growthStage).map((s) => ({ ...s, label: STAGE_LABELS[s.value] ?? s.value })),
  }
}
