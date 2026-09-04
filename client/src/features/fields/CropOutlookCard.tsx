import type { CropOutlook } from './cropPrediction'
import { formatMonthName, formatMonthRange, formatOutlookBasis } from './cropPrediction'
import { formatCropLabel } from './cropDisplay'

function SectionHeading({ children }: { children: string }) {
  return <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{children}</h4>
}

function LifecycleCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex-1 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-slate-800">{value}</p>
    </div>
  )
}

/**
 * The primary predictive block of FieldDetailsPanel — "what AgriMap predicts for the selected
 * month," never "what AMED historically recorded" (that's the secondary Crop History section
 * elsewhere in the panel). Pure presentation: every value here comes straight from the
 * CropOutlook object computed by cropPrediction.ts's predictCropOutlook — nothing is derived,
 * guessed, or fabricated inside this component.
 *
 * Deliberately never renders `outlook.selectedYear` or `outlook.historicalReferenceYear` —
 * the user-facing prediction is explicitly month-oriented, not year-oriented (see
 * formatOutlookBasis's own docstring for why the underlying reference year stays internal-only).
 */
export function CropOutlookCard({ outlook, cropColorSwatch }: { outlook: CropOutlook; cropColorSwatch: string }) {
  if (!outlook.dataAvailable || outlook.crop === null) {
    return (
      <div>
        <SectionHeading>Crop Outlook</SectionHeading>
        <p className="text-sm font-medium text-slate-700">{formatMonthName(outlook.selectedMonth)}</p>
        <p className="mt-2 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-500">Insufficient historical data</p>
      </div>
    )
  }

  return (
    <div>
      <SectionHeading>Crop Outlook</SectionHeading>
      <p className="text-sm font-medium text-slate-700">{formatMonthName(outlook.selectedMonth)}</p>

      <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50/60 p-3">
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
            Predicted
          </span>
          <span className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Crop</span>
        </div>
        <div className="mt-1.5 flex items-center gap-2">
          <span className="h-4 w-4 shrink-0 rounded-sm" style={{ backgroundColor: cropColorSwatch }} aria-hidden />
          <span className="text-xl font-bold text-slate-900">{formatCropLabel(outlook.crop)}</span>
        </div>
      </div>

      <div className="mt-3">
        <div className="flex items-baseline justify-between text-sm">
          <span className="text-slate-500">Predicted Crop Confidence</span>
          <span className="font-semibold tabular-nums text-slate-900">
            {outlook.confidencePercent !== null ? `${outlook.confidencePercent}%` : 'Confidence unavailable'}
          </span>
        </div>
        {outlook.confidencePercent !== null && (
          <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-emerald-600 transition-[width]"
              style={{ width: `${Math.max(outlook.confidencePercent, 2)}%` }}
            />
          </div>
        )}
      </div>

      {outlook.sowing && outlook.harvest && (
        <div className="mt-3">
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-400">Predicted Crop Cycle</p>
          <div className="flex items-stretch gap-2">
            <LifecycleCard label="Sowing" value={formatMonthRange(outlook.sowing)} />
            <span className="flex items-center text-slate-300">→</span>
            <LifecycleCard label="Harvest" value={formatMonthRange(outlook.harvest)} />
          </div>
        </div>
      )}

      <p className="mt-3 text-xs text-slate-400">{formatOutlookBasis(outlook.basis)}</p>
    </div>
  )
}
