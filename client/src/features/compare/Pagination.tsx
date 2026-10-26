interface PaginationProps {
  /** Zero-based current page. */
  page: number
  pageCount: number
  onPage: (page: number) => void
}

/** 1 … 4 5 6 … 12 — always the first, last and the pages around the current one. */
function pageItems(page: number, pageCount: number): Array<number | 'gap'> {
  const wanted = new Set([0, pageCount - 1, page - 1, page, page + 1].filter((p) => p >= 0 && p < pageCount))
  const sorted = [...wanted].sort((a, b) => a - b)
  const items: Array<number | 'gap'> = []
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1] > 1) items.push('gap')
    items.push(p)
  })
  return items
}

export function Pagination({ page, pageCount, onPage }: PaginationProps) {
  if (pageCount <= 1) return null
  const base =
    'inline-flex h-8 min-w-8 items-center justify-center rounded-md border px-2 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500'
  return (
    <nav aria-label="Observation pages" className="flex flex-wrap items-center justify-center gap-1">
      <button
        type="button"
        onClick={() => onPage(page - 1)}
        disabled={page === 0}
        className={`${base} border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40`}
        aria-label="Previous page"
      >
        ‹
      </button>
      {pageItems(page, pageCount).map((item, i) =>
        item === 'gap' ? (
          <span key={`gap-${i}`} className="px-1 text-xs text-slate-400" aria-hidden>
            …
          </span>
        ) : (
          <button
            key={item}
            type="button"
            onClick={() => onPage(item)}
            aria-current={item === page ? 'page' : undefined}
            className={`${base} ${item === page ? 'border-sky-600 bg-sky-600 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}
          >
            {item + 1}
          </button>
        ),
      )}
      <button
        type="button"
        onClick={() => onPage(page + 1)}
        disabled={page >= pageCount - 1}
        className={`${base} border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40`}
        aria-label="Next page"
      >
        ›
      </button>
    </nav>
  )
}
