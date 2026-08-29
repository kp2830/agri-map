import type { NormalizedFieldFeature } from '../../types/agricultural'
import {
  colorForCropLabel,
  formatAluType,
  formatArea,
  formatCropLabel,
  formatPercent,
  formatTimestamp,
  getActiveCropOutcome,
  getPrimaryCrop,
} from './cropDisplay'

interface FieldDetailsPanelProps {
  feature: NormalizedFieldFeature | null
  cropColorMap: Map<string, string>
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 text-sm">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right font-medium text-slate-800">{value}</dd>
    </div>
  )
}

function SectionHeading({ children }: { children: string }) {
  return <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{children}</h4>
}

export function FieldDetailsPanel({ feature, cropColorMap }: FieldDetailsPanelProps) {
  if (!feature) {
    return (
      <p className="text-sm text-slate-500">
        Click a field on the map to inspect its ALU classification and, where available, its AMED crop prediction.
      </p>
    )
  }

  const { properties } = feature
  const seasons = properties.monitoring ?? []
  const sortedSeasons = [...seasons].sort((a, b) => b.startTimestampSec - a.startTimestampSec)

  // The single source of truth for "which season's crop to show" — reused for both the label
  // and its own sowing/harvest dates/predictions, so they can never disagree (see
  // getActiveCropOutcome for why this isn't simply "whichever season started most recently"
  // in a way that ignores AMED's reporting lag).
  const outcome = getActiveCropOutcome(properties)
  const activeSeason = outcome.kind === 'active' ? outcome.season : null
  const primaryCrop = getPrimaryCrop(properties)
  const primaryPrediction = activeSeason?.predictions[0] ?? null
  const alternativePredictions = activeSeason?.predictions.slice(1) ?? []
  const pastSeasons = sortedSeasons.filter((season) => season !== activeSeason)

  return (
    <div className="space-y-5">
      <div>
        <div className="mb-2 flex items-center gap-2">
          <span
            className="h-3 w-3 shrink-0 rounded-sm"
            style={{ backgroundColor: colorForCropLabel(primaryCrop, cropColorMap) }}
            aria-hidden
          />
          <h3 className="truncate font-mono text-sm font-semibold text-slate-900">{String(feature.id)}</h3>
        </div>

        <SectionHeading>Field</SectionHeading>
        <dl className="mt-1 divide-y divide-slate-50">
          <DetailRow label="Area" value={formatArea(properties.areaSqM)} />
          <DetailRow label="ALU type" value={formatAluType(properties.aluType)} />
          <DetailRow label="Classification confidence" value={formatPercent(properties.classConfidence)} />
          <DetailRow label="Imagery capture date" value={formatTimestamp(properties.captureTimestampSec)} />
        </dl>
      </div>

      {properties.aluType !== 'field' ? (
        <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-500">
          Crop monitoring only applies to field-type features.
        </p>
      ) : outcome.kind === 'none' ? (
        <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-500">
          No crop monitoring data is available for this field.
        </p>
      ) : (
        <div>
          <SectionHeading>Crop</SectionHeading>
          <dl className="mt-1 divide-y divide-slate-50">
            <DetailRow label="Current crop" value={formatCropLabel(primaryCrop)} />
            {primaryPrediction && <DetailRow label="Crop confidence" value={formatPercent(primaryPrediction.confidence)} />}
            <DetailRow label="Sowing" value={formatTimestamp(outcome.season.startTimestampSec)} />
            <DetailRow label="Harvest" value={formatTimestamp(outcome.season.endTimestampSec)} />
          </dl>

          {alternativePredictions.length > 0 && (
            <div className="mt-3">
              <SectionHeading>Alternative predictions</SectionHeading>
              <ul className="mt-1 space-y-1">
                {alternativePredictions.map((prediction) => (
                  <li key={prediction.crop} className="flex items-baseline justify-between text-sm text-slate-600">
                    <span>{formatCropLabel(prediction.crop)}</span>
                    <span className="tabular-nums text-slate-400">{formatPercent(prediction.confidence)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {pastSeasons.length > 0 && (
        <div>
          <SectionHeading>Historical monitoring</SectionHeading>
          <ul className="mt-1 space-y-2">
            {pastSeasons.map((season, index) => (
              <li key={index} className="flex items-baseline justify-between gap-2 text-sm">
                <span className="text-slate-500">
                  {formatTimestamp(season.startTimestampSec)} – {formatTimestamp(season.endTimestampSec)}
                </span>
                <span className="font-medium text-slate-700">{formatCropLabel(season.predictions[0]?.crop ?? null)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
