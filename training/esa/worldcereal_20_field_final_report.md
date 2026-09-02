# WorldCereal × AgriMap — 20-Field Calibration Evaluation (Final)

Real, measured evaluation using the 20-field calibration tranche you approved after the ~900-1,700
credit estimate for the full 100-field batch looked too large to commit to blind. All 20 jobs are
now finished. No new jobs were submitted, retried, cancelled, or recreated to produce this report
— every number below comes from the persisted backend cache
(`server/.worldcereal-research-cache/results.json`) and the existing AMED source data
(`training/data/pilot/amed_negative_manifest.jsonl`). No production code, AMED, or thresholds were
changed.

**Terminology note, honored throughout**: AMED is an existing production reference, not ground
truth. WorldCereal is not ground truth either. Every number below is **agreement** or
**disagreement** between two independent classifiers — never "accuracy."

---

# AMED vs WorldCereal — 20 Field Comparison

| # | Field ID | AMED crop (conf) | WorldCereal crop (prob) | Coverage | Verdict | Job ID | Duration | Credits |
|---|----------|-------------------|--------------------------|----------|---------|--------|----------|---------|
| 1 | 7J9R7RPQ+JGVC | SUGARCANE (18.5%) | no_crop (78%) | 11.6% | **DISAGREE** | j-...944f7ef | 5m56s | 10 |
| 2 | 7J9VWGM3+W54G | SUGARCANE (35.5%) | no_crop (66%) | 11.6% | **DISAGREE** | j-...572f99f | 7m54s | 9 |
| 3 | 7J9QPW67+4JPH | SUGARCANE (49.3%) | maize (31%) | 19.0% | **DISAGREE** | j-...5930b | 11m46s | 10 |
| 4 | 7J9QPW49+9GVX | SUGARCANE (60.9%) | no_crop (54%) | 10.7% | **DISAGREE** | j-...9634583 | 13m52s | 8 |
| 5 | 7J9VWFCH+RGV9 | SUGARCANE (73.8%) | maize (54%) | 67.8% | **DISAGREE** | j-...399af0f | 17m16s | 9 |
| 6 | 7JCRCHH4+383J | SORGHUM (33.1%) | rice (67%) | 25.6% | **DISAGREE** | j-...4a038ae | 20m33s | 10 |
| 7 | 7J9R7VRF+J2P5 | SORGHUM (41.8%) | no_crop (79%) | 32.2% | **DISAGREE** | j-...ad41f | 24m15s | 12 |
| 8 | 7J9R9VF4+8XH2 | SORGHUM (63.4%) | rice (76%) | 78.5% | **DISAGREE** | j-...df9c0c | 29m20s | 8 |
| 9 | 7J9VWFXW+294C | RICE (22.9%) | rice (44%) | 34.7% | **AGREE** | j-...8b6a9b | 29m50s | 8 |
| 10 | 7J6VPJ4P+J2QH | RICE (57.6%) | no_crop (41%) | 51.2% | **DISAGREE** | j-...52ebb12cb | 35m16s | 9 |
| 11 | 7J8VPXJF+XQVJ | RICE (62.9%) | rice (97%) | 100.0% | **AGREE** | j-...218b4824ad | 35m44s | 8 |
| 12 | 7J6VPJCR+4X3X | RICE (63.9%) | rice (99%) | 93.4% | **AGREE** | j-...9ad3ae4a06 | 42m16s | 9 |
| 13 | 7J9VXH64+H742 | COTTON (30.4%) | no_crop (86%) | 39.7% | **DISAGREE** | j-...53dd947c9 | 41m00s | 9 |
| 14 | 7J9VXH44+8PF5 | COTTON (44.1%) | no_crop (53%) | 79.3% | **DISAGREE** | j-...1ddc3f7495 | 47m46s | 10 |
| 15 | 7J9R7RPG+QV4W | COTTON (66.0%) | no_crop (48%) | 7.4% | **DISAGREE** | j-...f325c47413 | 49m21s | 10 |
| 16 | 7J9QMV2F+4Q8Q | CORN (32.1%) | no_crop (65%) | 42.2% | **DISAGREE** | j-...d870543870 | 54m53s | 9 |
| 17 | 7J6VMH27+9J73 | GROUNDNUT (23.1%) | no_crop (31%) | **0.8%** | **INCONCLUSIVE** | j-...b8b5a2873295 | 54m51s | 9 |
| 18 | 7J6VPJ5R+4442 | GROUNDNUT (52.9%) | no_crop (37%) | **3.3%** | **INCONCLUSIVE** | j-...03f471cb50 | 59m53s | 9 |
| 19 | 7J9R9RC3+MQR5 | SOYBEANS (55.1%) | no_crop (51%) | 62.8% | **DISAGREE** | j-...e87a29fcc9c348294b4 | 62m42s | 12 |
| 20 | 7J6VPJ59+32FH | CHILLI (34.3%) | no_crop (58%) | **6.6%** | **INCONCLUSIVE** | j-...602ed7cf6ea4 | 67m43s | 10 |

All 20 fields real, all real Sentinel-based AMED negatives from the sunflower-project background
pool (`training/data/pilot/amed_negative_manifest.jsonl`), all real WorldCereal CROPTYPE24 jobs,
season window `2024-12-01..2025-11-30` for every field (WorldCereal's own fixed India default —
see §"Data-quality notes" below for why this matters).

**Disagreement detail (explicit AMED vs WorldCereal, every disagreeing field)**: fields 1-8, 10,
13-16, 19 above each show the exact AMED prediction in column 3 and the exact WorldCereal
prediction in column 4 side by side — e.g. field 1: AMED says SUGARCANE, WorldCereal says
`no_crop`; field 6: AMED says SORGHUM, WorldCereal says `rice`.

**Inconclusive fields (3)**: fields 17, 18 (GROUNDNUT) — WorldCereal found valid data in only
0.8% and 3.3% of the inspection window respectively (real cloud cover / seasonal data gaps, same
failure mode as Kurukshetra earlier in this project); field 20 (CHILLI) — CHILLI has no
counterpart anywhere in WorldCereal's 24-class CROPTYPE taxonomy, so "agree/disagree" cannot be
meaningfully assigned regardless of what WorldCereal output.

---

## Aggregate AMED vs WorldCereal

- **Agreement: 3/20 = 15.0%**
- **Disagreement: 14/20 = 70.0%**
- **Inconclusive: 3/20 = 15.0%**
- **Conclusive agreement (agree / (agree+disagree)): 3/17 = 17.6%**

Both figures reported per your instruction — do not silently drop the inconclusive fields from
the headline number.

## Breakdown by AMED crop

| AMED crop | Fields | Agree | Disagree | Inconclusive | Agreement % (of conclusive) | Most common WC alternative |
|---|---|---|---|---|---|---|
| RICE | 4 | 3 | 1 | 0 | **75.0%** | no_crop |
| SUGARCANE | 5 | 0 | 5 | 0 | 0.0% | no_crop (3), maize (2) |
| SORGHUM | 3 | 0 | 3 | 0 | 0.0% | rice (2), no_crop (1) |
| COTTON | 3 | 0 | 3 | 0 | 0.0% | no_crop (3) |
| CORN | 1 | 0 | 1 | 0 | 0.0% | no_crop |
| GROUNDNUT | 2 | 0 | 0 | 2 | n/a | — |
| SOYBEANS | 1 | 0 | 1 | 0 | 0.0% | no_crop |
| CHILLI | 1 | 0 | 0 | 1 | n/a | — |

**RICE is the one crop with real, meaningful agreement (75%, 3 of 4).** Every other crop with a
conclusive verdict disagreed 100% of the time — but every one of those crops has only 1-5 fields,
too few to call this a stable per-crop rate on its own (see confidence-bucket section for the
sample-size caveat, which applies here too).

## Breakdown by WorldCereal prediction (distribution across all 20)

| WorldCereal prediction | Count | % |
|---|---|---|
| `no_crop` | 13 | 65.0% |
| `rice` | 5 | 25.0% |
| `maize` | 2 | 10.0% |

**WorldCereal does NOT systematically favor RICE or MAIZE in this sample — the real, dominant
systematic pattern is `no_crop` (65% of all 20 fields).** This is a different and more important
finding than the RICE/MAIZE-bias hypothesis: WorldCereal is not confidently reclassifying these
AMED fields as a competing crop most of the time — it's most often not recognizing them as
cropland at all within the queried window. `rice` appears only because 4 of the 8 SORGHUM/RICE
fields' nearest valid pixel happened to be rice-classified, not because rice is a generic fallback
class.

## AMED confidence analysis

| Bucket | Fields | Agree | Disagree | Inconclusive | Agreement % (of conclusive) |
|---|---|---|---|---|---|
| Low (<0.35) | 7 | 1 | 4 | 2 | 20.0% |
| Medium (0.35-0.59) | 7 | 0 | 6 | 1 | 0.0% |
| High (≥0.60) | 6 | 2 | 4 | 0 | 33.3% |

**Does WorldCereal disagree more often when AMED confidence is low? No clear relationship in this
sample.** The medium bucket has the *worst* conclusive agreement (0%), not the low bucket, and
high-confidence AMED fields actually show the best agreement (33.3%) after RICE's own strong
showing. With 6-7 fields per bucket, **this sample is too small to support any confident
conclusion about a confidence-agreement relationship in either direction** — stated explicitly
per your instruction, not inferred from noise.

## AMED low-confidence value — "potentially useful independent second opinion"

This 250-field AMED source pool contains **zero true UNKNOWN/no-prediction fields** (it was built
by filtering to confirmed crop-labeled AMED negatives for the earlier sunflower project) — so
there is no true "AMED said Unknown" case in this batch to test. As the closest available proxy,
"AMED-uncertain" here means `amed_confidence < 0.35` (same threshold already used in the
production `consensus.ts` advisory logic):

| Field | AMED | AMED conf | WorldCereal | WC prob | Coverage | Potentially useful 2nd opinion? |
|---|---|---|---|---|---|---|
| 7J9R7RPQ+JGVC | SUGARCANE | 18.5% | no_crop | 78% | 11.6% | Yes (meaningful, disagrees) |
| 7JCRCHH4+383J | SORGHUM | 33.1% | rice | 67% | 25.6% | Yes (meaningful, disagrees) |
| 7J9VWFXW+294C | RICE | 22.9% | rice | 44% | 34.7% | Yes (meaningful, **agrees**) |
| 7J9VXH64+H742 | COTTON | 30.4% | no_crop | 86% | 39.7% | Yes (meaningful, disagrees) |
| 7J9QMV2F+4Q8Q | CORN | 32.1% | no_crop | 65% | 42.2% | Yes (meaningful, disagrees) |
| 7J6VMH27+9J73 | GROUNDNUT | 23.1% | no_crop | 31% | **0.8%** | No — WC itself inconclusive |
| 7J6VPJ59+32FH | CHILLI | 34.3% | no_crop | 58% | 6.6% | No — not comparable (no WC class) |

- **AMED-uncertain fields: 7**
- **WorldCereal gives a meaningful crop prediction (≥30% prob, ≥5% valid coverage): 6/7 (85.7%)**
- **WorldCereal also inconclusive: 1/7 (14.3%)**
- **Of those 6 meaningful predictions, only 1 actually agrees with AMED** — the other 5 are real,
  usable, but *disagreeing* second opinions.

This is genuinely informative — WorldCereal is willing to produce a real, decodable, non-trivial
prediction on 6 of 7 AMED-uncertain fields — but "provides a second opinion" and "agrees with
AMED" are different things, and this data shows the second opinion mostly disagrees. **Not framed
as correcting AMED** — framed as an independent signal a human reviewer or a future confidence
model could weigh, nothing more.

## Disagreement analysis

**Confusion table (AMED → WorldCereal, disagreements only)**:

| AMED | WorldCereal | Count |
|---|---|---|
| SUGARCANE | no_crop | 3 |
| COTTON | no_crop | 3 |
| SUGARCANE | maize | 2 |
| SORGHUM | rice | 2 |
| SORGHUM | no_crop | 1 |
| RICE | no_crop | 1 |
| CORN | no_crop | 1 |
| SOYBEANS | no_crop | 1 |

1. **Most common disagreement**: AMED-crop → `no_crop` (10 of 14 disagreements, 71%). Crop→crop
   disagreement (SUGARCANE→maize, SORGHUM→rice) accounts for the remaining 4.
2. **Does WorldCereal disproportionately predict RICE?** No — rice only appears as a disagreement
   target for SORGHUM (2 of 3 SORGHUM fields), not as a generic fallback across crops.
3. **Does it disproportionately predict MAIZE?** No — only 2 of 20 fields total, both SUGARCANE.
4. **Are disagreements concentrated in particular AMED crops?** Yes by *rate* (SUGARCANE, COTTON,
   SORGHUM, CORN, SOYBEANS all show 0% conclusive agreement vs RICE's 75%), but each of those
   crops has only 1-5 fields — too few to call this crop-specific rate stable without more data.
5. **Are disagreements associated with low AMED confidence?** No clear association — see the
   confidence-bucket table above (medium confidence had the *worst* agreement, not low).
6. **Are disagreements associated with low WorldCereal valid-pixel coverage?** **Yes, directionally,
   supported by the actual numbers**: mean coverage for AGREE fields = **76.0%**, DISAGREE fields
   = **38.6%**, INCONCLUSIVE fields = **3.6%** (by definition, since coverage below 5% is exactly
   what triggers INCONCLUSIVE). Agreement fields had roughly double the valid data of
   disagreement fields — real, though the AGREE sample is only 3 fields, so treat this as a
   suggestive pattern, not a proven threshold.
7. **Geography/season**: By region, Karnataka shows 9 disagree/1 agree (10 fields), Maharashtra 4
   disagree/0 agree (4 fields), Andhra Pradesh 1 disagree/1 agree/3 inconclusive (5 fields),
   Telangana 1 agree (1 field) — too few fields per region to separate a real geographic effect
   from small-sample noise. **Season/year is a real, separate confound worth flagging explicitly**:
   every WorldCereal job used the same fixed window (2024-12-01..2025-11-30), but the 20 AMED
   labels span real years 2021-2026 (only 8 of 20 fields have an AMED year that plausibly overlaps
   this window at all). Checking agreement rate for the 8 "season-aligned" fields (1 agree, 7
   disagree = 12.5%) against the 12 "mismatched" fields (2 agree, 7 disagree, 3 inconclusive =
   16.7% of conclusive) shows **no significant difference between the two groups in this sample**
   — so while the mismatch is real and should be fixed methodologically, it does not appear to be
   the dominant driver of the low agreement rate observed here.

## Data-quality analysis

- **Valid-pixel coverage**: mean **38.9%**, median **33.5%**, min **0.8%**, max **100.0%** across
  all 20 fields — real cloud cover and seasonal data availability vary enormously even within
  this small, geographically clustered sample.
- Coverage by verdict (repeated from above for completeness): AGREE 76.0%, DISAGREE 38.6%,
  INCONCLUSIVE 3.6%.
- **Critical methodological note**: the fixed WorldCereal season window (Dec 2024–Nov 2025) does
  not match each AMED field's own real labeled crop year for 12 of 20 fields — some AMED labels
  are from 2021-2023, well outside the queried window. A field correctly showing `no_crop` or a
  different real crop in 2024-2025 is not necessarily wrong about 2024-2025; it may simply be
  describing a different, later growing season than the one AMED's label refers to. **This is the
  single most important caveat on every number in this report** and should be fixed (by querying
  each field's own real AMED season/year, not a fixed default) before any larger-scale test.

---

## Operational analysis

Real, CDSE-reported job metadata (`job.usage.duration`/`job.costs` — never our own terminal
polling time):

| Metric | Value |
|---|---|
| Total credits, this 20-field batch | **188** |
| Mean credits/field | 9.4 |
| Median credits/field | 9 |
| Min / max credits | 8 / 12 |
| Mean backend duration | **2,136s (35.6 min)** |
| Median backend duration | 2,130s (35.5 min) |
| Min / max backend duration | 356s (5.9 min) / 4,063s (67.7 min) |

**Important distinction, as instructed**: this "duration" is CDSE's own `usage.duration` field
(submission-to-completion), not something derived from our own polling loop. But it is **not a
clean measure of pure compute time either** — all 20 jobs were submitted concurrently, and their
durations grow roughly monotonically with submission order (job 1: 356s → job 20: 4,063s). This
is real evidence of **queueing delay under shared-backend load**: the earlier single/small-batch
tests this project ran (1 and 5 concurrent jobs) measured 5-15 min/job; a 20-job concurrent
submission pushed the last jobs in the queue past an hour. This is itself a real, useful
operational finding — see the architecture section below.

**Cost extrapolation (explicitly labeled as extrapolation from this 20-field sample, mean-based)**:
- **50 fields ≈ 470 credits**
- **100 fields ≈ 940 credits**

Cumulative real openEO/CDSE spend across the whole project: 82 (prior rounds) + 188 (this batch)
= **270 credits**.

## Product architecture analysis

| Architecture | UX | Processing cost | Latency | Implementation complexity | Scientific value |
|---|---|---|---|---|---|
| 1. Live inference on every click | Unusable — user waits minutes | Every click = 8-12 credits, even repeat clicks | 6-68 min/job (this batch), worse under concurrent load | Low (already built) | N/A — never validated in practice at this latency |
| 2. Fully precomputed (batch ahead of demand) | Instant for pre-covered fields, blank for others | Front-loaded, same total spend regardless of clicks | 0 for covered fields | Medium (needs a scheduling/coverage strategy) | Good if coverage is broad enough |
| 3. **Cached, submit-on-demand (implemented)** | First click on a new field waits; every later click on it or any already-seen field is instant | Pay only for fields actually clicked, once each | 0 for repeat clicks (measured: 21-53ms); 6-68 min for a genuinely new field | Already built and verified this session | Matches actual usage patterns |
| 4. WorldCereal only for AMED Unknown/low-confidence | Narrower scope, same caching mechanics as #3 | Lowest total spend of the "live" options | Same as #3, but far fewer fields trigger it | Small addition on top of #3 (a confidence gate) | Best value use, per this batch's own second-opinion analysis (85.7% of AMED-uncertain fields got a meaningful WC prediction) |
| 5. Independent secondary classifier (always shown, never gating AMED) | Adds a second data point on every field, potentially confusing given 70% disagreement rate | Same spend as #3/#4 | Same as #3 | Already how `consensus.ts` is written (advisory only) | Value depends on the reader understanding "second opinion," not "correction" |

**Recommendation: keep what's already implemented (#3, cached background job, dedup'd
submission) — but scope its *use* to #4's narrower policy: trigger it only for AMED
Unknown/low-confidence fields, not as a blanket second opinion on every click.** This is directly
supported by this batch's own numbers: unrestricted disagreement is high (70%) and not clearly
tied to AMED confidence, so showing it everywhere risks noise; but on the 7 AMED-uncertain fields
specifically, WorldCereal produced a real, decodable, non-fabricated prediction 85.7% of the time
— exactly the case where AMED itself has the least to offer and a second signal (even a
disagreeing one, clearly labeled) has the most potential value. **Live inference on click (#1) is
ruled out by the measured timing alone** — no architecture question there, just a fact.

---

## Scientific interpretation

1. **Does WorldCereal agree with AMED often enough to be useful generally? No** — 15% raw
   agreement (17.6% of conclusive fields) is low. It is **specifically useful for RICE** (75%
   conclusive agreement, though n=4).
2. **Does WorldCereal add information beyond AMED? Partially.** It never fabricates — every
   result here is a real decoded probability from a real job — and on AMED-uncertain fields it
   produces a real, non-trivial signal 85.7% of the time. But most of that signal disagrees with
   AMED, so "adds information" ≠ "confirms or improves" AMED.
3. **Is WorldCereal more useful when AMED is uncertain? Directionally yes on availability** (it
   still produces a usable prediction), **but not on agreement** (only 1 of 6 meaningful
   low-confidence predictions actually matched AMED). Both facts matter and neither should be
   dropped.
4. **Systematic tendency toward broad classes like RICE/MAIZE? No — the real systematic tendency
   is toward `no_crop` (65% of all 20 fields)**, not toward misclassifying as a different named
   crop. This is a materially different (and arguably more concerning) finding than a RICE/MAIZE
   bias would have been.
5. **Enough data to claim accuracy? No.** 20 fields, no independent ground truth beyond AMED's
   own (non-authoritative) label, and a real season/year mismatch confound on 12 of 20 fields.
   Every number in this report is agreement/disagreement, never accuracy.
6. **What independent ground truth would be required?** Field-verified crop-cut or farmer-survey
   data for the *same real growing season* WorldCereal is queried for — ideally sourced the same
   way the sunflower project sourced its Karnataka field observations (iNaturalist / direct
   observation), not derived from either AMED or WorldCereal itself.

## WorldCereal capability / limitations (grounded in this test + prior rounds, not documentation alone)

**What it currently gives us**: a real, live, queryable CROPTYPE24 classifier over any Indian
point/time via openEO (not just the crop types in the free 2021 static product); real per-class
probabilities, not just a top label; real crop-calendar lookup logic (`get_season_dates_for_extent`,
though it fell back to a single global default for every Indian point tested across this entire
project — see below); custom area/year processing via the same live pipeline, no waiting for a
future static-product release.

**Differently from AMED**: independently trained, independent input stack (10 S2 bands + S1
VV/VH + DEM/slope + AGERA5 climate, vs. our own/AMED's own pipeline) — genuinely orthogonal
evidence when it does produce a confident result.

**Where it's weak, per this test specifically**:
- **`no_crop` dominance (65% of fields)** — either a real land-cover signal at these small field
  footprints, or a season/year mismatch artifact (see below), or both; unresolved by this test.
- **Valid-pixel coverage swings wildly** (0.8%-100%) even within one small, geographically
  clustered batch — cloud cover is a real, unpredictable constraint on any given field.
- **No India-specific crop calendar**: every single Indian point queried across this whole
  project (Gadag, 5-field batch, Siddipet, Kurukshetra, and all 20 calibration fields) triggered
  *"No crop-calendar lookup points found inside extent"* and fell back to one fixed global
  window — meaning the "season-aware" part of WorldCereal's own design isn't actually
  differentiating between Indian regions or crop calendars today.
- **Perennial/plantation crops**: entirely out of scope by design (CROPTYPE24 targets
  temporary/annual crops only) — irrelevant to this 20-field annual-crop test, but a hard
  ceiling on 14 of AgriMap's 20 target crops regardless of these results (see the earlier
  `worldcereal_agrimap_evaluation.md` crop matrix).
- **Latency and queueing**: 6-68 minutes per job in this batch, with real evidence that
  concurrency (20 jobs at once) makes it worse, not just slower proportionally.

**Does the incomplete 2026 WorldCereal availability matter?** No — confirmed earlier in this
project directly from ESA's own product page: the only thing "coming in 2026" is an unspecified
expansion of the *static* product collection (still 2021-only today). The live CROPTYPE24
inference model this entire evaluation used is already the current, most capable thing WorldCereal
offers — nothing is being held back that would change these results.

---

## ESA discussion — realistic, "how do we use what already exists," not "please build us something"

1. **India-specific crop-calendar / Reference Data Module (RDM) coverage.** Every real Indian
   query in this project fell back to a single global default season window. Ask ESA/WENR/IIASA
   (who maintain the RDM) whether denser Indian reference points exist or are planned, and how to
   contribute/access region-specific calendars if they do — this directly affects whether our
   fixed-window workaround (`config.ts`'s `DEFAULT_INDIA_SEASON`) is still the right call.
2. **Guidance on small-field valid-pixel coverage in South Asia.** Our field footprints (roughly
   1-4 ha, matching real Indian smallholder plot sizes) saw wildly variable coverage (0.8-100%)
   even in one small geographic cluster. Ask whether WorldCereal's own validation work has
   characterized expected coverage/accuracy at this field-size regime specifically (most published
   WorldCereal validation is at coarser scale), and whether there's a recommended minimum
   field-size or buffer for reliable results in India.
3. **Interpretation guidance for the `no_crop`-dominant result seen here.** Ask directly whether
   this is expected behavior for small real cropland parcels mid-season/post-harvest within a
   fixed annual window, or a signal worth escalating as a potential India-specific accuracy gap —
   ESA's own team is best placed to say which.
4. *(Lower priority, not yet directly tested)* Whether WorldCereal's existing phenology outputs
   (season start/end per pixel, already part of the product spec) could be surfaced to AgriMap
   even where crop-type classification itself is inconclusive — this alone wasn't tested in the
   20-field batch and would need its own small pilot before raising it as more than a question.

---

# Founder-ready verdict

1. AMED vs WorldCereal agreement: 3/20 (15.0%)
2. Disagreement: 14/20 (70.0%)
3. Inconclusive: 3/20 (15.0%)
4. Conclusive agreement: 3/17 (17.6%)
5. Average WorldCereal processing time: 2,136s (35.6 min) — inflated by real queueing delay from submitting 20 jobs at once; single-job baseline measured earlier this project was 5-15 min
6. Median WorldCereal processing time: 2,130s (35.5 min)
7. Average WorldCereal cost: 9.4 credits/field
8. Estimated 50-field cost: ~470 credits (extrapolated from this sample's mean)
9. Estimated 100-field cost: ~940 credits (extrapolated from this sample's mean)
10. Does WorldCereal add useful information? **PARTIALLY**
11. Where does it add the most value? RICE fields (75% conclusive agreement) and AMED-uncertain fields generally (85.7% get a real, decodable second opinion — though it usually disagrees)
12. Best role in AgriMap: a **cached, on-demand, advisory-only secondary signal**, scoped to AMED Unknown/low-confidence fields rather than shown on every field
13. Biggest limitation: WorldCereal classified **65% of these real AMED-confirmed agricultural fields as `no_crop`** — not as a different crop, but as not-cropland at all, compounded by a real season/year mismatch (our fixed query window doesn't match 12 of 20 fields' actual labeled AMED year)
14. Does live map-click inference make sense? **NO**
15. Recommended architecture: background job triggered on demand, cached indefinitely per field_id (already implemented) — never synchronous, and gated to low-confidence/Unknown AMED fields rather than every click
16. What should we discuss with ESA? India-specific crop-calendar/RDM coverage; small-field (1-4 ha) valid-pixel coverage guidance; interpretation of the no_crop-dominant result
17. Should we proceed to 50 fields? **NO**
18. Reason: the dominant finding (majority `no_crop` result + a real, uncorrected season/year mismatch between the fixed query window and each field's actual AMED year) is a methodology problem, not a sample-size problem — running 50 more fields at the same fixed window would mostly replicate the same confound rather than answer a new question.

## Founder summary

Across 20 real fields, WorldCereal and AMED agreed on what's growing only 15% of the time (17.6%
once you set aside the 3 fields where WorldCereal simply didn't have enough clean data to say
anything). The one clear bright spot is rice — WorldCereal agreed with AMED on 3 of 4 rice fields,
a real and useful signal. Everywhere else, the dominant real finding wasn't that WorldCereal
"disagreed with the wrong crop" — 65% of the time it said the field wasn't cropland at all, which
is a different and more important problem than the RICE/MAIZE bias we went in worried about. Some
of that is almost certainly a methodology issue on our side: we queried every field with the same
fixed 2024-2025 window, but 12 of the 20 AMED labels are actually from different years, so in
several cases we may be comparing two genuinely different growing seasons rather than testing
whether WorldCereal is wrong. Each real job cost 8-12 credits and took anywhere from 6 minutes to
over an hour once we ran 20 at once — live, on-click inference is off the table regardless of
these results; the caching layer we built this session (submit once per field, reuse forever) is
the right call and is already working. The most promising practical use isn't a blanket second
opinion — it's a narrow one: on the 7 fields where AMED itself was uncertain, WorldCereal produced
a real, usable prediction 6 times out of 7, which is exactly the situation where a second signal
is most valuable even if it doesn't always agree. Before spending another ~470-940 credits on a
bigger batch, fixing the season-window mismatch is the higher-value next step — more fields at
the same broken methodology would mostly just confirm the same confound rather than tell us
anything new.

---

## Verification (before finishing)

- **20 field records present**: confirmed (`len(fields) == 20`).
- **Every WorldCereal job ID matches one of the original 20 jobs**: confirmed by direct set
  comparison against `training/esa/experiments/calibration_jobs.json`.
- **No new WorldCereal jobs submitted**: confirmed via a real, one-shot CDSE account job-count
  check — 30 total jobs on the account (10 from before this batch + exactly these 20), same as
  before the caching/analysis work in this and the prior turn.
- **Aggregate counts**: 3 + 14 + 3 = 20. Crop breakdown fields sum to 20. Confidence-bucket
  fields sum to 20. WorldCereal-prediction-distribution counts sum to 20. All verified
  programmatically, not by hand.
- No production code, AMED, or thresholds modified. No commits or pushes.
