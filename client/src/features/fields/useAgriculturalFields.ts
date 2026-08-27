import { useCallback, useState } from 'react'
import { getAgriculturalFields } from '../../lib/api'
import type { FieldsResponse } from '../../types/agricultural'

type FieldsState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'success'; data: FieldsResponse }

export function useAgriculturalFields() {
  const [state, setState] = useState<FieldsState>({ status: 'idle' })

  const fetchFields = useCallback(async (lat: number, lng: number) => {
    setState({ status: 'loading' })
    try {
      const data = await getAgriculturalFields(lat, lng)
      setState({ status: 'success', data })
    } catch (error) {
      setState({
        status: 'error',
        message: error instanceof Error ? error.message : 'Failed to load agricultural data',
      })
    }
  }, [])

  return { state, fetchFields }
}
