/**
 * Finds real, actual AMED fields (from the same real search area used for the Karnataka test
 * field) in each of the three eligibility categories, using the REAL buildAmedHypotheses() and
 * the REAL amedStrongConfidenceThreshold (0.8) — not fabricated examples.
 *
 * Run: cd server && npx tsx scripts/findEligibilityExamples.ts
 */
import 'dotenv/config'
import { writeFileSync } from 'node:fs'
import { searchAgriculturalArea } from '../src/services/agricultural/areaSearch.js'
import { buildAmedHypotheses } from '../src/services/agricultural/sunflower/amedHypotheses.js'

const AMED_STRONG_CONFIDENCE_THRESHOLD = 0.8

const { fieldCollection } = await searchAgriculturalArea(11.7885625, 76.6323125, 3, 30)

let unknownExample: unknown = null
let lowConfidenceExample: unknown = null
let highConfidenceExample: unknown = null

for (const feature of fieldCollection.features) {
  if (feature.properties.aluType !== 'field') continue
  const hyp = buildAmedHypotheses(feature.properties)

  if (!hyp.amedTop && !unknownExample) {
    unknownExample = { id: feature.id, properties: feature.properties, hyp }
  } else if (hyp.amedTop && !(hyp.amedIsCurrentlyObserved && hyp.amedTop.confidence >= AMED_STRONG_CONFIDENCE_THRESHOLD) && !lowConfidenceExample) {
    lowConfidenceExample = { id: feature.id, properties: feature.properties, hyp }
  } else if (hyp.amedTop && hyp.amedIsCurrentlyObserved && hyp.amedTop.confidence >= AMED_STRONG_CONFIDENCE_THRESHOLD && !highConfidenceExample) {
    highConfidenceExample = { id: feature.id, properties: feature.properties, hyp }
  }

  if (unknownExample && lowConfidenceExample && highConfidenceExample) break
}

console.log('UNKNOWN example:', JSON.stringify(unknownExample, null, 2))
console.log('\nLOW-CONFIDENCE example:', JSON.stringify(lowConfidenceExample, null, 2))
console.log('\nHIGH-CONFIDENCE example:', JSON.stringify(highConfidenceExample, null, 2))

writeFileSync('scripts/eligibilityExamples.json', JSON.stringify({ unknownExample, lowConfidenceExample, highConfidenceExample }, null, 2))
console.log(`\nfound: unknown=${Boolean(unknownExample)} low=${Boolean(lowConfidenceExample)} high=${Boolean(highConfidenceExample)}`)
console.log(`total real fields scanned: ${fieldCollection.features.length}`)
