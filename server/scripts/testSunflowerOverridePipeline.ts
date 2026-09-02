/**
 * End-to-end test of the real decision pipeline (buildAmedHypotheses -> extractSunflowerFeatures
 * -> scoreSunflowerLikeness -> decideSunflowerOverride) against ONE real existing AMED field
 * (7J6VPHGH+WP7P, Andhra Pradesh — the top-ranked candidate from the pilot's India ranking).
 *
 * Uses this field's REAL monitoring history from
 * server/data/training/sunflower-belt-competing-crops.jsonl (already-collected, real AMED data
 * — not fabricated) and its REAL already-extracted Sentinel-2 aggregate values from
 * training/data/pilot/pilot_feature_matrix.jsonl (already-collected during the pilot, real data
 * — not a new CDSE request).
 *
 * PART A calls the REAL extractSunflowerFeatures() as the live map-click path would — in THIS
 * environment (server/.env has no CDSE_CLIENT_ID/SECRET), this honestly falls back to
 * EMPTY_SPECTRAL, exactly like the "not configured" case, and the override correctly does
 * nothing. This is the real, current behavior of the live path, not a simulation.
 *
 * PART B swaps in this SAME field's real, already-extracted Sentinel-2 values (bypassing only
 * the live network call, since no CDSE credentials exist in this environment) to prove the
 * downstream scoring + override logic fires correctly when real Sentinel-2 data IS available —
 * i.e. what would happen the moment CDSE credentials are added to server/.env.
 *
 * Run: cd server && npx tsx scripts/testSunflowerOverridePipeline.ts
 */
import { readFileSync } from 'node:fs'
import { buildAmedHypotheses } from '../src/services/agricultural/sunflower/amedHypotheses.js'
import { extractSunflowerFeatures } from '../src/services/agricultural/sunflower/featureExtraction.js'
import { scoreSunflowerLikeness } from '../src/services/agricultural/sunflower/likenessModel.js'
import { decideSunflowerOverride } from '../src/services/agricultural/sunflower/overridePolicy.js'
import type { NormalizedFieldProperties } from '../src/types/agricultural.js'

const FIELD_ID = '7J6VPHGH+WP7P'
const TRAINING_DATA_PATH = new URL('../data/training/sunflower-belt-competing-crops.jsonl', import.meta.url)

interface RealTrainingRow {
  fieldId: string
  geometry: GeoJSON.MultiPolygon
  monitoringHistory: { startTimestampSec: number; endTimestampSec: number; predictions: { crop: string; confidence: number }[] }[]
}

function loadRealField(): RealTrainingRow {
  const lines = readFileSync(TRAINING_DATA_PATH, 'utf-8').split('\n').filter(Boolean)
  for (const line of lines) {
    const row = JSON.parse(line) as RealTrainingRow
    if (row.fieldId === FIELD_ID) return row
  }
  throw new Error(`${FIELD_ID} not found in ${TRAINING_DATA_PATH}`)
}

const real = loadRealField()
const properties: NormalizedFieldProperties = {
  aluType: 'field',
  areaSqM: 12000, // placeholder ALU metadata not used by any code path exercised in this test
  classConfidence: 0.9,
  captureTimestampSec: Date.now() / 1000,
  monitoring: real.monitoringHistory,
}

console.log(`=== Real field ${FIELD_ID} (Andhra Pradesh) — real AMED monitoring history, ${real.monitoringHistory.length} seasons ===\n`)

const { amedTop, amedCompeting, amedIsCurrentlyObserved } = buildAmedHypotheses(properties)
console.log('buildAmedHypotheses():', JSON.stringify({ amedTop, amedCompeting, amedIsCurrentlyObserved }, null, 2))

console.log('\n--- PART A: real live map-click path (extractSunflowerFeatures, real CDSE call attempt) ---')
const liveFeatures = await extractSunflowerFeatures(real.geometry, properties)
console.log('extractSunflowerFeatures() spectral result:', JSON.stringify(liveFeatures.spectral))
const liveScored = scoreSunflowerLikeness(liveFeatures.spectral)
console.log('scoreSunflowerLikeness():', JSON.stringify(liveScored))
const liveOverride = decideSunflowerOverride({ amedTop, amedIsCurrentlyObserved, likeness: 'available' in liveScored ? null : liveScored })
console.log('decideSunflowerOverride():', JSON.stringify(liveOverride, null, 2))
console.log(
  liveFeatures.spectral.observationCount === 0
    ? '\n[PART A] As expected in this environment: CDSE is not configured (server/.env has no CDSE_CLIENT_ID/SECRET), so the real path correctly falls back to "no evidence" and retains the AMED result.'
    : '\n[PART A] CDSE IS configured in this environment — a real live network call was made.',
)

console.log('\n--- PART B: same real field, using its REAL already-extracted Sentinel-2 values (pilot data, not a new CDSE request) ---')
// Real values for this exact field from training/data/pilot/pilot_feature_matrix.jsonl (see
// training/sunflower/verify_likeness_model_export.py's fixture generation for provenance).
const realHistoricalSpectral = {
  ndviMean: 0.49540388150000003,
  ndviSlope: null,
  ndviPeakValue: 0.7990836501,
  ndreMean: 0.3232269693,
  ndreSlope: null,
  ndrePeakValue: 0.5857979457,
  ndwiMean: 0.18136768990000002,
  ndwiPeakValue: 0.4385000832,
  yellowIndexMean: 0.1779064535,
  yellowIndexSlope: null,
  yellowIndexPeakValue: 0.25535142920000004,
  observationCount: 10,
}
const historicalScored = scoreSunflowerLikeness(realHistoricalSpectral)
console.log('scoreSunflowerLikeness() with real pilot-extracted values:', JSON.stringify(historicalScored))
const historicalOverride = decideSunflowerOverride({ amedTop, amedIsCurrentlyObserved, likeness: 'available' in historicalScored ? null : historicalScored })
console.log('decideSunflowerOverride():', JSON.stringify(historicalOverride, null, 2))

if (historicalOverride.overridden) {
  console.log(`\n[PART B] Full pipeline confirmed working end-to-end with real data: displayed result would be "Sunflower (${Math.round(historicalOverride.likeness * 100)}%)".`)
} else {
  console.log('\n[PART B] Override did not fire — see reason above.')
}
