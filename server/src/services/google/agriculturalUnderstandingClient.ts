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

/** Calls a v1 method on the Agricultural Understanding API. Never logs the API key or request URL. */
export async function callAgriculturalUnderstanding<TResponse>(
  method: 'lookupLandscape' | 'monitorLandscape',
  body: unknown,
): Promise<TResponse> {
  const apiKey = getApiKey()

  const response = await fetch(`${BASE_URL}:${method}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => null)) as { error?: { message?: string } } | null
    const message =
      errorBody?.error?.message ?? `Agricultural Understanding API request failed with status ${response.status}`
    throw new AgriculturalUnderstandingApiError(message, response.status)
  }

  return response.json() as Promise<TResponse>
}
