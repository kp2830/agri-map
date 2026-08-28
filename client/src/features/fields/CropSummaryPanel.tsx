import { useState } from 'react'
import type { AluFeatureType, NormalizedFieldCollection } from '../../types/agricultural'
import { colorForAluType, colorForCropLabel, formatAluType, formatCropLabel, formatHectares } from './cropDisplay'
import { ALL_CROPS, filterFieldsByCrop, totalFieldAreaSqM, type CropFilterValue } from './cropFilter'
import { summarizeCropShares } from './cropSummary'

interface CropSummaryPanelProps {
  fieldCollection: NormalizedFieldCollection
  cropColorMap: Map<string, string>
  selectedCrop: CropFilterValue
}

const VISIBLE_ROWS = 6
const NON_FIELD_TYPES: Exclude<AluFeatureType, 'field'>[] = ['trees', 'farm_pond', 'other_water', 'dug_well']

/** A single crop is selected: total area/field count for just that crop, from real field data. */
function SelectedCropSummary({ fieldCollection, cropColorMap, selectedCrop }: CropSummaryPanelProps) {
  const matching = filterFieldsByCrop(fieldCollection, selectedCrop)
  const areaSqM = matching.features.reduce((sum, feature) => sum + feature.properties.areaSqM, 0)
  const totalArea = totalFieldAreaSqM(fieldCollection)
  const sharePercent = totalArea > 0 ? (areaSqM / totalArea) * 100 : null
  const color = colorForCropLabel(selectedCrop, cropColorMap)

  if (matching.features.length === 0) {
    return <p className="text-sm text-slate-500">No {formatCropLabel(selectedCrop)} fields in this area.</p>
  }

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <span className="h-3 w-3 shrink-0 rounded-sm" style={{ backgroundColor: color }} aria-hidden />
        <h3 className="text-sm font-semibold text-slate-900">{formatCropLabel(selectedCrop)}</h3>
      </div>
      <dl className="divide-y divide-slate-50">
        <div className="flex items-baseline justify-between py-1 text-sm">
          <dt className="text-slate-500">Fields</dt>
          <dd className="font-medium text-slate-800">{matching.features.length}</dd>
        </div>
        <div className="flex items-baseline justify-between py-1 text-sm">
          <dt className="text-slate-500">Total area</dt>
          <dd className="font-medium text-slate-800">{formatHectares(areaSqM)}</dd>
        </div>
        {sharePercent !== null && (
          <div className="flex items-baseline justify-between py-1 text-sm">
            <dt className="text-slate-500">Share of analyzed agricultural area</dt>
            <dd className="font-medium text-slate-800">{sharePercent.toFixed(1)}%</dd>
          </div>
        )}
      </dl>
    </div>
  )
}

export function CropSummaryPanel({ fieldCollection, cropColorMap, selectedCrop }: CropSummaryPanelProps) {
  const [showAll, setShowAll] = useState(false)

  if (selectedCrop !== ALL_CROPS) {
    return <SelectedCropSummary fieldCollection={fieldCollection} cropColorMap={cropColorMap} selectedCrop={selectedCrop} />
  }

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
