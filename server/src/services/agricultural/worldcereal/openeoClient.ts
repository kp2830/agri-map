/**
 * Real ESA WorldCereal CROPTYPE24 openEO/CDSE client — pure REST (no Python dependency).
 *
 * The process graph below was captured ONCE, client-side, from the real `worldcereal==2.8.0`
 * Python SDK (`worldcereal.job.create_inference_process_graph`) via `cube.flat_graph()` — see
 * training/esa/experiments/dump_process_graph.py. Capturing it cost zero credits (building a
 * process graph is a local operation; only *running* one costs credits). Submitting this exact
 * graph via plain REST was verified for real (job created via POST /jobs, confirmed 201, then
 * deleted without ever starting it — also zero cost) — see training/esa/experiments/ for the
 * verification script and training/esa/worldcereal_agrimap_100_field_evaluation.md §5 for the
 * writeup. This file re-implements only the REST calls (auth, submit, poll, download); it does
 * NOT reimplement WorldCereal's own model or feature engineering.
 *
 * Auth quirk (real, confirmed, not documented anywhere obvious): CDSE's OAuth token endpoint is
 * shared with the Sentinel Hub Statistical API (see ../../google/cdseClient.ts), but a
 * plain `Authorization: Bearer <token>` that works for Statistical API calls is REJECTED by
 * openEO ("TokenInvalid"). openEO requires (a) requesting `scope=openid` explicitly in the
 * token request, and (b) prefixing the bearer value with `oidc/CDSE/` — i.e.
 * `Authorization: Bearer oidc/CDSE/<access_token>`. Both were found by testing against the real
 * API, not from documentation.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const TOKEN_URL = 'https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token'
const OPENEO_BASE = 'https://openeo.dataspace.copernicus.eu/openeo/1.2'

export class WorldCerealAuthRequiredError extends Error {
  constructor() {
    super('CDSE_CLIENT_ID/CDSE_CLIENT_SECRET are not set — same credentials as the Sentinel Hub Statistical API client (server/.env.example).')
    this.name = 'WorldCerealAuthRequiredError'
  }
}

export class WorldCerealApiError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'WorldCerealApiError'
    this.status = status
  }
}

interface ProcessGraphTemplate {
  process_graph: Record<string, { process_id: string; arguments: Record<string, unknown>; result?: boolean }>
  job_options: Record<string, unknown>
  example_temporal_extent: [string, string]
}

let cachedTemplate: ProcessGraphTemplate | null = null
function loadTemplate(): ProcessGraphTemplate {
  if (!cachedTemplate) {
    cachedTemplate = JSON.parse(readFileSync(join(__dirname, 'processGraphTemplate.json'), 'utf-8')) as ProcessGraphTemplate
  }
  return cachedTemplate
}

let cachedToken: { accessToken: string; expiresAtMs: number } | null = null

async function getAccessToken(signal?: AbortSignal): Promise<string> {
  const clientId = process.env.CDSE_CLIENT_ID
  const clientSecret = process.env.CDSE_CLIENT_SECRET
  if (!clientId || !clientSecret) throw new WorldCerealAuthRequiredError()

  if (cachedToken && cachedToken.expiresAtMs > Date.now() + 30_000) {
    return cachedToken.accessToken
  }

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret, scope: 'openid' }),
    signal,
  })
  if (!response.ok) throw new WorldCerealApiError(`CDSE token exchange failed with status ${response.status}`, response.status)
  const body = (await response.json()) as { access_token: string; expires_in: number }
  cachedToken = { accessToken: body.access_token, expiresAtMs: Date.now() + body.expires_in * 1000 }
  return cachedToken.accessToken
}

async function authHeader(signal?: AbortSignal): Promise<Record<string, string>> {
  const token = await getAccessToken(signal)
  return { Authorization: `Bearer oidc/CDSE/${token}` }
}

/** Builds a real, submittable process graph for one field by cloning the captured template and
 *  overwriting its bounding box and season window. Deep-clones so concurrent submissions never
 *  share mutable state. */
function buildProcessGraphFor(
  bbox: { west: number; south: number; east: number; north: number },
  season: { start: string; end: string },
): Record<string, unknown> {
  const template = loadTemplate()
  const graph = structuredClone(template.process_graph) as ProcessGraphTemplate['process_graph']
  const [origStart, origEnd] = template.example_temporal_extent

  for (const node of Object.values(graph)) {
    if (node.process_id === 'filter_bbox' && node.arguments.extent) {
      node.arguments.extent = { west: bbox.west, south: bbox.south, east: bbox.east, north: bbox.north, crs: 'EPSG:4326' }
    }
    const temporal = node.arguments.temporal_extent
    if (Array.isArray(temporal) && temporal.length === 2 && temporal[0] === origStart && temporal[1] === origEnd) {
      node.arguments.temporal_extent = [season.start, season.end]
    }
  }
  return graph
}

export interface SubmitJobParams {
  lat: number
  lng: number
  bufferDegrees: number
  season: { start: string; end: string }
  title: string
  signal?: AbortSignal
}

/** Submits a real WorldCereal CROPTYPE job (this call incurs real openEO/CDSE processing
 *  credits once the backend runs it — job creation itself is free, but this function also
 *  starts it, matching "submit" semantics for the caller). Returns the real job ID. */
export async function submitWorldCerealJob(params: SubmitJobParams): Promise<string> {
  const template = loadTemplate()
  const bbox = {
    west: params.lng - params.bufferDegrees,
    east: params.lng + params.bufferDegrees,
    south: params.lat - params.bufferDegrees,
    north: params.lat + params.bufferDegrees,
  }
  const graph = buildProcessGraphFor(bbox, params.season)

  const headers = { ...(await authHeader(params.signal)), 'Content-Type': 'application/json' }
  const createResp = await fetch(`${OPENEO_BASE}/jobs`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ title: params.title, process: { process_graph: graph }, job_options: template.job_options }),
    signal: params.signal,
  })
  if (createResp.status !== 201) {
    throw new WorldCerealApiError(`WorldCereal job creation failed with status ${createResp.status}: ${(await createResp.text()).slice(0, 500)}`, createResp.status)
  }
  const jobId = createResp.headers.get('OpenEO-Identifier')
  if (!jobId) throw new WorldCerealApiError('WorldCereal job creation did not return an OpenEO-Identifier header', 500)

  const startResp = await fetch(`${OPENEO_BASE}/jobs/${jobId}/results`, { method: 'POST', headers, signal: params.signal })
  if (startResp.status !== 202) {
    throw new WorldCerealApiError(`WorldCereal job start failed with status ${startResp.status}: ${(await startResp.text()).slice(0, 500)}`, startResp.status)
  }
  return jobId
}

export interface JobDescription {
  status: 'created' | 'queued' | 'running' | 'finished' | 'error'
  costs: number | null
  durationSeconds: number | null
  errorMessage: string | null
}

export async function describeWorldCerealJob(jobId: string, signal?: AbortSignal): Promise<JobDescription> {
  const headers = await authHeader(signal)
  const resp = await fetch(`${OPENEO_BASE}/jobs/${jobId}`, { headers, signal })
  if (!resp.ok) throw new WorldCerealApiError(`Failed to describe job ${jobId}: status ${resp.status}`, resp.status)
  const body = (await resp.json()) as { status: JobDescription['status']; costs?: number; usage?: { duration?: { value: number } } }
  return {
    status: body.status,
    costs: body.costs ?? null,
    durationSeconds: body.usage?.duration?.value ?? null,
    errorMessage: body.status === 'error' ? 'WorldCereal job failed on the CDSE backend (see CDSE job logs for the real cause).' : null,
  }
}

/** Downloads the real result GeoTIFF for a finished job to `destPath`. Throws if the job has no
 *  finished GTiff asset yet — callers must confirm status === 'finished' first. */
export async function downloadWorldCerealResult(jobId: string, destPath: string, signal?: AbortSignal): Promise<void> {
  const headers = await authHeader(signal)
  const resultsResp = await fetch(`${OPENEO_BASE}/jobs/${jobId}/results`, { headers, signal })
  if (!resultsResp.ok) throw new WorldCerealApiError(`Failed to fetch results for job ${jobId}: status ${resultsResp.status}`, resultsResp.status)
  const results = (await resultsResp.json()) as { assets: Record<string, { href: string }> }
  // The asset's dict key is the real filename (e.g. "croptype_....tif"); its `href` is a signed
  // S3 URL with a query string appended, so it does NOT itself end in ".tif" — match on the key.
  const assetEntry = Object.entries(results.assets ?? {}).find(([filename]) => filename.endsWith('.tif'))
  if (!assetEntry) throw new WorldCerealApiError(`Job ${jobId} has no .tif asset in its results`, 500)
  const asset = assetEntry[1]

  const assetResp = await fetch(asset.href, { signal })
  if (!assetResp.ok) throw new WorldCerealApiError(`Failed to download result asset for job ${jobId}: status ${assetResp.status}`, assetResp.status)
  const { writeFile } = await import('node:fs/promises')
  await writeFile(destPath, Buffer.from(await assetResp.arrayBuffer()))
}
