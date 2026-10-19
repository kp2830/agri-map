/**
 * Prediction-time feature extraction for Fennel RF v0. ONE production CDSE Statistical API call for the whole rabi
 * season (Oct 1 - Apr 30) returns the daily NDVI/NDRE/NDYI field means; the 26-feature vector is then computed locally
 * with logic ported 1:1 from training/fennel/fennel_features.py (scene QC -> 13 half-month window medians -> gap fill).
 * Training and inference MUST stay identical: change both together and bump FEATURE_WINDOW_VERSION.
 */
import type { MultiPolygon, Polygon } from 'geojson'
import { requestPolygonStatistics } from '../../google/cdseClient.js'
import { FENNEL_SEASON, FENNEL_WINDOWS, MAX_EMPTY_WINDOWS } from './config.js'

export interface FennelScene { d: string; ndvi: number; ndre: number; ndyi: number }

function median(values: number[]): number {
  const v = [...values].sort((a, b) => a - b)
  const mid = Math.floor(v.length / 2)
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2
}

/** Drops single-scene outliers (haze/shadow/bad cloud mask): NDVI off its 4 neighbours' median by >0.15, NDYI by >0.20, or NDYI > 0.80. */
export function despike(scenes: FennelScene[]): FennelScene[] {
  const s = [...scenes].sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0))
  const out: FennelScene[] = []
  for (let i = 0; i < s.length; i++) {
    const nb: FennelScene[] = []
    for (let j = Math.max(0, i - 2); j < Math.min(s.length, i + 3); j++) if (j !== i) nb.push(s[j])
    if (nb.length >= 3) {
      const mn = median(nb.map((y) => y.ndvi))
      const my = median(nb.map((y) => y.ndyi))
      if (Math.abs(s[i].ndvi - mn) > 0.15 || Math.abs(s[i].ndyi - my) > 0.2) continue
    }
    if (s[i].ndyi > 0.8) continue
    out.push(s[i])
  }
  return out
}

function fill(vals: (number | null)[]): number[] | null {
  const idx = vals.map((v, i) => (v === null ? -1 : i)).filter((i) => i >= 0)
  if (idx.length === 0) return null
  return vals.map((v, i) => {
    if (v !== null) return v
    const left = idx.filter((j) => j < i)
    const right = idx.filter((j) => j > i)
    if (left.length && right.length) {
      const a = left[left.length - 1]
      const b = right[0]
      return (vals[a] as number) + ((vals[b] as number) - (vals[a] as number)) * (i - a) / (b - a)
    }
    if (left.length) return vals[left[left.length - 1]] as number
    return vals[right[0]] as number
  })
}

const pad = (n: number) => String(n).padStart(2, '0')

/** Pure function (exported for the parity test): the ordered 26-vector, or null if the field is unscoreable. */
export function windowVector(scenes: FennelScene[], seasonStartYear: number): number[] | null {
  const s = despike(scenes.filter((x) => Number.isFinite(x.ndvi) && Number.isFinite(x.ndre) && Number.isFinite(x.ndyi)))
  const ndvi: (number | null)[] = []
  const ndre: (number | null)[] = []
  let empty = 0
  for (const w of FENNEL_WINDOWS) {
    const ya = w.a[0] >= 10 ? seasonStartYear : seasonStartYear + 1
    const lo = `${ya}-${pad(w.a[0])}-${pad(w.a[1])}`
    const hi = `${ya}-${pad(w.b[0])}-${pad(w.b[1])}`
    const sc = s.filter((x) => x.d >= lo && x.d <= hi)
    if (sc.length === 0) empty++
    ndvi.push(sc.length ? median(sc.map((x) => x.ndvi)) : null)
    ndre.push(sc.length ? median(sc.map((x) => x.ndre)) : null)
  }
  if (empty > MAX_EMPTY_WINDOWS) return null
  const a = fill(ndvi)
  const b = fill(ndre)
  if (!a || !b) return null
  return [...a, ...b]
}

/** Returns the ordered feature vector rfInference.ts expects, or null when the field has too few clear scenes. */
export async function extractFennelRfFeatures(geometry: Polygon | MultiPolygon, signal?: AbortSignal): Promise<number[] | null> {
  const stats = await requestPolygonStatistics(geometry, FENNEL_SEASON.start, FENNEL_SEASON.end, signal)
  const byDate = new Map<string, Partial<FennelScene>>()
  const take = (key: 'ndvi' | 'ndre' | 'ndyi') => {
    for (const o of stats.dailySeriesByIndex[key]) {
      if (o.mean === null || Number.isNaN(o.mean)) continue
      const total = o.sampleCount ?? 0
      const valid = total - o.noDataCount
      if (valid < 3 || valid < 0.5 * total) continue
      const d = o.date.slice(0, 10)
      byDate.set(d, { ...(byDate.get(d) ?? {}), d, [key]: o.mean })
    }
  }
  take('ndvi'); take('ndre'); take('ndyi')
  const scenes = [...byDate.values()].filter((x): x is FennelScene => x.ndvi !== undefined && x.ndre !== undefined && x.ndyi !== undefined)
  return windowVector(scenes, FENNEL_SEASON.startYear)
}
