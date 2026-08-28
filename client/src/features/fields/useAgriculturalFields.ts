import { useCallback, useRef, useState } from 'react'
import { getAgriculturalFields } from '../../lib/api'
import type { FieldsResponse } from '../../types/agricultural'

type FieldsState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'success'; data: FieldsResponse }

export function useAgriculturalFields() {
  const [state, setState] = useState<FieldsState>({ status: 'idle' })
  // Tracks the most recently started request so a slower, older request's response
  // can never overwrite the result of a newer one that was started after it.
  const latestRequestId = useRef(0)

  // Returns the resolved response so callers can react to it directly (e.g. updating
  // coordinate inputs on fallback), without needing a separate effect that watches state.
  // Returns undefined if this request was superseded by a newer one, or if it failed.
  const fetchFields = useCallback(async (lat: number, lng: number): Promise<FieldsResponse | undefined> => {
    const requestId = ++latestRequestId.current
    setState({ status: 'loading' })
    try {
      const data = await getAgriculturalFields(lat, lng)
      if (requestId !== latestRequestId.current) return undefined
      setState({ status: 'success', data })
      return data
    } catch (error) {
      if (requestId !== latestRequestId.current) return undefined
      setState({
        status: 'error',
        message: error instanceof Error ? error.message : 'Failed to load agricultural data',
      })
      return undefined
    }
  }, [])

  // Bumps the request id first so a still-in-flight request (e.g. a slow fallback search)
  // can never land after a reset and resurrect stale results.
  const reset = useCallback(() => {
    latestRequestId.current += 1
    setState({ status: 'idle' })
  }, [])

  return { state, fetchFields, reset }
}
