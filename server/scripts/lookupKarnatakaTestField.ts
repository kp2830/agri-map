/**
 * Part 5 of the live-detector verification: determine whether the real Plus Code location
 * QJQJ+CW (Bheemanabeedu/Suryakhami, Gundlupet taluk, Chamarajanagar, Karnataka 571111) —
 * decoded via the real, public Open Location Code algorithm relative to Gundlupet's real
 * geocoded center (11.808496, 76.6916141), giving full code 7J3RQJQJ+CW, center
 * lat=11.7885625, lng=76.6323125 — corresponds to any real field already in the ALU/AMED
 * inventory. Calls the REAL production searchAgriculturalArea() (the same function
 * /agriculture/fields uses), not a duplicate lookup path. Uses the real, already-configured
 * AGRICULTURAL_UNDERSTANDING_API_KEY (unrelated to CDSE quota).
 *
 * Run: cd server && npx tsx scripts/lookupKarnatakaTestField.ts
 */
import 'dotenv/config'
import { searchAgriculturalArea } from '../src/services/agricultural/areaSearch.js'

const LAT = 11.7885625
const LNG = 76.6323125

console.log(`Searching real ALU/AMED coverage near ${LAT}, ${LNG} (Plus Code 7J3RQJQJ+CW area)...\n`)

const { fieldCollection, coverage } = await searchAgriculturalArea(LAT, LNG, 3, 30)

console.log('coverage:', JSON.stringify(coverage, null, 2))
console.log(`\nreal fields returned: ${fieldCollection.features.length}`)
for (const feature of fieldCollection.features.slice(0, 20)) {
  const props = feature.properties
  const primaryCrop = props.monitoring?.[0]?.predictions[0]?.crop ?? null
  console.log(`  id=${String(feature.id)} aluType=${props.aluType} primaryCrop=${primaryCrop} classConfidence=${props.classConfidence.toFixed(2)}`)
}
