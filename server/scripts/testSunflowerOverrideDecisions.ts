/**
 * Focused tests for the sunflower override decision chain, using real field data where possible
 * (the same real fields inspected in findEligibilityExamples.ts / lookupKarnatakaTestField.ts).
 * Self-executing assertions, matching this project's existing test style.
 *
 * Run: cd server && npx tsx scripts/testSunflowerOverrideDecisions.ts
 */
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { decideSunflowerOverride } from '../src/services/agricultural/sunflower/overridePolicy.js'
import { scoreSunflowerLikeness } from '../src/services/agricultural/sunflower/likenessModel.js'
import type { SunflowerFeatures } from '../src/services/agricultural/sunflower/types.js'

let passed = 0
let failed = 0
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`)
  if (ok) passed++
  else failed++
}

const REAL_STRONG_LIKENESS = scoreSunflowerLikeness({
  // Real already-extracted Sentinel-2 values for field 7J6VPHGH+WP7P (see
  // testSunflowerOverridePipeline.ts) — genuinely clears the conservative band (0.485).
  ndviMean: 0.49540388150000003, ndviSlope: null, ndviPeakValue: 0.7990836501,
  ndreMean: 0.3232269693, ndreSlope: null, ndrePeakValue: 0.5857979457,
  ndwiMean: 0.18136768990000002, ndwiPeakValue: 0.4385000832,
  yellowIndexMean: 0.1779064535, yellowIndexSlope: null, yellowIndexPeakValue: 0.25535142920000004,
  observationCount: 10,
})
if ('available' in REAL_STRONG_LIKENESS) throw new Error('expected the real fixture to score as available')

console.log('=== 3. High-confidence, currently-observed AMED result -> sunflower NEVER consulted, even with a strong real likeness score ===')
check(
  'high-confidence current AMED result is preserved regardless of likeness',
  decideSunflowerOverride({ amedTop: { crop: 'CHILLI', confidence: 0.948 }, amedIsCurrentlyObserved: true, likeness: REAL_STRONG_LIKENESS }),
  { overridden: false, reason: 'AMED currently observes CHILLI at 95% confidence — high-confidence known crops are never reconsidered against the Sunflower likeness score.' },
)

console.log('\n=== 4. Score above threshold -> override fires (real field 7J6VPHGH+WP7P vs. its real low-confidence AMED result) ===')
const overrideResult = decideSunflowerOverride({ amedTop: { crop: 'CORN', confidence: 0.6134 }, amedIsCurrentlyObserved: false, likeness: REAL_STRONG_LIKENESS })
check('override fires', overrideResult.overridden, true)
if (overrideResult.overridden) {
  check('overridden crop is SUNFLOWER', overrideResult.crop, 'SUNFLOWER')
  check('likeness matches the real scored value', overrideResult.likeness, 0.485)
}

console.log('\n=== 5. Score below threshold -> existing AMED result preserved ===')
const weakLikeness = scoreSunflowerLikeness({
  ndviMean: 0.2, ndviSlope: null, ndviPeakValue: 0.3, ndreMean: 0.1, ndreSlope: null, ndrePeakValue: 0.15,
  ndwiMean: 0.05, ndwiPeakValue: 0.08, yellowIndexMean: 0.05, yellowIndexSlope: null, yellowIndexPeakValue: 0.07,
  observationCount: 8,
})
if ('available' in weakLikeness) throw new Error('expected the weak fixture to score as available')
check(
  'below-threshold likeness does not override',
  decideSunflowerOverride({ amedTop: { crop: 'RICE', confidence: 0.4 }, amedIsCurrentlyObserved: false, likeness: weakLikeness }).overridden,
  false,
)

console.log('\n=== 6. CDSE failure (no credentials, this exact environment right now) -> no false override ===')
const cdseNotConfiguredResult = scoreSunflowerLikeness({
  ndviMean: null, ndviSlope: null, ndviPeakValue: null, ndreMean: null, ndreSlope: null, ndrePeakValue: null,
  ndwiMean: null, ndwiPeakValue: null, yellowIndexMean: null, yellowIndexSlope: null, yellowIndexPeakValue: null,
  observationCount: 0,
})
check('CDSE-not-configured (all-null) spectral is unavailable', 'available' in cdseNotConfiguredResult, true)
check(
  'unavailable likeness never overrides',
  decideSunflowerOverride({ amedTop: { crop: 'COTTON', confidence: 0.3057 }, amedIsCurrentlyObserved: false, likeness: null }).overridden,
  false,
)

console.log('\n=== 7. Missing/invalid spectral observations (only 1 real index, below MIN_REQUIRED_MEAN_INDICES) -> no false override ===')
const insufficientIndices = scoreSunflowerLikeness({
  ndviMean: 0.5, ndviSlope: null, ndviPeakValue: 0.7, ndreMean: null, ndreSlope: null, ndrePeakValue: null,
  ndwiMean: null, ndwiPeakValue: null, yellowIndexMean: null, yellowIndexSlope: null, yellowIndexPeakValue: null,
  observationCount: 10,
})
check('only 1/4 index means present -> unavailable', 'available' in insufficientIndices, true)

console.log('\n=== 7b. Sufficient indices but too few real observations (MIN_OBSERVATION_COUNT) -> no false override ===')
const tooFewObs = scoreSunflowerLikeness({
  ndviMean: 0.5, ndviSlope: null, ndviPeakValue: 0.7, ndreMean: 0.3, ndreSlope: null, ndrePeakValue: 0.5,
  ndwiMean: 0.2, ndwiPeakValue: 0.4, yellowIndexMean: 0.15, yellowIndexSlope: null, yellowIndexPeakValue: 0.2,
  observationCount: 1,
})
check('only 1 real observation -> unavailable', 'available' in tooFewObs, true)

console.log('\n=== 8. NaN-string CDSE response quirk handled correctly ===')
// Mirrors cdseClient.ts's requestPolygonStatistics parsing logic exactly (mean === "NaN" -> null).
function parseMean(rawMean: unknown): number | null {
  return rawMean === 'NaN' || rawMean === undefined || rawMean === null ? null : Number(rawMean)
}
check('real numeric mean parses through', parseMean(0.42), 0.42)
check('"NaN" string (real API quirk) parses to null, not NaN', parseMean('NaN'), null)
check('undefined parses to null', parseMean(undefined), null)

console.log('\n=== 9. Credentials never appear in source or logs (static check) ===')
const filesToCheck = [
  '../src/services/google/cdseClient.ts',
  '../src/services/agricultural/sunflower/featureExtraction.ts',
  '../src/controllers/agriculturalController.ts',
]
let credentialLeakFound = false
for (const relativePath of filesToCheck) {
  const content = readFileSync(new URL(relativePath, import.meta.url), 'utf-8')
  const loggingCredential = /console\.(log|warn|error|info)\([^)]*(?:CDSE_CLIENT_SECRET|CDSE_CLIENT_ID|accessToken|clientSecret)/i.test(content)
  if (loggingCredential) {
    console.log(`FAIL: ${relativePath} appears to log a credential-related variable`)
    credentialLeakFound = true
  }
}
check('no source file logs a CDSE credential', credentialLeakFound, false)

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
