import type { FieldsResponse, NormalizedFieldFeature, SunflowerLikelihoodResponse, SunflowerRfResponse } from '../types/agricultural'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL

export async function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, { signal })

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error ?? `Request to ${path} failed with status ${response.status}`)
  }

  return response.json() as Promise<T>
}

async function apiPost<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => null)) as { error?: string } | null
    throw new Error(errorBody?.error ?? `Request to ${path} failed with status ${response.status}`)
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

/** Real-time, per-field, on-demand only — never called for a whole area response. See
 *  cropDisplay.ts's isEligibleForSunflowerCheck for when the caller should invoke this. */
export async function getSunflowerLikelihood(
  feature: NormalizedFieldFeature,
  signal?: AbortSignal,
): Promise<SunflowerLikelihoodResponse> {
  return apiPost<SunflowerLikelihoodResponse>('/agriculture/sunflower-likelihood', { feature }, signal)
}

/** Sunflower RF v0 (India-native, weakly-supervised) — a separate signal from the likeness
 *  model above. Real-time, per-field, on-demand only. The server re-checks the AMED
 *  strong-confidence gate itself, so calling this for a high-confidence field is safe (just
 *  wasted round-trip) — but callers should still gate with isEligibleForSunflowerCheck first,
 *  same as the likeness check above, to avoid the unnecessary request. */
export async function getSunflowerRf(
  feature: NormalizedFieldFeature,
  signal?: AbortSignal,
): Promise<SunflowerRfResponse> {
  return apiPost<SunflowerRfResponse>('/agriculture/sunflower-rf', { feature }, signal)
}
