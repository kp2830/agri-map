import { formatCropLabel, formatTimestamp } from './cropDisplay'
import { formatMonthName, type CropOutlook } from './cropPrediction'

function SectionHeading({ children }: { children: string }) {
  return <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{children}</h4>
}

/**
 * The Past data counterpart of CropOutlookCard: what AMED recorded for this field in the picked
 * month and year. Same real fields as the outlook (crop, AMED's own confidence, the recorded
 * season), but labelled "Past record", never "Predicted".
 */
export function PastRecordCard({ outlook, cropColorSwatch }: { outlook: CropOutlook; cropColorSwatch: string }) {
  const heading = `${formatMonthName(outlook.selectedMonth)} ${outlook.selectedYear}`

  if (!outlook.dataAvailable || outlook.crop === null) {
    return (
      <div>
        <SectionHeading>Past record (AMED)</SectionHeading>
        <p className="text-sm font-medium text-slate-700">{heading}</p>
        <p className="mt-2 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-500">No AMED record for this field in {heading}.</p>
      </div>
    )
  }

  return (
    <div>
      <SectionHeading>Past record (AMED)</SectionHeading>
      <p className="text-sm font-medium text-slate-700">{heading}</p>

      <div className="mt-3 rounded-lg border border-indigo-200 bg-indigo-50/60 p-3">
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-indigo-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">Past data</span>
          <span className="text-xs font-semibold uppercase tracking-wide text-indigo-700">Recorded crop</span>
        </div>
        <div className="mt-1.5 flex items-center gap-2">
          <span className="h-4 w-4 shrink-0 rounded-sm" style={{ backgroundColor: cropColorSwatch }} aria-hidden />
          <span className="text-xl font-bold text-slate-900">{formatCropLabel(outlook.crop)}</span>
        </div>
      </div>

      <dl className="mt-3 divide-y divide-slate-50 text-sm">
        <div className="flex items-baseline justify-between py-1">
          <dt className="text-slate-500">AMED confidence</dt>
          <dd className="font-semibold tabular-nums text-slate-900">{outlook.confidencePercent !== null ? `${outlook.confidencePercent}%` : 'Unavailable'}</dd>
        </div>
        {outlook.historicalSeasonRange && (
          <div className="flex items-baseline justify-between py-1">
            <dt className="text-slate-500">Recorded season</dt>
            <dd className="font-medium text-slate-800">
              {formatTimestamp(outlook.historicalSeasonRange.startSec)} – {formatTimestamp(outlook.historicalSeasonRange.endSec)}
            </dd>
          </div>
        )}
      </dl>
    </div>
  )
}
