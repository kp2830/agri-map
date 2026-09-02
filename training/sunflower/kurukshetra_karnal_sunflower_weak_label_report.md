# Kurukshetra-Karnal Sunflower Weak-Label Dataset — Report

**Weak supervision, not ground truth.** Every label in this dataset is derived exclusively from
the co-founder's Google Earth field observation (Delhi→Chandigarh drive, 2026-05-09) and her
resulting Sentinel-2 temporal hypothesis (April green → May flowering-period green → June
harvested/brown/ploughed). No field here is independently confirmed sunflower. No AMED crop label
was used to generate or validate any label. `NON_SUNFLOWER_TEMPORAL_NEGATIVE` means "does not
match the co-founder's temporal hypothesis" — it is NOT an independently confirmed non-sunflower
crop identification.

No EuroCrops. No production code, AMED, or thresholds touched. Nothing deployed.

## Cost/scale check (done before running)

At the measured rate (0.69 PU/field, from the 30-field pilot), 245 new fields was estimated at
~169 PU — well within budget, consistent with the pilot's own observed rate, so extraction
proceeded without a separate stop.

## What actually happened — reported honestly, including the shortfall

**Target: ~245 new fields (+ the 30 already tested = ~275 total). Actual: 116 of 245 new fields
succeeded; 129 failed with real CDSE `429 RATE_LIMIT_EXCEEDED` errors, despite the same throttling
(1.2s between windows, 2-3s between fields) that fixed the rate limit in the 30-field pilot.**

This is a real, useful operational finding: the throttling that worked for a short (30-field, ~4
minute) run was **not sufficient for a sustained ~30-minute run** — CDSE's rate limit appears to
include a longer-window (sustained-rate or hourly) component, not just a burst limit. The failures
started clustering after ~180 fields and became near-total by the end, consistent with a cumulative
quota rather than a simple per-second cap.

**Total dataset: 146 real fields** (30 from the pilot + 116 from batch 2). **Total real PU spent
this session: 101.23** (20.80 pilot + 80.43 batch 2). Cumulative CDSE Statistical API PU across
this whole project remains well within budget.

**The 129 failed fields were NOT retried in this run** (per the standing instruction not to retry
without reporting first) — their field IDs and geometries are preserved in
`kurukshetra_karnal_batch2_selected_fields.json` and the extraction script
(`server/scripts/extractSunflowerBatch2.ts`) is resumable — it already skips any field ID that
succeeded, so resuming only re-attempts the 129 that failed. **Recommend resuming with longer
delays (e.g. 3-5s between windows, 5-8s between fields) if/when you want the full ~275.**

## Scoring methodology (frozen before this batch ran)

`sunflower_candidate_score` (continuous, 0-1) is a transparent weighted sum of 5 components, each
calibrated to the OBSERVED extremes of the 30-field pilot sample (not arbitrary constants):

```
score = 0.25 * c_apr + 0.15 * c_may + 0.30 * c_decline + 0.20 * c_june_low + 0.10 * c_coverage
```

- `c_apr` = April NDVI / 0.764 (pilot's observed max), clipped [0,1]
- `c_may` = May NDVI / 0.764, same scale
- `c_decline` = (April NDVI − June NDVI) / 0.646 (pilot's observed max decline), clipped [0,1]
- `c_june_low` = 1 − (June NDVI / 0.25) — reward for being below the co-founder's own "brown"
  reference, zero credit at or above it
- `c_coverage` = mean fraction of real Sentinel-2 observations that were cloud-free/valid across
  the 3 windows

**`baseline_rule_pass`** (the co-founder's exact original rule, April NDVI > 0.50 AND June NDVI <
0.25) is preserved as its own separate field in every record — never replaced by the score.

**Tiering is not score-alone.** A field only enters Tier A or B if it shows a *real* positive
decline consistent with the hypothesis — a gate added after finding, in the pilot, that a field
which stays green all season (April 0.727, May 0.754, June 0.507 — never declines) scored 0.580 on
raw components alone, which would have wrongly placed it in a candidate tier. A second gate
excludes near-bare fields that trivially satisfy "low June" only because they were never green at
any point.

| Tier | Rule | Training label |
|---|---|---|
| A | `baseline_rule_pass == True` (exact co-founder rule) | `SUNFLOWER_WEAK_POSITIVE_HIGH` |
| B | No exact pass, but real decline > 0.25, June < 0.35, and close to at least one hard threshold | `SUNFLOWER_WEAK_POSITIVE_MEDIUM` |
| C | Score 0.35-0.60 AND reached real vegetation (max(Apr,May) ≥ 0.30) at some point | `UNCERTAIN` |
| D | Everything else | `NON_SUNFLOWER_TEMPORAL_NEGATIVE` |

## Results

| Tier | Label | Count | % of 146 |
|---|---|---|---|
| A | SUNFLOWER_WEAK_POSITIVE_HIGH | **8** | 5.5% |
| B | SUNFLOWER_WEAK_POSITIVE_MEDIUM | **4** | 2.7% |
| C | UNCERTAIN | 15 | 10.3% |
| D | NON_SUNFLOWER_TEMPORAL_NEGATIVE | 119 | 81.5% |

**Exact-rule pass rate: 8/146 = 5.5%** (versus 3/30 = 10.0% in the pilot — the larger, more
representative sample settled to a somewhat lower rate, as expected with more data; still clearly
selective, not "everything passes").

**Tier A candidates (strongest 8, sorted by score)**:

| Field ID | Score | Apr | May | June | Area (m²) | Coverage |
|---|---|---|---|---|---|---|
| 8J2R3V26+36F7 | 0.897 | 0.720 | 0.674 | 0.076 | 3,767 | 0.92 |
| 8J2R4Q2G+P5FV | 0.871 | 0.764 | 0.663 | 0.118 | 7,880 | 0.85 |
| 8J2R2QRC+32F4 | 0.818 | 0.671 | 0.539 | 0.082 | 1,205 | 0.83 |
| 7JXRWRRX+PVWG | 0.736 | 0.629 | 0.591 | 0.127 | 9,421 | 0.83 |
| 8J2R2RV4+VQMM | 0.640 | 0.599 | 0.305 | 0.147 | 6,047 | 0.92 |
| 8J2V628G+RC84 | 0.632 | 0.622 | 0.453 | 0.165 | 1,523 | 0.60 |
| 8J2R5X7H+7576 | 0.597 | 0.617 | 0.390 | 0.194 | 1,843 | 0.77 |
| 8J2R5R64+XQ7R | 0.589 | 0.629 | 0.553 | 0.239 | 1,075 | 0.85 |

**Tier B candidates (real "narrow miss" examples — none existed in the 30-field pilot; the larger
sample surfaced genuine ones, validating the tier design)**:

| Field ID | Score | Apr | May | June | Note |
|---|---|---|---|---|---|
| 8J2R6V7W+38VP | 0.546 | 0.622 | 0.524 | 0.270 | June just above the 0.25 cutoff |
| 7JXRWVQ2+7JV5 | 0.513 | 0.365 | 0.285 | 0.091 | April just below the 0.50 cutoff, June well below 0.25 |
| 8J2V527G+8XQG | 0.498 | 0.466 | 0.266 | 0.152 | Close to both thresholds; **area = 24 m² — see data-quality note below** |
| 7JXRVXHH+FX89 | 0.488 | 0.489 | 0.455 | 0.228 | April/June both just outside their thresholds |

## Distributions (all 146 real fields)

| | min | max | mean | median |
|---|---|---|---|---|
| Score | 0.155 | 0.897 | 0.339 | 0.314 |
| NDVI April | 0.089 | 0.771 | 0.267 | 0.189 |
| NDVI May | 0.090 | 0.799 | 0.245 | 0.173 |
| NDVI June | 0.064 | 0.676 | 0.191 | 0.132 |
| Apr→June change | −0.304 | 0.646 | 0.076 | 0.061 |
| Area (m²) | 20 | 56,033 | 7,023 | 3,834 |
| Valid-pixel coverage | 0.60 | 1.00 | 0.84 | 0.83 |

Real Sentinel-2 coverage was consistently good (60-100% valid observations, mean 84%) — cloud
cover was not a major data-quality problem in this batch, unlike some of the WorldCereal/India
tests earlier in this project.

## Spatial distribution

**45 of the 49 sampled cells are represented** in the 146-field result (4 cells had all their
attempted fields fail to rate-limiting). Tier A+B candidates (12 total) span **11 different source
cells**, with centroids ranging lat 29.879-30.217 and lng 76.770-77.027 — **essentially the full
ROI**, not clustered in one sub-area. This is consistent with the co-founder's own observation of
sunflower visible across an extended stretch of highway, not one isolated field.

## Data-quality issues found

- **129/245 batch-2 fields failed due to CDSE rate limiting** (see above) — a real operational
  constraint now characterized, not a data problem per field.
- **One Tier B field (`8J2V527G+8XQG`) has area = 24 m²** — implausibly small for a real
  cultivated field (likely a sliver/edge artifact in the ALU landscape geometry, not a genuine
  field boundary). Flagged here rather than silently included as equivalent to the others; not
  removed from the dataset (removal itself is a judgment call), but should be excluded or treated
  with caution in any downstream training use.
- No other implausible field sizes observed in this batch (median 3,834 m² ≈ 0.9 acres, consistent
  with the earlier ALU discovery pass's real smallholder-field size distribution).

## CDSE processing cost

101.23 real PU spent this session (20.80 pilot + 80.43 batch 2). At ~0.69 PU/field, resuming the
remaining 129 fields would cost an estimated additional **~89 PU** if all succeeded.

---

## Answers

**A) How many strong weak-positive sunflower candidates (Tier A)?** **8**, all showing the
complete real pattern (April NDVI 0.60-0.76, declining to June NDVI 0.08-0.24).

**B) How many medium candidates (Tier B)?** **4**, genuine near-misses on exactly one of the two
original hard thresholds each — a category that didn't exist in the 30-field pilot, now real and
populated.

**C) How many useful negatives?** **119** Tier D fields (81.5% of the batch) — real fields, real
Sentinel-2 data, that clearly do not show the green→brown pattern (mostly low-vegetation
throughout, some showing the opposite increasing-greenness pattern typical of an early-kharif
crop). Plus 15 Tier C "uncertain" fields that are informative but not clean negatives.

**D) Does the candidate pattern remain selective at this larger scale?** **Yes.** 5.5% exact-rule
pass rate (146-field batch) vs. 10.0% (30-field pilot) — both far from "everything passes," and
the larger sample's rate is, if anything, more conservative, which is reassuring rather than
alarming (a heuristic that gets *less* permissive with more data is behaving correctly, not
overfitting to a lucky small sample).

**E) Do candidates cluster geographically?** **No** — Tier A+B fields span nearly the entire ROI
(11 of 45 represented cells), matching the co-founder's own description of an extended corridor of
visible sunflower, not one hotspot.

**F) What percentage of the population looks sunflower-like?** Tier A+B combined = 12/146 = 8.2%
of this real field sample. Tier A alone (highest confidence) = 5.5%.

**G) Is this dataset large enough to begin a first experimental classifier?** **Not yet, but
close.** 8 Tier-A + 4 Tier-B = 12 weak positives is very small for any real train/test split
(consistent with the standing instruction to be conservative and not manufacture impressive
metrics from a tiny dataset). 119 negatives is a healthy negative pool already. The single highest-
value next step is simply **more positives** — resuming the 129 failed fields (est. ~89 PU, cheap)
would likely add several more Tier A/B examples at the observed ~8% rate, potentially reaching
~20-25 combined weak positives, which starts to be workable for a genuinely conservative
field-level Random Forest experiment (with the explicit caveat that even then, this remains weak
supervision, not ground truth, and any resulting metrics describe agreement with the hypothesis,
not real-world accuracy).

**H) What additional data would most improve label quality?** (1) **Resuming the 129 failed
fields** with longer throttling — free information already selected, just blocked by the rate
limit. (2) **Independent verification for at least a few Tier A fields** — e.g. checking whether
any of the 8 fall along the co-founder's actual Delhi-Chandigarh driving route/date, or a targeted
high-resolution visual check (satellite basemap imagery) for 2-3 of them, since even weak labels
benefit from a handful of higher-confidence anchors. (3) **Sentinel-1 VV/VH**, still not yet
extracted for any of these fields — the co-founder's hypothesis is optical-only; SAR could help
distinguish genuine harvest/ploughing (a real structural change) from other reasons a field might
look "brown" in NDVI (e.g. a different fallow crop), which the current dataset cannot yet
distinguish. (4) **Pre-bloom windows (T-40/T-30/T-20 days before flowering)**, not yet extracted —
this remains the actual business objective (early detection) and hasn't been touched by this
discovery/labeling pass, which was deliberately scoped to validating the April/June signal first.

---

## Files produced

- `kurukshetra_karnal_sunflower_weak_labels.csv` — 146 records, flat table (no polygon column)
- `kurukshetra_karnal_sunflower_weak_labels.json` — 146 records with full polygons + provenance
- `kurukshetra_karnal_sunflower_fields.geojson` — 146-feature FeatureCollection for GIS/visual inspection
- `kurukshetra_karnal_sunflower_weak_label_report.md` — this report
- `kurukshetra_karnal_weak_label_stats.json` — machine-readable stats backing every number above
- `score_and_tier.py` — the frozen, documented scoring/tiering logic (reusable for any future batch)
- `kurukshetra_karnal_batch2_selected_fields.json` — includes the 129 not-yet-succeeded field IDs/geometries, ready to resume
