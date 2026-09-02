# Sunflower RF — Experiment A vs Experiment B (AMED-Filtered Positives)

**The 25 positives are weak labels, not ground truth.** Each passed the co-founder's temporal
hypothesis (Tier A = exact rule, Tier B = marginal) AND survived an AMED conflict filter (no
high-confidence competing-crop prediction ≥80%). One field (`8J2R3W22+GJG3`, AMED CORN @ 80.6%)
was excluded and is preserved only as `FOUNDER_SIGNAL_AMED_CONFLICT` metadata — never used as a
negative, never used in training. No new CDSE extraction this round. AMED untouched. Not deployed.

## Dataset composition

| | Experiment A | Experiment B |
|---|---|---|
| Positive class | 25 (17 EXACT_RULE / 8 MARGINAL_TIER_B), `label_source=cofounder_temporal_heuristic` | same 25 |
| Class-0 population | 205 existing Indian AMED negatives (2021, Deccan Plateau — Karnataka/AP/Maharashtra/Telangana) | 211 Kurukshetra-Karnal Tier D fields (2026, same region/season as positives) — **NOT confirmed negatives**, "does not match the temporal hypothesis" only |
| Total rows | 230 | 236 |

**Feature schema compatibility, verified before training**: all 13 features (NDVI/NDRE/NDWI/NDYI
× Apr/May/June + Apr→June NDVI change) have real, overlapping numeric ranges between positives
and each class-0 population — no schema mismatch. `valid_pixel_fraction` remains excluded from
both experiments (the leakage found and fixed in the prior round).

## Results

| Metric | Experiment A | Experiment B |
|---|---|---|
| Precision | 0.759 | 0.920 |
| Recall | 0.880 | 0.920 |
| F1 | 0.815 | 0.920 |
| ROC-AUC | 0.985 | 0.998 |
| PR-AUC | 0.867 | 0.989 |
| Confusion matrix | TN=198, FP=7, FN=3, TP=22 | TN=209, FP=2, FN=2, TP=23 |
| Fold ROC-AUCs | 0.995, 0.966, 0.995, 0.976, 1.000 | 1.000, 1.000, 0.990, 1.000, 1.000 |

**Probability distributions** (5-fold out-of-fold predictions):

| | Exp A positives | Exp A class-0 | Exp B positives | Exp B class-0 |
|---|---|---|---|---|
| min | 0.101 | 0.000 | 0.262 | 0.000 |
| median | 0.872 | 0.005 | 0.942 | 0.000 |
| mean | 0.771 | 0.047 | 0.889 | 0.021 |
| max | 0.977 | 0.948 | 0.999 | 0.675 |

Clean separation in both — most class-0 rows get near-zero probability, most positives get high
probability, with real spread (not every positive is a slam dunk, consistent with these being
weak labels of varying strength).

**Feature importances — consistent across both experiments**:

| Feature | Exp A | Exp B |
|---|---|---|
| `ndvi_apr_june_change` | 0.261 | 0.211 |
| `ndvi_apr` | 0.160 | 0.210 |
| `ndre_apr` | 0.097 | 0.144 |
| `ndyi_apr` | 0.097 | 0.082 |
| `ndwi_apr` | 0.081 | 0.164 |
| `ndvi_june` | 0.082 | 0.029 |
| (May features) | all ≤0.047 | all ≤0.046 |

## The confound this round set out to check

**Experiment A alone cannot rule out a region/year confound** (2026 Haryana vs. 2021 Deccan) —
that limitation from the prior round still applies to Experiment A on its own.

**Experiment B removes that specific confound** (same region, same season, same extraction
pipeline for both classes) and the model still separates the two populations — in fact slightly
*better* than Experiment A. This is meaningful: if Experiment A's result were driven purely by
"Haryana vs. South India," Experiment B should have performed much worse once that shortcut was
removed. It didn't.

**But Experiment B has its own real limitation, and it needs to be stated plainly**: Tier D was
itself *defined* using a formula built on these same features (low `ndvi_apr`, weak
`ndvi_apr_minus_june` decline, etc. — see `score_and_tier.py`). So part of Experiment B's strong
performance is close to definitional — the RF is partially re-discovering the same decision
boundary the hand-built scoring rule already encodes, not purely learning something independent
of it. Experiment B is genuine evidence that the signal isn't *only* a region artifact, but it is
**not** an independent, out-of-sample generalization test — the class-0 population was selected
using the same features being modeled.

**Net read**: two different, real limitations (A: region/year confound; B: tier-definition
circularity), pointing in different directions, both surviving. Together they're more informative
than either alone, but neither individually proves a genuine, independently-verifiable sunflower
signal.

---

## Answers

**1. Does the model appear to learn the co-founder's temporal signal?**
The evidence is consistent with yes, but not conclusive. The top features in both experiments are
exactly `ndvi_apr_june_change` and `ndvi_apr` — the two quantities the hypothesis is actually
about — not some unrelated band. That consistency, holding across two very differently-composed
class-0 populations, is the strongest piece of evidence so far that the model is tracking the
real phenological pattern rather than an artifact specific to one comparison.

**2. How much does performance change against same-region/same-season background fields?**
It does not degrade — it improves slightly (F1 0.815→0.920, ROC-AUC 0.985→0.998). Taken at face
value this is reassuring, but read it alongside the circularity caveat above: some of that
improvement is expected simply because Tier D was defined using related features, not necessarily
because same-region data makes the true signal easier to learn.

**3. Which features are consistently important?**
`ndvi_apr_june_change`, `ndvi_apr`, `ndre_apr`, `ndyi_apr`, `ndwi_apr` — all April-anchored or
decline-anchored. **May features rank lowest in both experiments** (all ≤0.047 importance) —
worth flagging directly for the actual business goal (early/pre-bloom detection): if May carries
this little weight, the April signal alone may already be doing most of the real work, which is
good news for early detection but hasn't been tested yet (this round used the full Apr/May/June
vector, not a pre-bloom-only feature set — see open item below).

**4. Is the model ready for a first AMED UNKNOWN/low-confidence retrospective test?**
**Not yet, but closer than after the last round.** Two real gaps remain before that's a fair test:
(a) neither experiment used truly independent ground truth — both are the co-founder's own weak
label evaluated against itself in different ways; (b) the actual pre-bloom business objective
(T-40/T-30/T-20 days before flowering) has never been tested — every result so far uses the full
April-June window, which includes information (May, June) a real early-detection system wouldn't
have yet. A retrospective AMED Unknown/low-confidence test is more informative *after* a
pre-bloom-only feature version exists, so its result reflects the system AgriMap would actually
run, not a version with hindsight it won't have in production.

---

## Files produced

- `experiment_a_dataset.json`, `experiment_b_dataset.json` — assembled training tables
- `experiment_a_rf_model.pkl`, `experiment_b_rf_model.pkl` — saved trained models (pickled, with feature list)
- `rf_experiments_ab_results.json` — full machine-readable metrics, importances, probability distributions
- `rf_experiments_ab_report.md` — this report

Not integrated into production. AMED untouched. No new CDSE extraction this round.
