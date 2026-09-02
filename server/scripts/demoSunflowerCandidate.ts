/**
 * End-to-end demonstration: takes the top-ranked real India candidate field's actual extracted
 * Sentinel-2 spectral values (field_id 7J6VPHGH+WP7P, Andhra Pradesh, real AMED label CORN) and
 * runs them through the exact same predictSunflowerLikeness path a live AgriMap request would
 * use, then shows the advisory (non-overriding) display line. Not wired into any route — a
 * standalone demonstration per methodology_investigation_report_v4.md §21.
 *
 * Run: cd server && npx tsx scripts/demoSunflowerCandidate.ts
 */
import { describeSunflowerEvidence, scoreSunflowerLikeness, sunflowerLikenessModel } from '../src/services/agricultural/sunflower/likenessModel.js'
import type { SunflowerFeatures } from '../src/services/agricultural/sunflower/types.js'

// Real extracted Sentinel-2 aggregate values for field_id 7J6VPHGH+WP7P (Andhra Pradesh, real
// AMED crop label: CORN), from training/data/pilot/pilot_feature_matrix.jsonl.
const features: SunflowerFeatures = {
  spectral: {
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
  },
  sar: { vvMean: null, vhMean: null, vvVhRatioMean: null, vvVhRatioSlope: null, observationCount: 0 },
  historical: { seasonCount: 0, hasHistoricalSunflowerOccurrence: false, distinctHistoricalCrops: [] },
  daysBeforeBloom: null,
}

// This field's real AMED result in the pilot dataset — CORN, not a low-confidence/unknown
// prediction in this constructed example. Shown here specifically to demonstrate that a strong
// sunflower LIKENESS score does not automatically override a real existing AMED result (see
// decisionPolicy.ts — deliberately not modified this round).
const existingAmedResult = { crop: 'CORN', confidence: 0.62 }

const prediction = sunflowerLikenessModel.predictProbability(features)
console.log('SunflowerPrediction:', JSON.stringify(prediction, null, 2))

const scored = scoreSunflowerLikeness(features.spectral)
if (!('available' in scored)) {
  const advisory = describeSunflowerEvidence(existingAmedResult, scored)
  console.log('\nAdvisory display line (NOT an override — existing AMED result is retained):')
  console.log(`  "${advisory}"`)
}
