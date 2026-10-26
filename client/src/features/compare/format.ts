import type { CropObservation } from '../../types/agricultural'
import { STAGE_LABELS } from './observationFilters'

export function formatStage(stage: string | null): string {
  if (!stage) return 'Stage not recorded'
  return STAGE_LABELS[stage] ?? stage.replace(/_/g, ' ')
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

export function formatPlace(place: CropObservation['place']): string {
  if (!place) return 'Looking up place…'
  const parts = [place.city, place.district, place.state].filter((p): p is string => !!p)
  return [...new Set(parts)].join(', ') || 'Place unknown'
}
