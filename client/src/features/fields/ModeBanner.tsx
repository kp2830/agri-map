import { AMED_CROP_KEYS } from './cropFilter'
import { formatCropLabel } from './cropDisplay'
import { formatMonthName, type ViewMode } from './cropPrediction'

interface ModeBannerProps {
  mode: ViewMode
  month: number
  year: number
  /** Compact single-line form, for sitting on top of the map. */
  compact?: boolean
}

const AMED_CROP_LABELS = AMED_CROP_KEYS.map((key) => formatCropLabel(key)).join(', ')

/**
 * The always-visible statement of which mode the numbers on screen come from. Predictive is the
 * default; Past data is clearly marked as a recorded history, not a forecast, and says outright
 * that it only covers the 12 AMED crops (no Sunflower/Safflower/Coriander/Fennel).
 */
export function ModeBanner({ mode, month, year, compact = false }: ModeBannerProps) {
  if (compact) {
    return mode === 'predictive' ? (
      <span className="rounded-full bg-emerald-600 px-3 py-1 text-xs font-bold uppercase tracking-wide text-white shadow">
        Predictive model · {formatMonthName(month)}
      </span>
    ) : (
      <span className="rounded-full bg-indigo-600 px-3 py-1 text-xs font-bold uppercase tracking-wide text-white shadow">
        Past data (AMED record) · {formatMonthName(month)} {year}
      </span>
    )
  }

  if (mode === 'predictive') {
    return (
      <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3">
        <p className="text-xs font-bold uppercase tracking-wide text-emerald-800">Predictive model (default)</p>
        <p className="mt-1 text-sm text-emerald-900">
          Estimates what is likely to grow in {formatMonthName(month)}, based on what each field grew in earlier seasons. Covers
          the 12 AMED crops plus our experimental Sunflower, Safflower, Coriander and Fennel models.
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-indigo-300 bg-indigo-50 p-3">
      <p className="text-xs font-bold uppercase tracking-wide text-indigo-800">Past data — AMED record, not a prediction</p>
      <p className="mt-1 text-sm text-indigo-900">
        Shows what AMED satellite monitoring actually recorded for {formatMonthName(month)} {year}.
      </p>
      <p className="mt-1 text-xs text-indigo-800">
        Only the 12 AMED crops are covered ({AMED_CROP_LABELS}). Sunflower, Safflower, Coriander and Fennel were added later and
        are not available here. Fields with no AMED record for this month show as "No AMED record".
      </p>
    </div>
  )
}
