import { useCallback, useEffect, useRef, useState } from 'react'
import { getCropObservations } from '../../lib/api'
import type { CropObservation } from '../../types/agricultural'

export type ObservationsState =
  | { status: 'idle' | 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; observations: CropObservation[]; fetchedAt: string }

const PLACE_RETRY_MS = 4000
const PLACE_RETRY_LIMIT = 6
/** How often the list re-reads production while Compare is open, so newly logged observations appear on their own. */
const LIVE_REFRESH_MS = 30 * 1000

/**
 * Loads the team's crop observations while Compare is open. The server looks up place names in
 * the background (rate-limited), so when some are still missing it re-reads a few times until
 * the state/city fill in.
 */
export function useCropObservations(enabled: boolean) {
  const [state, setState] = useState<ObservationsState>({ status: 'idle' })
  const retries = useRef(0)

  const load = useCallback(async (silent: boolean, signal?: AbortSignal) => {
    if (!silent) setState({ status: 'loading' })
    try {
      const data = await getCropObservations(signal)
      setState({ status: 'ready', observations: data.observations, fetchedAt: data.fetchedAt })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      if (!silent) setState({ status: 'error', message: error instanceof Error ? error.message : 'Failed to load observations' })
    }
  }, [])

  useEffect(() => {
    if (!enabled) return
    retries.current = 0
    const controller = new AbortController()
    void load(false, controller.signal)
    return () => controller.abort()
  }, [enabled, load])

  // Live refresh: pick up observations logged in production while Compare stays open, and catch up
  // right away when the tab becomes visible again. Silent, so the list and selection never flicker.
  useEffect(() => {
    if (!enabled) return
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load(true)
    }, LIVE_REFRESH_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load(true)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [enabled, load])

  const missingPlaces = state.status === 'ready' && state.observations.some((o) => o.place === null)
  useEffect(() => {
    if (!enabled || !missingPlaces || retries.current >= PLACE_RETRY_LIMIT) return
    const timer = setTimeout(() => {
      retries.current += 1
      void load(true)
    }, PLACE_RETRY_MS)
    return () => clearTimeout(timer)
  }, [enabled, missingPlaces, state, load])

  return { state, reload: () => load(false) }
}
