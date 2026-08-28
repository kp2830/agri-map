import type { FieldsResponse } from '../types/agricultural'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL

export async function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, { signal })

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error ?? `Request to ${path} failed with status ${response.status}`)
  }

  return response.json() as Promise<T>
}

export async function getAgriculturalFields(
  lat: number,
  lng: number,
  gridKm: number,
  maxSearchKm: number,
  signal?: AbortSignal,
): Promise<FieldsResponse> {
  return apiGet<FieldsResponse>(
    `/agriculture/fields?lat=${lat}&lng=${lng}&gridKm=${gridKm}&maxSearchKm=${maxSearchKm}`,
    signal,
  )
}
