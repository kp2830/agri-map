import { MODEL_SIGNALS, type ModelSignalKey } from './modelSignals'

const TONES: Record<ModelSignalKey, { box: string; label: string; value: string; body: string }> = {
  sunflower: { box: 'bg-amber-50', label: 'text-amber-800', value: 'text-amber-900', body: 'text-amber-700' },
  safflower: { box: 'bg-orange-50', label: 'text-orange-800', value: 'text-orange-900', body: 'text-orange-700' },
  coriander: { box: 'bg-emerald-50', label: 'text-emerald-800', value: 'text-emerald-900', body: 'text-emerald-700' },
  fennel: { box: 'bg-violet-50', label: 'text-violet-800', value: 'text-violet-900', body: 'text-violet-700' },
}

/** The likelihood box for one predictive crop model on the selected field — same look for all four crops. */
export function ModelSignalCard({ signal, percent }: { signal: ModelSignalKey; percent: number }) {
  const info = MODEL_SIGNALS[signal]
  const tone = TONES[signal]

  return (
    <div className={`rounded-md px-3 py-2 ${tone.box}`}>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className={tone.label}>{info.label} likelihood</span>
        <span className={`font-semibold tabular-nums ${tone.value}`}>{percent}%</span>
      </div>
      <p className={`mt-1 text-xs ${tone.body}`}>
        Predictive model trained by us on fields from {info.trainedOn}. AMED's own result above is unchanged.
      </p>
    </div>
  )
}
