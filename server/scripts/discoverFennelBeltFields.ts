import 'dotenv/config'
import { writeFileSync } from 'node:fs'
import { cellTokenToCellId, cellTokenToLatLng, getCoveringCellTokens } from '../src/lib/s2/index.js'
import { fetchLandscape } from '../src/services/agricultural/alu/index.js'
import { fetchMonitoring } from '../src/services/agricultural/amed/index.js'
import { joinLandscapeWithMonitoring } from '../src/services/agricultural/normalize.js'

// Usage: npx tsx scripts/discoverFennelBeltFields.ts <name> <west> <south> <east> <north> <nCells>
// Samples S2 level-13 cells evenly across the ROI and stores every ALU field with AMED's per-season top crop.
const [name, w, s, e, n, nc] = process.argv.slice(2)
const ROI = { west: +w, south: +s, east: +e, north: +n }
const N_CELLS = +nc
const polygon = {
  type: 'Polygon' as const,
  coordinates: [[[ROI.west, ROI.south], [ROI.east, ROI.south], [ROI.east, ROI.north], [ROI.west, ROI.north], [ROI.west, ROI.south]]],
}

async function main() {
  const tokens = getCoveringCellTokens(polygon, { minLevel: 13, maxLevel: 13, maxCells: 4000 })
  console.log(`${name}: ${tokens.length} level-13 cells in ROI, sampling ${N_CELLS}`)
  const dim = Math.ceil(Math.sqrt(N_CELLS))
  const centers = tokens.map((token) => ({ token, ...cellTokenToLatLng(token) }))
  const picked = new Map<string, (typeof centers)[number]>()
  for (let r = 0; r < dim && picked.size < N_CELLS; r++) {
    for (let c = 0; c < dim && picked.size < N_CELLS; c++) {
      const tl = ROI.south + ((r + 0.5) / dim) * (ROI.north - ROI.south)
      const tg = ROI.west + ((c + 0.5) / dim) * (ROI.east - ROI.west)
      let best = centers[0]
      let bd = Infinity
      for (const k of centers) {
        if (picked.has(k.token)) continue
        const d = (k.lat - tl) ** 2 + (k.lng - tg) ** 2
        if (d < bd) { bd = d; best = k }
      }
      picked.set(best.token, best)
    }
  }
  const fields: unknown[] = []
  let i = 0
  for (const { token, lat, lng } of picked.values()) {
    i++
    try {
      const id = cellTokenToCellId(token)
      const [landscape, monitoring] = await Promise.all([fetchLandscape(id), fetchMonitoring(id)])
      const fc = joinLandscapeWithMonitoring(landscape, monitoring)
      const cellFields = fc.features.filter((f) => f.properties.aluType === 'field')
      for (const f of cellFields) {
        const seasons = (f.properties.monitoring ?? []).map((m) => {
          const top = [...(m.predictions ?? [])].sort((a, b) => b.confidence - a.confidence)[0]
          return { start: m.startTimestampSec, end: m.endTimestampSec, crop: top?.crop ?? null, conf: top?.confidence ?? null }
        })
        fields.push({ id: f.id, geometry: f.geometry, areaSqM: f.properties.areaSqM, cell: token, seasons })
      }
      console.log(`[${i}/${picked.size}] ${token} (${lat.toFixed(3)},${lng.toFixed(3)}) fields=${cellFields.length}`)
    } catch (err) {
      console.log(`[${i}/${picked.size}] ${token} ERROR ${err instanceof Error ? err.message : err}`)
    }
  }
  writeFileSync(`../training/fennel/${name}_pool.json`, JSON.stringify({ name, roi: ROI, fields }))
  console.log(`DONE ${name}: ${fields.length} fields`)
}
main().catch((err) => { console.error(err); process.exit(1) })
