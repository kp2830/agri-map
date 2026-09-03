import { useState } from 'react'
import type { AluFeatureType, NormalizedFieldCollection } from '../../types/agricultural'
import { colorForAluType, colorForCropLabel, formatAluType, formatCropLabel, formatHectares, SUNFLOWER_LIKELY_FILL_COLOR } from './cropDisplay'
import { ALL_CROPS, filterFieldsByCrop, totalFieldAreaSqM, type CropFilterValue } from './cropFilter'
import { computeSunflowerShare, summarizeCropShares, SUNFLOWER_CROP_KEY, type CropShare } from './cropSummary'

interface CropSummaryPanelProps {
  fieldCollection: NormalizedFieldCollection
  cropColorMap: Map<string, string>
  selectedCrop: CropFilterValue
  /** Same real per-field RF probabilities driving the map's gold coloring (see
   *  useSunflowerFieldColors, now lifted to App.tsx so both the map and this panel read the
   *  same data) — never recalculated here. */
  sunflowerProbabilities: Map<string, number>
}

/** The color swatch for a share row — Sunflower isn't a real AMED crop label (it's never in
 *  cropColorMap, which is built only from genuine AMED predictions), so it needs its own case
 *  rather than falling through to colorForCropLabel's "unrecognized crop" gray. */
function colorForShare(share: CropShare, colorMap: Map<string, string>): string {
  return share.crop === SUNFLOWER_CROP_KEY ? SUNFLOWER_LIKELY_FILL_COLOR : colorForCropLabel(share.crop, colorMap)
}

const VISIBLE_ROWS = 6
const NON_FIELD_TYPES: Exclude<AluFeatureType, 'field'>[] = ['trees', 'farm_pond', 'other_water', 'dug_well']

/** A single crop is selected: total area/field count for just that crop, from real field data.
 *  Also handles SUNFLOWER_CROP_KEY (selected via the dropdown's pinned "Sunflower" option) —
 *  filterFieldsByCrop already knows how to match that against sunflowerProbabilities instead of
 *  an AMED crop identity, so this needs no special-case filtering logic, only a special-case
 *  swatch color and label (Sunflower isn't in cropColorMap, which is built only from genuine
 *  AMED predictions). */
function SelectedCropSummary({ fieldCollection, cropColorMap, selectedCrop, sunflowerProbabilities }: CropSummaryPanelProps) {
  const isSunflowerFilter = selectedCrop === SUNFLOWER_CROP_KEY
  const matching = filterFieldsByCrop(fieldCollection, selectedCrop, sunflowerProbabilities)
  const areaSqM = matching.features.reduce((sum, feature) => sum + feature.properties.areaSqM, 0)
  const totalArea = totalFieldAreaSqM(fieldCollection)
  const sharePercent = totalArea > 0 ? (areaSqM / totalArea) * 100 : null
  const color = isSunflowerFilter ? SUNFLOWER_LIKELY_FILL_COLOR : colorForCropLabel(selectedCrop, cropColorMap)

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
      {isSunflowerFilter && (
        <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Experimental RF signal (&gt;50% likelihood) — not an AMED prediction. A field here may
          also carry its own AMED crop (e.g. Corn); Sunflower is additive, not a replacement.
        </p>
      )}
    </div>
  )
}

export function CropSummaryPanel({ fieldCollection, cropColorMap, selectedCrop, sunflowerProbabilities }: CropSummaryPanelProps) {
  const [showAll, setShowAll] = useState(false)

  if (selectedCrop !== ALL_CROPS) {
    return (
      <SelectedCropSummary
        fieldCollection={fieldCollection}
        cropColorMap={cropColorMap}
        selectedCrop={selectedCrop}
        sunflowerProbabilities={sunflowerProbabilities}
      />
    )
  }

  const amedShares = summarizeCropShares(fieldCollection)
  const sunflowerShare = computeSunflowerShare(fieldCollection, sunflowerProbabilities)
  // Additive, not a replacement for any AMED row — inserted into the same ranked-by-area list
  // so Sunflower reads as a normal category (per the product requirement) while still being
  // visually flagged below as an independent RF signal, not a genuine AMED prediction.
  const shares = sunflowerShare ? [...amedShares, sunflowerShare].sort((a, b) => b.areaSqM - a.areaSqM) : amedShares

  const presentNonFieldTypes = NON_FIELD_TYPES.filter((type) =>
    fieldCollection.features.some((feature) => feature.properties.aluType === type),
  )

  if (shares.length === 0) {
    return <p className="text-sm text-slate-500">No field-type ALU features were found in this area.</p>
  }

  // Sunflower is pinned into the visible rows whenever it's present, rather than competing on
  // raw area like a normal AMED category: early in a search (only the first few of the capped
  // eligible fields checked so far) its area is necessarily tiny next to bulk categories like
  // Rice, so a pure area-sort buries it behind "Show more crops" — confirmed via live browser
  // testing (a real 96%+ field was checked and colored gold on the map within seconds, yet
  // "Sunflower" never appeared in the initially-rendered distribution list because it ranked
  // 9th by area). The product requirement is for it to be visibly present the moment any field
  // clears the threshold, not to win an area contest against Rice.
  const topByArea = shares.slice(0, VISIBLE_ROWS)
  const visibleShares = showAll
    ? shares
    : sunflowerShare && !topByArea.includes(sunflowerShare)
      ? [...topByArea.slice(0, VISIBLE_ROWS - 1), sunflowerShare]
      : topByArea
  const hiddenCount = shares.length - visibleShares.length

  return (
    <div className="space-y-4">
      <ul className="space-y-3">
        {visibleShares.map((share) => {
          const color = colorForShare(share, cropColorMap)
          const percent = share.percentage * 100
          const isSunflower = share.crop === SUNFLOWER_CROP_KEY

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
              {isSunflower && (
                <p className="mt-1 text-xs text-slate-400">Experimental RF signal (&gt;50% likelihood) — not an AMED prediction, may overlap with other crops above.</p>
              )}
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
