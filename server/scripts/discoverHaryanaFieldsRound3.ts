import 'dotenv/config'
import { readFileSync, writeFileSync } from 'node:fs'
import { cellTokenToCellId, cellTokenToLatLng, getCoveringCellTokens } from '../src/lib/s2/index.js'
import { fetchLandscape } from '../src/services/agricultural/alu/index.js'
import { fetchMonitoring } from '../src/services/agricultural/amed/index.js'
import { joinLandscapeWithMonitoring } from '../src/services/agricultural/normalize.js'
import type { NormalizedFieldFeature } from '../src/types/agricultural.js'

/**
 * Round 3 of Haryana sunflower field discovery -- SAME methodology as rounds 1 (49 cells) and 2
 * (8 cells): stratified spatial sampling of never-before-queried S2 Level-13 cells in the
 * Kurukshetra-Karnal ROI, via the existing real ALU+AMED infrastructure. Excludes ALL 57 cells
 * sampled in rounds 1+2 (not just round 1), guaranteeing no overlap with either prior batch.
 *
 * Run: npx tsx scripts/discoverHaryanaFieldsRound3.ts
 */

const ROI = { west: 76.75, south: 29.85, east: 77.05, north: 30.25 }
const ROI_POLYGON = {
  type: 'Polygon' as const,
  coordinates: [[
    [ROI.west, ROI.south], [ROI.east, ROI.south], [ROI.east, ROI.north], [ROI.west, ROI.north], [ROI.west, ROI.south],
  ]],
}
const N_NEW_CELLS = 25

async function main() {
  const prevCells = new Set<string>(JSON.parse(readFileSync('/tmp/all_prev_cells.json', 'utf-8')))
  const prevFieldIds = new Set<string>(JSON.parse(readFileSync('/tmp/all_prev_field_ids.json', 'utf-8')))

  const allTokens = getCoveringCellTokens(ROI_POLYGON, { minLevel: 13, maxLevel: 13, maxCells: 2000 })
  const unseenTokens = allTokens.filter((t) => !prevCells.has(t))
  console.log(`Full ROI: ${allTokens.length} cells. Previously sampled (rounds 1+2): ${prevCells.size}. Never-sampled: ${unseenTokens.length}`)

  const dim = Math.ceil(Math.sqrt(N_NEW_CELLS))
  const tokenCenters = unseenTokens.map((token) => ({ token, ...cellTokenToLatLng(token) }))
  const picked = new Map<string, { token: string; lat: number; lng: number }>()
  for (let row = 0; row < dim && picked.size < N_NEW_CELLS; row++) {
    for (let col = 0; col < dim && picked.size < N_NEW_CELLS; col++) {
      const targetLat = ROI.south + ((row + 0.5) / dim) * (ROI.north - ROI.south)
      const targetLng = ROI.west + ((col + 0.5) / dim) * (ROI.east - ROI.west)
      let best = tokenCenters[0]
      let bestDist = Infinity
      for (const c of tokenCenters) {
        if (picked.has(c.token)) continue
        const d = (c.lat - targetLat) ** 2 + (c.lng - targetLng) ** 2
        if (d < bestDist) { bestDist = d; best = c }
      }
      picked.set(best.token, best)
    }
  }
  const sample = [...picked.values()]
  console.log(`Selected ${sample.length} NEW cells for round 3 (stratified, never queried in rounds 1 or 2).`)

  const newFields: (NormalizedFieldFeature & { sourceCellToken: string })[] = []
  let i = 0
  for (const { token, lat, lng } of sample) {
    i++
    const s2CellId = cellTokenToCellId(token)
    try {
      const [landscape, monitoring] = await Promise.all([fetchLandscape(s2CellId), fetchMonitoring(s2CellId)])
      const collection = joinLandscapeWithMonitoring(landscape, monitoring)
      const fields = collection.features.filter((f) => f.properties.aluType === 'field')
      console.log(`[${i}/${sample.length}] cell=${token} (${lat.toFixed(4)},${lng.toFixed(4)}) -> ${fields.length} real fields`)
      for (const f of fields) newFields.push({ ...f, sourceCellToken: token })
    } catch (error) {
      console.log(`[${i}/${sample.length}] cell=${token} -> ERROR: ${error instanceof Error ? error.message : error}`)
    }
  }

  const overlapping = newFields.filter((f) => prevFieldIds.has(String(f.id)))
  const genuinelyNew = newFields.filter((f) => !prevFieldIds.has(String(f.id)))

  console.log(`\nTotal raw fields from new cells: ${newFields.length}`)
  console.log(`Overlapping with rounds 1+2 (should be 0): ${overlapping.length}`)
  console.log(`Genuinely new unique candidate fields: ${new Set(genuinelyNew.map((f) => f.id)).size}`)

  writeFileSync('../training/sunflower/haryana_round3_fields_pool.json', JSON.stringify({
    sampledCells: sample, fields: genuinelyNew,
  }, null, 2))
  console.log('Saved training/sunflower/haryana_round3_fields_pool.json')
}

main().catch((e) => { console.error(e); process.exit(1) })
