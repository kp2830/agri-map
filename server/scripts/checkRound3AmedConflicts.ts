import 'dotenv/config'
import { readFileSync, writeFileSync } from 'node:fs'
import { buildAmedHypotheses } from '../src/services/agricultural/sunflower/amedHypotheses.js'
import type { NormalizedFieldProperties } from '../src/types/agricultural.js'

/**
 * Round 3 AMED conflict filter -- SAME logic/threshold as the round-1/2 check
 * (checkKurukshetraAmedConflicts.ts): real buildAmedHypotheses() (the actual production
 * override-policy season-selection logic), amedStrongConfidenceThreshold = 0.8 reused verbatim
 * from overridePolicy.ts. No new satellite/API calls -- reads AMED monitoring history already
 * captured during round-3 discovery.
 *
 * Run: npx tsx scripts/checkRound3AmedConflicts.ts
 */

const AMED_STRONG_CONFIDENCE_THRESHOLD = 0.8

function main() {
  // score_and_tier.py output (Tier A/B candidates with score/tier already computed) --
  // produced by running that frozen script against haryana_round3_results.json first.
  const scored = JSON.parse(readFileSync('../training/sunflower/haryana_round3_scored.json', 'utf-8')) as {
    field_id: string; candidate_tier: string
  }[]
  const candidates = scored.filter((r) => r.candidate_tier === 'A' || r.candidate_tier === 'B')

  const pool = JSON.parse(readFileSync('../training/sunflower/haryana_round3_selected_250.json', 'utf-8')) as {
    id: string; properties: NormalizedFieldProperties
  }[]
  const poolById = new Map(pool.map((f) => [f.id, f]))

  const results: any[] = []
  for (const c of candidates) {
    const field = poolById.get(c.field_id)
    if (!field) {
      results.push({ field_id: c.field_id, tier: c.candidate_tier, error: 'not found in round-3 pool' })
      continue
    }
    const { amedTop, amedIsCurrentlyObserved } = buildAmedHypotheses(field.properties)
    const hasHighConfidenceCompetingCrop = amedTop !== null && amedTop.confidence >= AMED_STRONG_CONFIDENCE_THRESHOLD
    const decision = hasHighConfidenceCompetingCrop ? 'FOUNDER_SIGNAL_AMED_CONFLICT' : 'KEPT'

    results.push({
      field_id: c.field_id, tier: c.candidate_tier,
      amed_crop: amedTop?.crop ?? null, amed_confidence: amedTop?.confidence ?? null,
      amed_is_currently_observed: amedIsCurrentlyObserved,
      decision,
    })
  }

  writeFileSync('../training/sunflower/haryana_round3_amed_conflict_check.json', JSON.stringify(results, null, 2))

  const tierA = results.filter((r) => r.tier === 'A')
  const tierB = results.filter((r) => r.tier === 'B')
  const kept = results.filter((r) => r.decision === 'KEPT')
  const conflict = results.filter((r) => r.decision === 'FOUNDER_SIGNAL_AMED_CONFLICT')

  console.log(`Checked ${results.length} Tier A/B candidates.`)
  console.log(`Tier A: ${tierA.length} (kept ${tierA.filter((r) => r.decision === 'KEPT').length}, conflict ${tierA.filter((r) => r.decision === 'FOUNDER_SIGNAL_AMED_CONFLICT').length})`)
  console.log(`Tier B: ${tierB.length} (kept ${tierB.filter((r) => r.decision === 'KEPT').length}, conflict ${tierB.filter((r) => r.decision === 'FOUNDER_SIGNAL_AMED_CONFLICT').length})`)
  console.log(`Total kept: ${kept.length}, excluded: ${conflict.length}`)
  for (const r of conflict) console.log(`  EXCLUDED: ${r.field_id} (Tier ${r.tier}): AMED = ${r.amed_crop} @ ${(r.amed_confidence * 100).toFixed(1)}%`)
}

main()
