/**
 * Focused tests for isEligibleForSunflowerCheck (cropDisplay.ts) — the client-side gate that
 * decides whether it's worth calling the real-time Sunflower likelihood endpoint at all.
 * Self-executing assertions, matching this project's existing test style (no framework
 * configured client-side).
 *
 * Run: cd client && npx tsx scripts/testSunflowerEligibility.ts
 */
import { isEligibleForSunflowerCheck, type ActiveCropOutcome } from '../src/features/fields/cropDisplay'
import type { MonitoringSeason } from '../src/types/agricultural'

let passed = 0
let failed = 0
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`)
  if (ok) passed++
  else failed++
}

function season(cropConfidence: number, crop = 'COTTON'): MonitoringSeason {
  return { startTimestampSec: 0, endTimestampSec: 100, predictions: [{ crop, confidence: cropConfidence }] }
}

// 1. Unknown field -> eligible
check('none outcome is eligible', isEligibleForSunflowerCheck({ kind: 'none' }), true)

// 2. Low-confidence field -> eligible
const lowConfObserved: ActiveCropOutcome = { kind: 'observed', season: season(0.3057, 'COTTON') }
check('low-confidence observed (real 30.57% COTTON) is eligible', isEligibleForSunflowerCheck(lowConfObserved), true)

const lowConfFallback: ActiveCropOutcome = { kind: 'fallback', season: season(0.79) }
check('fallback just under threshold (0.79) is eligible', isEligibleForSunflowerCheck(lowConfFallback), true)

// seasonal (inferred, not directly observed) is always eligible regardless of any number
const seasonal: ActiveCropOutcome = { kind: 'seasonal', crop: 'CHILLI', matchedSeason: season(0.948, 'CHILLI') }
check('seasonal (inferred) is eligible even with a high underlying historical confidence', isEligibleForSunflowerCheck(seasonal), true)

// 3. High-confidence field -> NOT eligible (real 94.8% CHILLI observation, currently observed)
const highConfObserved: ActiveCropOutcome = { kind: 'observed', season: season(0.948, 'CHILLI') }
check('high-confidence observed (real 94.8% CHILLI) is NOT eligible', isEligibleForSunflowerCheck(highConfObserved), false)

// boundary: exactly at threshold is NOT eligible (>= threshold means "confident")
const atThreshold: ActiveCropOutcome = { kind: 'observed', season: season(0.8) }
check('exactly at threshold (0.8) is NOT eligible', isEligibleForSunflowerCheck(atThreshold), false)

// boundary: just under threshold IS eligible
const justUnder: ActiveCropOutcome = { kind: 'observed', season: season(0.7999) }
check('just under threshold (0.7999) is eligible', isEligibleForSunflowerCheck(justUnder), true)

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
