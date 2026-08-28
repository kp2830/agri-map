const BASE_URL = 'https://agriculturalunderstanding.googleapis.com/v1'

export class AgriculturalUnderstandingApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'AgriculturalUnderstandingApiError'
    this.status = status
  }
}

function getApiKey(): string {
  const key = process.env.AGRICULTURAL_UNDERSTANDING_API_KEY
  if (!key) {
    throw new Error('AGRICULTURAL_UNDERSTANDING_API_KEY is not set')
  }
  return key
}

/**
 * Calls a v1 method on the Agricultural Understanding API. Never logs the API key or
 * request URL. `signal` lets an in-flight call be aborted (e.g. the client that
 * triggered this search has already navigated to a newer one) so we stop waiting on
 * — and Node stops holding open — a request nobody needs the result of anymore.
 */
export async function callAgriculturalUnderstanding<TResponse>(
  method: 'lookupLandscape' | 'monitorLandscape',
  body: unknown,
  signal?: AbortSignal,
): Promise<TResponse> {
  const apiKey = getApiKey()

  const response = await fetch(`${BASE_URL}:${method}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => null)) as { error?: { message?: string } } | null
    const message =
      errorBody?.error?.message ?? `Agricultural Understanding API request failed with status ${response.status}`
    throw new AgriculturalUnderstandingApiError(message, response.status)
  }

  return response.json() as Promise<TResponse>
}
