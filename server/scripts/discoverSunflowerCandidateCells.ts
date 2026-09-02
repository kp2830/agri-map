import 'dotenv/config'
import { writeFileSync } from 'node:fs'
import { cellTokenToCellId, cellTokenToLatLng, getCoveringCellTokens } from '../src/lib/s2/index.js'
import { fetchLandscape } from '../src/services/agricultural/alu/index.js'
import { fetchMonitoring } from '../src/services/agricultural/amed/index.js'
import { joinLandscapeWithMonitoring } from '../src/services/agricultural/normalize.js'
import type { NormalizedFieldFeature } from '../src/types/agricultural.js'

/**
 * STEP 1 of the Kurukshetra-Karnal sunflower candidate discovery pass: enumerate real ALU/AMED
 * field polygons across a STRATIFIED, spatially-distributed sample of ~50 of the 982 real S2
 * Level-13 cells covering the ROI -- not the first 50, not a random 50, an evenly-spaced grid
 * sample so the result actually reflects coverage across the whole corridor. Real Google ALU+AMED
 * API calls (~50-60 total: one fetchLandscape + one fetchMonitoring per sampled cell). Does NOT
 * touch Sentinel-2/CDSE -- that's a separate, later step, gated on this pass looking healthy.
 *
 * Run: npx tsx scripts/discoverSunflowerCandidateCells.ts
 */

const ROI = { west: 76.75, south: 29.85, east: 77.05, north: 30.25 }
const ROI_POLYGON = {
  type: 'Polygon' as const,
  coordinates: [[
    [ROI.west, ROI.south], [ROI.east, ROI.south], [ROI.east, ROI.north], [ROI.west, ROI.north], [ROI.west, ROI.south],
  ]],
}
const TARGET_SAMPLE_SIZE = 50
const GRID_DIM = 7 // 7x7 = 49, close to the requested ~50

async function main() {
  const allTokens = getCoveringCellTokens(ROI_POLYGON, { minLevel: 13, maxLevel: 13, maxCells: 2000 })
  console.log(`Full ROI coverage: ${allTokens.length} real S2 Level-13 cells.`)

  const tokenCenters = allTokens.map((token) => ({ token, ...cellTokenToLatLng(token) }))

  // Stratified spatial sample: an evenly-spaced GRID_DIM x GRID_DIM grid of target points
  // across the ROI bbox; for each target point, pick the nearest real S2-13 cell (deduped).
  const sampled = new Map<string, { token: string; lat: number; lng: number }>()
  for (let row = 0; row < GRID_DIM; row++) {
    for (let col = 0; col < GRID_DIM; col++) {
      const targetLat = ROI.south + ((row + 0.5) / GRID_DIM) * (ROI.north - ROI.south)
      const targetLng = ROI.west + ((col + 0.5) / GRID_DIM) * (ROI.east - ROI.west)
      let best = tokenCenters[0]
      let bestDist = Infinity
      for (const c of tokenCenters) {
        const d = (c.lat - targetLat) ** 2 + (c.lng - targetLng) ** 2
        if (d < bestDist) { bestDist = d; best = c }
      }
      sampled.set(best.token, best)
    }
  }
  const sampleList = [...sampled.values()]
  console.log(`Stratified sample: ${sampleList.length} cells (target ${TARGET_SAMPLE_SIZE}, grid ${GRID_DIM}x${GRID_DIM}).`)

  const cellResults: {
    token: string; s2CellId: string; lat: number; lng: number
    status: 'ok' | 'error'; errorMessage: string | null
    fieldCount: number
  }[] = []
  const fieldsByCellToken = new Map<string, NormalizedFieldFeature[]>()
  const allFieldsRaw: (NormalizedFieldFeature & { sourceCellToken: string })[] = []

  let i = 0
  for (const { token, lat, lng } of sampleList) {
    i++
    const s2CellId = cellTokenToCellId(token)
    try {
      const [landscape, monitoring] = await Promise.all([fetchLandscape(s2CellId), fetchMonitoring(s2CellId)])
      const collection = joinLandscapeWithMonitoring(landscape, monitoring)
      const fields = collection.features.filter((f) => f.properties.aluType === 'field')
      fieldsByCellToken.set(token, fields)
      for (const f of fields) allFieldsRaw.push({ ...f, sourceCellToken: token })
      cellResults.push({ token, s2CellId, lat, lng, status: 'ok', errorMessage: null, fieldCount: fields.length })
      console.log(`[${i}/${sampleList.length}] cell=${token} (${lat.toFixed(4)},${lng.toFixed(4)}) -> ${fields.length} real fields`)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      cellResults.push({ token, s2CellId, lat, lng, status: 'error', errorMessage: msg, fieldCount: 0 })
      console.log(`[${i}/${sampleList.length}] cell=${token} (${lat.toFixed(4)},${lng.toFixed(4)}) -> ERROR: ${msg}`)
    }
  }

  // Deduplicate fields by real field_id (a field can appear in more than one S2 cell's
  // landscape response if it straddles a cell boundary).
  const uniqueFieldsById = new Map<string, NormalizedFieldFeature & { sourceCellTokens: string[] }>()
  for (const f of allFieldsRaw) {
    const existing = uniqueFieldsById.get(f.id as string)
    if (existing) {
      if (!existing.sourceCellTokens.includes(f.sourceCellToken)) existing.sourceCellTokens.push(f.sourceCellToken)
    } else {
      const { sourceCellToken, ...rest } = f
      uniqueFieldsById.set(f.id as string, { ...rest, sourceCellTokens: [sourceCellToken] })
    }
  }

  const successfulCells = cellResults.filter((c) => c.status === 'ok')
  const totalRawFields = allFieldsRaw.length
  const uniqueFields = [...uniqueFieldsById.values()]

  const output = {
    roi: ROI,
    fullRoiCellCount: allTokens.length,
    sampledCellCount: sampleList.length,
    cellResults,
    uniqueFieldCount: uniqueFields.length,
    totalRawFieldCount: totalRawFields,
    fields: uniqueFields,
  }
  writeFileSync('../training/sunflower/kurukshetra_karnal_alu_discovery_pass1.json', JSON.stringify(output, null, 2))

  console.log('\n=== SUMMARY ===')
  console.log(`ALU cells queried: ${sampleList.length}`)
  console.log(`Successful cells: ${successfulCells.length}`)
  console.log(`Failed cells: ${sampleList.length - successfulCells.length}`)
  console.log(`Total raw fields returned: ${totalRawFields}`)
  console.log(`Unique fields after dedup: ${uniqueFields.length}`)
  console.log(`Fields/cell: min=${Math.min(...cellResults.map((c) => c.fieldCount))} max=${Math.max(...cellResults.map((c) => c.fieldCount))} mean=${(totalRawFields / sampleList.length).toFixed(2)}`)
  console.log(`Extrapolated full-ROI (982 cells) unique-field estimate: ~${Math.round((uniqueFields.length / sampleList.length) * allTokens.length)}`)
  console.log('\nSaved raw discovery output to training/sunflower/kurukshetra_karnal_alu_discovery_pass1.json')
}

main().catch((e) => { console.error(e); process.exit(1) })
