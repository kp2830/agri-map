import { useCallback, useEffect, useRef, useState } from 'react'
import type { CropObservation } from '../../types/agricultural'
import type { EvalMap, EvalResult, Evaluation } from './accuracy'
import { cropCoverage } from './compareLogic'
import { evaluateObservation } from './evaluateObservation'

const CACHE_KEY = 'agrimap.compare.evaluations.v1'
/** Field lookups are cheap, so a few run together. */
const FIELD_LANE_LIMIT = 3
/** Our four added crops run a satellite model, which shares one rate-limited quota: one at a time. */
const MODEL_LANE_LIMIT = 1
const ERROR_RETRY_MS = 60 * 1000
const PUMP_INTERVAL_MS = 30 * 1000

type Lane = 'field' | 'model'

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

/** Verdicts are "as of today", so they are kept for the day only — tomorrow they are re-run. */
function readCache(): Map<string, EvalResult> {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return new Map()
    const parsed = JSON.parse(raw) as { day?: string; items?: Record<string, Evaluation> }
    if (parsed.day !== today() || !parsed.items) return new Map()
    return new Map(Object.entries(parsed.items))
  } catch {
    return new Map()
  }
}

function writeCache(results: Map<string, EvalResult>): void {
  try {
    const items: Record<string, Evaluation> = {}
    for (const [id, result] of results) if (result.status !== 'error') items[id] = result
    localStorage.setItem(CACHE_KEY, JSON.stringify({ day: today(), items }))
  } catch {
    // storage unavailable: verdicts are simply re-run next time
  }
}

/** Verdicts that arrive with the observations (demo data) are used as they are — no work, no waiting. */
function seedResults(cached: Map<string, EvalResult>, observations: readonly CropObservation[]): Map<string, EvalResult> {
  for (const o of observations) if (o.evaluation) cached.set(o.id, o.evaluation)
  return cached
}

/**
 * Marks observations right or wrong in the background. Observations are worked through in the
 * order given (put what is on screen first), a few field lookups at a time and our crop models one
 * at a time, so a long list never floods the server or the satellite quota. Verdicts are kept for
 * the day, so reopening Compare does not repeat the work.
 */
export function useObservationEvaluations(order: readonly CropObservation[]): { evals: EvalMap; retryFailed: () => void } {
  const [store] = useState(() => ({
    results: seedResults(readCache(), order),
    inFlight: new Set<string>(),
    errorAt: new Map<string, number>(),
    running: { field: 0, model: 0 } as Record<Lane, number>,
    epoch: 0,
  }))
  const [evals, setEvals] = useState<EvalMap>(() => new Map(store.results))
  const orderRef = useRef(order)
  const controllerRef = useRef<AbortController | null>(null)
  const pumpRef = useRef<() => void>(() => {})

  const pump = useCallback(() => {
    const signal = controllerRef.current?.signal
    if (!signal || signal.aborted) return
    let changed = false
    for (const o of orderRef.current) {
      if (o.evaluation && store.results.get(o.id) !== o.evaluation) {
        store.results.set(o.id, o.evaluation)
        changed = true
        continue
      }
      const known = store.results.get(o.id)
      if (known && known.status !== 'error') continue
      if (store.inFlight.has(o.id)) continue
      if (known?.status === 'error' && Date.now() - (store.errorAt.get(o.id) ?? 0) < ERROR_RETRY_MS) continue

      const { coverage } = cropCoverage(o.cropName)
      if (coverage === 'other') {
        // Nothing to run: the crop is outside our models.
        store.results.set(o.id, { status: 'unjudged', reason: 'not_covered', predicted: null, month: new Date(o.capturedAt).getUTCMonth() + 1 })
        changed = true
        continue
      }
      const lane: Lane = coverage === 'added' ? 'model' : 'field'
      if (store.running[lane] >= (lane === 'model' ? MODEL_LANE_LIMIT : FIELD_LANE_LIMIT)) continue

      const epoch = store.epoch
      store.running[lane] += 1
      store.inFlight.add(o.id)
      evaluateObservation(o, signal)
        .then(
          (evaluation) => {
            if (epoch !== store.epoch) return
            store.results.set(o.id, evaluation)
            store.errorAt.delete(o.id)
          },
          () => {
            if (epoch !== store.epoch) return
            store.results.set(o.id, { status: 'error' })
            store.errorAt.set(o.id, Date.now())
          },
        )
        .finally(() => {
          if (epoch !== store.epoch) return
          store.running[lane] -= 1
          store.inFlight.delete(o.id)
          writeCache(store.results)
          setEvals(new Map(store.results))
          pumpRef.current()
        })
    }
    if (changed) {
      writeCache(store.results)
      setEvals(new Map(store.results))
    }
  }, [store])
  useEffect(() => {
    pumpRef.current = pump
  }, [pump])

  useEffect(() => {
    const controller = new AbortController()
    controllerRef.current = controller
    pump()
    const timer = setInterval(pump, PUMP_INTERVAL_MS)
    return () => {
      controller.abort()
      clearInterval(timer)
      controllerRef.current = null
      // Anything still running belongs to the old epoch and is ignored when it settles.
      store.epoch += 1
      store.inFlight.clear()
      store.running.field = 0
      store.running.model = 0
    }
  }, [pump, store])

  // New observations (or a new priority order) are picked up straight away.
  useEffect(() => {
    orderRef.current = order
    pump()
  }, [order, pump])

  const retryFailed = useCallback(() => {
    store.errorAt.clear()
    pump()
  }, [store, pump])

  return { evals, retryFailed }
}
