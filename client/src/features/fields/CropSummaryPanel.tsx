import { useState } from 'react'
import type { AluFeatureType, NormalizedFieldCollection } from '../../types/agricultural'
import { colorForAluType, colorForCropLabel, formatAluType, formatCropLabel, formatHectares } from './cropDisplay'
import { summarizeCropShares } from './cropSummary'

interface CropSummaryPanelProps {
  fieldCollection: NormalizedFieldCollection
  cropColorMap: Map<string, string>
}

const VISIBLE_ROWS = 6
const NON_FIELD_TYPES: Exclude<AluFeatureType, 'field'>[] = ['trees', 'farm_pond', 'other_water', 'dug_well']

export function CropSummaryPanel({ fieldCollection, cropColorMap }: CropSummaryPanelProps) {
  const [showAll, setShowAll] = useState(false)
  const shares = summarizeCropShares(fieldCollection)

  const presentNonFieldTypes = NON_FIELD_TYPES.filter((type) =>
    fieldCollection.features.some((feature) => feature.properties.aluType === type),
  )

  if (shares.length === 0) {
    return <p className="text-sm text-slate-500">No field-type ALU features were found in this area.</p>
  }

  const visibleShares = showAll ? shares : shares.slice(0, VISIBLE_ROWS)
  const hiddenCount = shares.length - visibleShares.length

  return (
    <div className="space-y-4">
      <ul className="space-y-3">
        {visibleShares.map((share) => {
          const color = colorForCropLabel(share.crop, cropColorMap)
          const percent = share.percentage * 100

          return (
            <li key={share.crop ?? 'none'}>
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="truncate font-medium text-slate-800">{formatCropLabel(share.crop)}</span>
                <span className="shrink-0 tabular-nums text-slate-500">
                  {percent.toFixed(1)}% · {formatHectares(share.areaSqM)}
                </span>
              </div>
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full transition-[width]"
                  style={{ width: `${Math.max(percent, 1.5)}%`, backgroundColor: color }}
                />
              </div>
            </li>
          )
        })}
      </ul>

      {hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="text-xs font-medium text-emerald-700 hover:text-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-1 rounded"
        >
          Show {hiddenCount} more crop{hiddenCount === 1 ? '' : 's'}
        </button>
      )}

      {presentNonFieldTypes.length > 0 && (
        <div className="border-t border-slate-100 pt-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">Other landscape features</p>
          <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
            {presentNonFieldTypes.map((type) => (
              <li key={type} className="flex items-center gap-1.5 text-xs text-slate-600">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: colorForAluType(type) }} />
                {formatAluType(type)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
