interface StatusCardProps {
  tone: 'info' | 'error'
  title: string
  description?: string
}

export function StatusCard({ tone, title, description }: StatusCardProps) {
  const toneClasses = tone === 'error' ? 'border-red-200 bg-red-50 text-red-700' : 'border-slate-200 bg-slate-50 text-slate-600'

  return (
    <div className={`rounded-lg border px-4 py-3 text-sm ${toneClasses}`} role={tone === 'error' ? 'alert' : undefined}>
      <p className="font-medium">{title}</p>
      {description && <p className="mt-1 text-[13px] leading-snug opacity-90">{description}</p>}
    </div>
  )
}
