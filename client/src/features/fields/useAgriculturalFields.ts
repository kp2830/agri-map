import { useCallback, useRef, useState } from 'react'
import { getAgriculturalFields } from '../../lib/api'
import { logPerfDelta, markPerf } from '../../lib/perf'
import type { FieldsResponse } from '../../types/agricultural'

type FieldsState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'success'; data: FieldsResponse }

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

export function useAgriculturalFields() {
  const [state, setState] = useState<FieldsState>({ status: 'idle' })
  // Tracks the most recently started request so a slower, older request's response
  // can never overwrite the result of a newer one that was started after it.
  const latestRequestId = useRef(0)
  // The in-flight request's AbortController, if any — a newer call aborts it immediately
  // rather than letting it run to completion for a result nobody will use. This also
  // propagates to the backend (see server/src/controllers/agriculturalController.ts),
  // which stops queuing further ALU/AMED cell fetches once the client has gone away.
  const activeController = useRef<AbortController | null>(null)

  // Returns the resolved response so callers can react to it directly (e.g. updating
  // coordinate inputs on fallback), without needing a separate effect that watches state.
  // Returns undefined if this request was superseded by a newer one, or if it failed.
  const fetchFields = useCallback(
    async (lat: number, lng: number, gridKm: number, maxSearchKm: number): Promise<FieldsResponse | undefined> => {
      activeController.current?.abort()
      const controller = new AbortController()
      activeController.current = controller

      const requestId = ++latestRequestId.current
      setState({ status: 'loading' })
      markPerf('requestStart')
      logPerfDelta('click', 'requestStart', 'click → request-started')
      try {
        const data = await getAgriculturalFields(lat, lng, gridKm, maxSearchKm, controller.signal)
        if (requestId !== latestRequestId.current) return undefined
        markPerf('responseReceived')
        logPerfDelta('requestStart', 'responseReceived', 'request-started → response-received')
        setState({ status: 'success', data })
        return data
      } catch (error) {
        if (isAbortError(error)) return undefined
        if (requestId !== latestRequestId.current) return undefined
        setState({
          status: 'error',
          message: error instanceof Error ? error.message : 'Failed to load agricultural data',
        })
        return undefined
      }
    },
    [],
  )

  // Bumps the request id first so a still-in-flight request (e.g. a slow fallback search)
  // can never land after a reset and resurrect stale results, and aborts it outright.
  const reset = useCallback(() => {
    latestRequestId.current += 1
    activeController.current?.abort()
    activeController.current = null
    setState({ status: 'idle' })
  }, [])

  return { state, fetchFields, reset }
}
