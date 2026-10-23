import {
  CORIANDER_LIKELY_FILL_COLOR,
  FENNEL_LIKELY_FILL_COLOR,
  SAFFLOWER_LIKELY_FILL_COLOR,
  SUNFLOWER_LIKELY_FILL_COLOR,
} from './cropDisplay'

export type ModelSignalKey = 'sunflower' | 'safflower' | 'coriander' | 'fennel'

export interface ModelSignalInfo {
  label: string
  /** Accent color — the same one the crop uses on the map. */
  color: string
  /** Where the training fields come from (shown as "Trained on"). */
  trainedOn: string
  /** The calendar window the model is run in. */
  season: string
}

/**
 * What each experimental crop model was actually trained on — kept in one place so every box
 * (field details, crop distribution) says the same, accurate thing. Source of truth is each
 * model's config under server/src/services/agricultural/*Rf/config.ts; update both together
 * when a model is retrained.
 */
export const MODEL_SIGNALS: Record<ModelSignalKey, ModelSignalInfo> = {
  sunflower: {
    label: 'Sunflower',
    color: SUNFLOWER_LIKELY_FILL_COLOR,
    trainedOn: 'Haryana',
    season: 'February – June',
  },
  safflower: {
    label: 'Safflower',
    color: SAFFLOWER_LIKELY_FILL_COLOR,
    trainedOn: 'Maharashtra',
    season: 'October – March',
  },
  coriander: {
    label: 'Coriander',
    color: CORIANDER_LIKELY_FILL_COLOR,
    trainedOn: 'Uttar Pradesh, Rajasthan, Bihar and Odisha',
    season: 'October – March',
  },
  fennel: {
    label: 'Fennel',
    color: FENNEL_LIKELY_FILL_COLOR,
    trainedOn: 'Rajasthan, Gujarat and Madhya Pradesh',
    season: 'October – April',
  },
}

/** One-line version for compact places such as the crop distribution list. */
export function modelSignalSummary(key: ModelSignalKey): string {
  return `Predictive model trained by us on ${MODEL_SIGNALS[key].trainedOn} · not an AMED prediction`
}
