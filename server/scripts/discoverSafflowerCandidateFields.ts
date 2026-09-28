import 'dotenv/config'
import { writeFileSync } from 'node:fs'
import { cellTokenToCellId, cellTokenToLatLng, getCoveringCellTokens } from '../src/lib/s2/index.js'
import { fetchLandscape } from '../src/services/agricultural/alu/index.js'
import { fetchMonitoring } from '../src/services/agricultural/amed/index.js'
import { joinLandscapeWithMonitoring } from '../src/services/agricultural/normalize.js'
import { buildAmedHypotheses } from '../src/services/agricultural/sunflower/amedHypotheses.js'
import type { NormalizedFieldFeature } from '../src/types/agricultural.js'

/**
 * First real discovery pass for Safflower candidate fields — SAME methodology as the Sunflower
 * project's Kurukshetra-Karnal discovery (discoverHaryanaFieldsRound3.ts): stratified spatial
 * sampling of real S2 Level-13 cells across a real, documented growing belt, via the existing
 * real ALU+AMED infrastructure. No mock data, no invented field.
 *
 * ROI: Latur district, Maharashtra (real coordinates: Latur city 18.4088N 76.5604E, per
 * Wikipedia/district profile) — the single Maharashtra district most consistently cited as a
 * core Marathwada safflower belt (Maharashtra + Karnataka grow >90% of India's safflower; see
 * training/safflower/README.md for sourcing). A ~0.5 x 0.5 degree box centered near the city,
 * inside the real district extent (district area ~7157 sq km) — a first, deliberately small
 * pilot region, not the whole belt.
 *
 * Every field returned here also carries AMED's own real prediction for it (fetchMonitoring),
 * which is used downstream to exclude fields AMED already confidently identifies as one of its
 * 12 known crops (see config.ts's SAFFLOWER_KNOWN_CONFUSION_CROPS) — this is the real,
 * available negative-filtering signal, not a guess.
 *
 * Run: npx tsx scripts/discoverSafflowerCandidateFields.ts
 */

const ROI = { west: 76.35, south: 18.15, east: 76.85, north: 18.65 }
const ROI_POLYGON = {
  type: 'Polygon' as const,
  coordinates: [[
    [ROI.west, ROI.south], [ROI.east, ROI.south], [ROI.east, ROI.north], [ROI.west, ROI.north], [ROI.west, ROI.south],
  ]],
}
const N_CELLS = 15 // deliberately small first pilot, matching Sunflower's own initial exploratory scale

async function main() {
  const allTokens = getCoveringCellTokens(ROI_POLYGON, { minLevel: 13, maxLevel: 13, maxCells: 2000 })
  console.log(`Latur ROI: ${allTokens.length} real S2 Level-13 cells available. Sampling ${N_CELLS} (stratified, first pass).`)

  const dim = Math.ceil(Math.sqrt(N_CELLS))
  const tokenCenters = allTokens.map((token) => ({ token, ...cellTokenToLatLng(token) }))
  const picked = new Map<string, { token: string; lat: number; lng: number }>()
  for (let row = 0; row < dim && picked.size < N_CELLS; row++) {
    for (let col = 0; col < dim && picked.size < N_CELLS; col++) {
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
  console.log(`Selected ${sample.length} cells (stratified across the ROI).`)

  const fields: (NormalizedFieldFeature & { sourceCellToken: string; amedCropSeen: string | null })[] = []
  let i = 0
  let errorCount = 0
  for (const { token, lat, lng } of sample) {
    i++
    const s2CellId = cellTokenToCellId(token)
    try {
      const [landscape, monitoring] = await Promise.all([fetchLandscape(s2CellId), fetchMonitoring(s2CellId)])
      const collection = joinLandscapeWithMonitoring(landscape, monitoring)
      const cellFields = collection.features.filter((f) => f.properties.aluType === 'field')
      const cropByField = cellFields.map((f) => buildAmedHypotheses(f.properties).amedTop?.crop ?? null)
      const amedCrops = new Set(cropByField.filter((c): c is string => Boolean(c)))
      console.log(
        `[${i}/${sample.length}] cell=${token} (${lat.toFixed(4)},${lng.toFixed(4)}) -> ${cellFields.length} real fields` +
          (amedCrops.size ? ` | AMED crops seen here: ${[...amedCrops].join(', ')}` : ' | AMED: no confident crop for any field'),
      )
      cellFields.forEach((f, idx) => {
        fields.push({ ...f, sourceCellToken: token, amedCropSeen: cropByField[idx] })
      })
    } catch (error) {
      errorCount++
      console.log(`[${i}/${sample.length}] cell=${token} -> ERROR: ${error instanceof Error ? error.message : error}`)
    }
  }

  const byAmedCrop = new Map<string, number>()
  for (const f of fields) {
    const key = f.amedCropSeen ?? 'NO_CONFIDENT_AMED_CROP'
    byAmedCrop.set(key, (byAmedCrop.get(key) ?? 0) + 1)
  }

  console.log(`\nTotal real fields found: ${fields.length} across ${sample.length - errorCount}/${sample.length} successful cells.`)
  console.log('Breakdown by AMED\'s own crop call for each field (real, not inferred):')
  for (const [crop, count] of [...byAmedCrop.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${crop}: ${count}`)
  }
  console.log(
    `\nCandidate pool for Safflower scoring = fields where AMED crop is NO_CONFIDENT_AMED_CROP ` +
      `(none of its 12 known crops confidently matched) = ${byAmedCrop.get('NO_CONFIDENT_AMED_CROP') ?? 0} fields.`,
  )

  writeFileSync(
    '../training/safflower/latur_pilot_fields_pool.json',
    JSON.stringify({ roi: ROI, sampledCells: sample, fields }, null, 2),
  )
  console.log('\nWrote training/safflower/latur_pilot_fields_pool.json')
}

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
