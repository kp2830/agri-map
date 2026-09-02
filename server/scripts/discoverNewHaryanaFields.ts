import 'dotenv/config'
import { readFileSync, writeFileSync } from 'node:fs'
import { cellTokenToCellId, cellTokenToLatLng, getCoveringCellTokens } from '../src/lib/s2/index.js'
import { fetchLandscape } from '../src/services/agricultural/alu/index.js'
import { fetchMonitoring } from '../src/services/agricultural/amed/index.js'
import { joinLandscapeWithMonitoring } from '../src/services/agricultural/normalize.js'
import type { NormalizedFieldFeature } from '../src/types/agricultural.js'

/**
 * Finds NEW Haryana sunflower-corridor fields, guaranteed non-overlapping with the original
 * 275-field Kurukshetra-Karnal test set by construction: samples S2 Level-13 cells from the
 * 933 cells in the ROI that were NEVER queried in the original 49-cell discovery pass (not just
 * de-duped by field_id after the fact). Same real ALU+AMED infrastructure, same stratified
 * spatial-sampling approach as before -- no new field-segmentation system.
 *
 * Run: npx tsx scripts/discoverNewHaryanaFields.ts
 */

const ROI = { west: 76.75, south: 29.85, east: 77.05, north: 30.25 }
const ROI_POLYGON = {
  type: 'Polygon' as const,
  coordinates: [[
    [ROI.west, ROI.south], [ROI.east, ROI.south], [ROI.east, ROI.north], [ROI.west, ROI.north], [ROI.west, ROI.south],
  ]],
}
const N_NEW_CELLS = 8

async function main() {
  const prevCells = new Set<string>(JSON.parse(readFileSync('/tmp/prev_cells.json', 'utf-8')))
  const prevFieldIds = new Set<string>(JSON.parse(readFileSync('/tmp/prev_field_ids.json', 'utf-8')))

  const allTokens = getCoveringCellTokens(ROI_POLYGON, { minLevel: 13, maxLevel: 13, maxCells: 2000 })
  const unseenTokens = allTokens.filter((t) => !prevCells.has(t))
  console.log(`Full ROI: ${allTokens.length} cells. Previously sampled: ${prevCells.size}. Never-sampled (available for new discovery): ${unseenTokens.length}`)

  // Stratified spatial sample of N_NEW_CELLS from the unseen pool: an evenly-spaced grid over
  // the ROI, snapped to the nearest UNSEEN cell per grid point (same method as the original
  // discovery pass, restricted to the unseen pool this time).
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
  console.log(`Selected ${sample.length} NEW cells for this pass (stratified, never queried before).`)

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

  // Defensive de-dup against the original 275-field test set (should be none by construction,
  // but verify rather than assume).
  const overlapping = newFields.filter((f) => prevFieldIds.has(String(f.id)))
  const genuinelyNew = newFields.filter((f) => !prevFieldIds.has(String(f.id)))

  console.log(`\nTotal raw fields from new cells: ${newFields.length}`)
  console.log(`Overlapping with original 275-field test set (should be 0): ${overlapping.length}`)
  console.log(`Genuinely new unique candidate fields: ${new Set(genuinelyNew.map((f) => f.id)).size}`)

  writeFileSync('../training/sunflower/haryana_new_fields_pool.json', JSON.stringify({
    sampledCells: sample, fields: genuinelyNew,
  }, null, 2))
  console.log('Saved training/sunflower/haryana_new_fields_pool.json')
}

main().catch((e) => { console.error(e); process.exit(1) })
