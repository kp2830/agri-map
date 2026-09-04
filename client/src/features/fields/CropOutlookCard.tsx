import type { ReactNode } from 'react'
import type { CropOutlook } from './cropPrediction'
import { formatMonthName, formatMonthRange, formatOutlookBasis } from './cropPrediction'
import { formatCropLabel } from './cropDisplay'

function SectionHeading({ children }: { children: ReactNode }) {
  return <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{children}</h4>
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 text-sm">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right font-medium text-slate-800">{value}</dd>
    </div>
  )
}

/**
 * The primary predictive block of FieldDetailsPanel — "what AgriMap predicts for the selected
 * month," never "what AMED historically recorded" (that's the secondary Crop History section
 * elsewhere in the panel). Pure presentation: every value here comes straight from the
 * CropOutlook object computed by cropPrediction.ts's predictCropOutlook — nothing is derived,
 * guessed, or fabricated inside this component.
 */
export function CropOutlookCard({ outlook, cropColorSwatch }: { outlook: CropOutlook; cropColorSwatch: string }) {
  const monthLabel = `${formatMonthName(outlook.selectedMonth)} ${outlook.selectedYear}`

  if (!outlook.dataAvailable || outlook.crop === null) {
    return (
      <div>
        <SectionHeading>Crop Outlook · {monthLabel}</SectionHeading>
        <p className="mt-2 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-500">Insufficient historical data</p>
      </div>
    )
  }

  return (
    <div>
      <SectionHeading>Crop Outlook · {monthLabel}</SectionHeading>

      <div className="mt-2 flex items-center gap-2">
        <span className="h-3.5 w-3.5 shrink-0 rounded-sm" style={{ backgroundColor: cropColorSwatch }} aria-hidden />
        <div>
          <p className="text-xs font-medium text-slate-400">Expected Crop</p>
          <p className="text-base font-semibold text-slate-900">{formatCropLabel(outlook.crop)}</p>
        </div>
      </div>

      <dl className="mt-2 divide-y divide-slate-50">
        {outlook.confidencePercent !== null && <DetailRow label="Predicted Crop Confidence" value={`${outlook.confidencePercent}%`} />}
        {outlook.sowing && <DetailRow label="Predicted Sowing" value={formatMonthRange(outlook.sowing)} />}
        {outlook.harvest && <DetailRow label="Predicted Harvest" value={formatMonthRange(outlook.harvest)} />}
        {outlook.historicalReferenceYear !== null && (
          <DetailRow
            label="Historical Reference"
            value={`${formatMonthName(outlook.selectedMonth)} ${outlook.historicalReferenceYear}`}
          />
        )}
      </dl>

      <p className="mt-2 text-xs text-slate-400">{formatOutlookBasis(outlook.basis)}</p>
    </div>
  )
}
