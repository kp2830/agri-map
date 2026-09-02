import 'dotenv/config'
import { readFileSync, writeFileSync } from 'node:fs'
import { buildAmedHypotheses } from '../src/services/agricultural/sunflower/amedHypotheses.js'
import type { NormalizedFieldProperties } from '../src/types/agricultural.js'

/**
 * AMED conflict filter for the 26 Tier A/B Kurukshetra-Karnal weak-positive candidates. Uses the
 * REAL, already-in-production buildAmedHypotheses() (same season-selection logic the actual
 * Sunflower override policy runs) rather than a second, possibly-inconsistent reimplementation.
 * No new satellite extraction, no new ALU/AMED API calls -- reads the AMED monitoring history
 * already attached to each field in the existing discovery pool
 * (training/sunflower/kurukshetra_karnal_alu_discovery_pass1.json).
 *
 * amedStrongConfidenceThreshold = 0.8 reused verbatim from overridePolicy.ts's real production
 * constant (DEFAULT_SUNFLOWER_DECISION_CONFIG) -- not a new arbitrary number.
 *
 * Run: npx tsx scripts/checkKurukshetraAmedConflicts.ts
 */

const AMED_STRONG_CONFIDENCE_THRESHOLD = 0.8

function main() {
  const weakLabels = JSON.parse(readFileSync('../training/sunflower/kurukshetra_karnal_sunflower_weak_labels.json', 'utf-8')) as {
    records: { field_id: string; candidate_tier: string; ndvi_apr: number; ndvi_may: number; ndvi_june: number; sunflower_candidate_score: number }[]
  }
  const candidates = weakLabels.records.filter((r) => r.candidate_tier === 'A' || r.candidate_tier === 'B')

  const pool = JSON.parse(readFileSync('../training/sunflower/kurukshetra_karnal_alu_discovery_pass1.json', 'utf-8')) as {
    fields: { id: string; properties: NormalizedFieldProperties }[]
  }
  const poolById = new Map(pool.fields.map((f) => [f.id, f]))

  const results: any[] = []
  for (const c of candidates) {
    const field = poolById.get(c.field_id)
    if (!field) {
      results.push({ field_id: c.field_id, tier: c.candidate_tier, error: 'not found in discovery pool' })
      continue
    }
    const { amedTop, amedIsCurrentlyObserved } = buildAmedHypotheses(field.properties)
    const hasHighConfidenceCompetingCrop = amedTop !== null && amedTop.confidence >= AMED_STRONG_CONFIDENCE_THRESHOLD
    const decision = hasHighConfidenceCompetingCrop ? 'FOUNDER_SIGNAL_AMED_CONFLICT' : 'KEPT'

    results.push({
      field_id: c.field_id,
      tier: c.candidate_tier,
      founder_features: { ndvi_apr: c.ndvi_apr, ndvi_may: c.ndvi_may, ndvi_june: c.ndvi_june, score: c.sunflower_candidate_score },
      amed_crop: amedTop?.crop ?? null,
      amed_confidence: amedTop?.confidence ?? null,
      amed_is_currently_observed: amedIsCurrentlyObserved,
      amed_has_high_confidence_prediction: amedTop !== null && amedTop.confidence >= AMED_STRONG_CONFIDENCE_THRESHOLD,
      decision,
    })
  }

  writeFileSync('../training/sunflower/kurukshetra_karnal_amed_conflict_check.json', JSON.stringify(results, null, 2))

  console.log(`Checked ${results.length} Tier A/B candidates.\n`)
  for (const r of results) {
    console.log(`${r.field_id} tier=${r.tier} amed=${r.amed_crop ?? 'none'}(${r.amed_confidence ?? 'n/a'}) observed=${r.amed_is_currently_observed} -> ${r.decision}`)
  }

  const tierA = results.filter((r) => r.tier === 'A')
  const tierB = results.filter((r) => r.tier === 'B')
  const kept = results.filter((r) => r.decision === 'KEPT')
  const conflict = results.filter((r) => r.decision === 'FOUNDER_SIGNAL_AMED_CONFLICT')

  console.log('\n=== SUMMARY ===')
  console.log(`Tier A total: ${tierA.length}, kept: ${tierA.filter((r) => r.decision === 'KEPT').length}, conflict: ${tierA.filter((r) => r.decision === 'FOUNDER_SIGNAL_AMED_CONFLICT').length}`)
  console.log(`Tier B total: ${tierB.length}, kept: ${tierB.filter((r) => r.decision === 'KEPT').length}, conflict: ${tierB.filter((r) => r.decision === 'FOUNDER_SIGNAL_AMED_CONFLICT').length}`)
  console.log(`Total kept for positive training: ${kept.length}`)
  console.log(`Total excluded (FOUNDER_SIGNAL_AMED_CONFLICT): ${conflict.length}`)
  console.log('\nExcluded fields detail:')
  for (const r of conflict) console.log(`  ${r.field_id} (Tier ${r.tier}): AMED = ${r.amed_crop} @ ${(r.amed_confidence * 100).toFixed(1)}%`)
}

main()
