import type { NormalizedFieldCollection } from '../../types/agricultural'
import { colorForCropSwatch, formatCropLabel } from './cropDisplay'

import { summarizeCropShares } from './cropSummary'

interface CropSummaryPanelProps {
  fieldCollection: NormalizedFieldCollection
}

export function CropSummaryPanel({ fieldCollection }: CropSummaryPanelProps) {
  const shares = summarizeCropShares(fieldCollection)

  if (shares.length === 0) {
    return <p className="text-sm text-slate-500">No field-type ALU features in this area.</p>
  }

  return (
    <ul className="space-y-1.5">
      {shares.map((share) => (
        <li key={share.crop ?? 'none'} className="flex items-center gap-2 text-sm">
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: colorForCropSwatch(share.crop) }}
          />
          <span className="flex-1 truncate text-slate-700">{formatCropLabel(share.crop)}</span>
          <span className="font-medium text-slate-900">{(share.percentage * 100).toFixed(1)}%</span>
        </li>
      ))}
    </ul>
  )
}
