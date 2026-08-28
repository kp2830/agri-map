/**
 * Lightweight client-side timing instrumentation for the map-click → rendered-fields path.
 * Marks are just `performance.now()` timestamps in a shared in-memory map (a plain module
 * singleton — safe because ES modules are per-tab singletons), read back as console.debug
 * deltas. Cheap enough to leave in production: each call is a single map write or a
 * subtraction plus a console line, never sent anywhere or persisted.
 */
const marks = new Map<string, number>()

export function markPerf(name: string): void {
  marks.set(name, performance.now())
}

/** Logs `label: (toMark - fromMark)ms` if both marks exist; a no-op otherwise (e.g. a
 *  superseded request whose marks were overwritten by a newer click). */
export function logPerfDelta(fromMark: string, toMark: string, label: string): void {
  const from = marks.get(fromMark)
  const to = marks.get(toMark)
  if (from === undefined || to === undefined) return
  console.debug(`[perf] ${label}: ${(to - from).toFixed(0)}ms`)
}
