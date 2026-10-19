import 'dotenv/config'
import { latLngToCellId } from '../src/lib/s2/index.js'
import { fetchLandscape } from '../src/services/agricultural/alu/index.js'
import { fetchMonitoring } from '../src/services/agricultural/amed/index.js'
import { joinLandscapeWithMonitoring } from '../src/services/agricultural/normalize.js'
// Usage: npx tsx scripts/amedAtPoint.ts <lat> <lng> [radiusDeg]  -> prints ALU fields near the point with AMED per-season top-3 crops
const [lat, lng, rad = '0.0012'] = process.argv.slice(2)
async function main() {
  const id = latLngToCellId(+lat, +lng, 13)
  const fc = joinLandscapeWithMonitoring(await fetchLandscape(id), await fetchMonitoring(id))
  const near = fc.features.filter((f) => {
    if (f.properties.aluType !== 'field') return false
    const ring: number[][] = (f.geometry.type === 'Polygon' ? f.geometry.coordinates[0] : f.geometry.coordinates[0][0]) as number[][]
    const cx = ring.reduce((a, p) => a + p[0], 0) / ring.length, cy = ring.reduce((a, p) => a + p[1], 0) / ring.length
    return Math.abs(cx - +lng) < +rad && Math.abs(cy - +lat) < +rad
  })
  console.log(`cell fields=${fc.features.filter((f) => f.properties.aluType === 'field').length}, near point=${near.length}`)
  for (const f of near) {
    console.log(`FIELD ${f.id} area=${(f.properties.areaSqM / 1e4).toFixed(2)}ha`)
    for (const m of f.properties.monitoring ?? []) {
      const p = [...(m.predictions ?? [])].sort((a, b) => b.confidence - a.confidence).slice(0, 3).map((x) => `${x.crop}:${x.confidence.toFixed(2)}`).join(' ')
      console.log(`   ${new Date(m.startTimestampSec * 1000).toISOString().slice(0, 10)}..${new Date(m.endTimestampSec * 1000).toISOString().slice(0, 10)}  ${p || '(none)'}`)
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
