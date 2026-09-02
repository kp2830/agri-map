# First Experimental Sunflower Random Forest — Kurukshetra-Karnal Weak Positives + Existing AMED Negatives

**Weak supervision, not ground truth.** Positives are `SUNFLOWER_WEAK_POSITIVE_HIGH`/`_MEDIUM`
labels derived from the co-founder's temporal hypothesis (see
`kurukshetra_karnal_sunflower_weak_label_report.md`), not confirmed sunflower. Every metric below
describes how well the model separates these two populations — not real-world accuracy.

## Dataset

- **Positives: 26** (Tier A: 17, Tier B: 9) — Kurukshetra-Karnal, real Sentinel-2, April/May/June 2026
- **Negatives: 250 found → 205 usable** — `training/data/pilot/amed_negative_manifest.jsonl` (the
  earlier EuroCrops-pilot's real Indian AMED negative pool), 45 dropped for a real gap in at
  least one Apr/May/June window (not imputed)
- **Total: 231 rows, 26/231 = 11.3% positive**

## A real data-leakage bug found and fixed mid-run — reported, not hidden

The first training run produced **ROC-AUC = 1.000 in every single fold** — an immediate red flag
for a small, weakly-labeled, cross-region dataset. Root cause: `valid_pixel_fraction` was
computed differently for the two classes — negatives (built from a pre-existing raw daily series
with no null entries) always evaluated to exactly 1.0, while positives (built from this session's
own CDSE extraction) had real, varied values from 0.6-1.0. The model was trivially learning
**which pipeline produced the row**, not any vegetation signal.

Fixed by excluding `valid_pixel_fraction` from the model entirely — a second, more careful
computation attempt still didn't produce a genuinely comparable metric (the negatives' stored raw
series appears to have already dropped cloud-invalid days upstream rather than null-marking them,
a structural difference no downstream recomputation can undo). A real fix would require
re-extracting the 205 negatives with the current client so both classes share one real extraction
method — not done here, flagged as a follow-up.

## Results (5-fold stratified cross-validation, out-of-fold predictions, feature fixed)

| Metric | Value |
|---|---|
| Precision | 0.710 |
| Recall | 0.846 |
| F1 | 0.772 |
| ROC-AUC | 0.984 |
| Average Precision (PR-AUC) | 0.868 |
| Confusion matrix | TN=196, FP=9, FN=4, TP=22 |

Per-fold ROC-AUC: 0.984, 1.000, 0.995, 0.980, 1.000 (mean 0.992). Folds have only ~5 positives
each — a single flipped prediction swings recall/precision by ~15-20 points, so treat these as
noisy estimates, not precise numbers.

## Feature importances (trained on all 231 rows)

| Feature | Importance |
|---|---|
| `ndvi_apr_june_change` | 0.261 |
| `ndvi_apr` | 0.155 |
| `ndre_apr` | 0.099 |
| `ndyi_apr` | 0.098 |
| `ndwi_apr` | 0.087 |
| `ndvi_june` | 0.060 |
| `ndwi_june` | 0.049 |
| `ndvi_may` | 0.048 |
| `ndre_june` | 0.042 |
| `ndre_may` | 0.034 |
| `ndyi_june` | 0.032 |
| `ndwi_may` | 0.029 |
| `ndyi_may` | 0.006 |

**Reassuring**: the top 2 features (`ndvi_apr_june_change`, `ndvi_apr`) are exactly the two
quantities central to the co-founder's own stated hypothesis — the model isn't leaning on an
arbitrary band, it's leaning on the decline pattern and April greenness, the physically
meaningful signal. May features rank lowest across the board — worth a specific caveat (see below).

## The confound this result does NOT rule out — read before trusting the 0.984 ROC-AUC

**Positives and negatives differ by more than "sunflower or not."** Positives are 2026-season
Haryana fields; negatives are 2021-season Deccan Plateau fields (Karnataka/Andhra
Pradesh/Maharashtra/Telangana) growing entirely different crops (rice, sugarcane, sorghum, cotton,
etc.) under a different climate. A high ROC-AUC here is consistent with **either** "the model
learned a real sunflower-specific spectral/temporal signature" **or** "the model learned to tell
North Indian 2026 wheat-belt fields apart from South Indian 2021 monsoon-crop fields" — this
experiment cannot distinguish between those two explanations. This is a real, unresolved
limitation, not a caveat to skim past.

**The cheapest real fix, already sitting in hand at zero additional CDSE cost**: this project
already extracted 211 real `NON_SUNFLOWER_TEMPORAL_NEGATIVE` (Tier D) fields from the *same*
Kurukshetra-Karnal region, the *same* 2026 season, the *same* extraction pipeline as the
positives. Swapping in (or adding) those as negatives instead of the Deccan 2021 pool would
remove the region/year confound entirely and be a much more honest test of whether the model
detects sunflower specifically — not run in this experiment per your explicit instruction to use
only the existing ~250 pool for this first pass, but the clear next step once you want a cleaner
read on this same question.

## Misclassifications

4 false negatives (weak positives the model missed) and up to 10 highest-confidence false
positives are saved in `kurukshetra_rf_first_experiment_results.json` for inspection — not
reproduced here to keep this report short.

## Bottom line

The offline pipeline works end-to-end (real data in, a real trained model out, real cross-validated
metrics), and the feature importances are physically sensible. **But the 0.984 ROC-AUC should not
yet be read as "the model detects sunflower"** — it's equally consistent with a real region/season
confound the current negative pool cannot rule out. Recommended next step: retrain against the
211 real same-region Tier-D negatives before treating this number as evidence of a genuine
sunflower signal.

Not deployed. Not integrated into production. AMED untouched.
