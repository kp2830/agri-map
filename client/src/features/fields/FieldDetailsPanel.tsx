import type { NormalizedFieldFeature } from '../../types/agricultural'
import { formatAluType, formatArea, formatCropLabel, formatPercent, formatTimestamp, getPrimaryCrop } from './cropDisplay'

interface FieldDetailsPanelProps {
  feature: NormalizedFieldFeature | null
}

export function FieldDetailsPanel({ feature }: FieldDetailsPanelProps) {
  if (!feature) {
    return <p className="text-sm text-slate-500">Click a field on the map to see its details.</p>
  }

  const { properties } = feature
  const seasons = properties.monitoring ?? []
  const sortedSeasons = [...seasons].sort((a, b) => b.startTimestampSec - a.startTimestampSec)
  const latestSeason = sortedSeasons[0] ?? null
  const primaryCrop = getPrimaryCrop(properties)
  const primaryPrediction = latestSeason?.predictions[0] ?? null

  return (
    <div className="space-y-4 text-sm">
      <div>
        <h3 className="font-semibold text-slate-900">Field {feature.id}</h3>
        <dl className="mt-2 space-y-1 text-slate-700">
          <div className="flex justify-between gap-2">
            <dt className="text-slate-500">Area</dt>
            <dd>{formatArea(properties.areaSqM)}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-slate-500">ALU type</dt>
            <dd>{formatAluType(properties.aluType)}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-slate-500">Classification confidence</dt>
            <dd>{formatPercent(properties.classConfidence)}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-slate-500">Imagery capture date</dt>
            <dd>{formatTimestamp(properties.captureTimestampSec)}</dd>
          </div>
        </dl>
      </div>

      {properties.aluType !== 'field' ? (
        <p className="text-slate-500">Crop monitoring only applies to field-type features.</p>
      ) : latestSeason === null ? (
        <p className="text-slate-500">No crop monitoring data available for this field.</p>
      ) : (
        <div>
          <h4 className="font-medium text-slate-900">Current season</h4>
          <dl className="mt-2 space-y-1 text-slate-700">
            <div className="flex justify-between gap-2">
              <dt className="text-slate-500">Crop</dt>
              <dd>{formatCropLabel(primaryCrop)}</dd>
            </div>
            {primaryPrediction && (
              <div className="flex justify-between gap-2">
                <dt className="text-slate-500">Crop confidence</dt>
                <dd>{formatPercent(primaryPrediction.confidence)}</dd>
              </div>
            )}
            <div className="flex justify-between gap-2">
              <dt className="text-slate-500">Sowing</dt>
              <dd>{formatTimestamp(latestSeason.startTimestampSec)}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-slate-500">Harvest</dt>
              <dd>{formatTimestamp(latestSeason.endTimestampSec)}</dd>
            </div>
          </dl>

          {primaryPrediction && latestSeason.predictions.length > 1 && (
            <p className="mt-2 text-xs text-slate-500">
              Alternative predictions:{' '}
              {latestSeason.predictions
                .slice(1)
                .map((p) => `${formatCropLabel(p.crop)} (${formatPercent(p.confidence)})`)
                .join(', ')}
            </p>
          )}
        </div>
      )}

      {sortedSeasons.length > 1 && (
        <div>
          <h4 className="font-medium text-slate-900">Historical monitoring</h4>
          <ul className="mt-2 space-y-1 text-slate-700">
            {sortedSeasons.slice(1).map((season, index) => (
              <li key={index} className="flex justify-between gap-2">
                <span className="text-slate-500">
                  {formatTimestamp(season.startTimestampSec)} – {formatTimestamp(season.endTimestampSec)}
                </span>
                <span>{formatCropLabel(season.predictions[0]?.crop ?? null)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
