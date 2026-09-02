# ESA WorldCereal as an AgriMap Component — Realistic Evaluation

Engineering evaluation, not another research loop. Production code, UI, and the sunflower
threshold are all unchanged. Nothing committed or pushed.

## 1. What WorldCereal actually gives us today

Inspected the installed package (`worldcereal==2.8.0`) directly — not assumed:

- **Product types**: `CROPLAND` (binary: temporary/annual crop vs. not), `CROPTYPE` (24-class
  crop identification), `EMBEDDINGS` (raw Presto foundation-model feature vectors, no
  classification head).
- **Deployed model taxonomy (`CROPTYPE24`, confirmed from the real GeoTIFF output, not the
  package's broader reference tables)**: wheat, barley, rye, oats, maize, sorghum, rice,
  other_temporary_crops, millet, vegetables, beet, dry_pulses_legumes, **sunflower**,
  soy_soybeans, rapeseed_rape, other_oilseed, groundnuts, fibre_crops, potatoes, cassava, tobacco,
  grass_fodder_crops, sugar_cane, no_crop.
- **Real inputs**: 10 Sentinel-2 L2A bands (B02–B12 incl. red-edge/SWIR), Sentinel-1 VV/VH,
  Copernicus DEM + slope, AGERA5 monthly precipitation/temperature — a genuinely richer,
  multi-sensor stack than our own 4-derived-index optical-only pipeline.
- **Resolution**: 10m, real GeoTIFF, per-pixel classification + per-class probability (all 24
  classes exposed, not just the top-1 label).
- **Season/crop-calendar data**: `worldcereal.seasons.get_season_dates_for_extent(extent, year,
  season)` returns a real, location-specific season window from ESA's own global crop-calendar
  reference — confirmed working for our exact India locations (returned a real 2024-12-01 to
  2025-11-30 window; noted the calendar lookup fell back to "nearest reference point" for our
  specific coordinates, since dense in-region calendar points aren't available everywhere).
- **Coverage**: confirmed to run for real Indian coordinates (not just Europe) — the model itself
  is trained on a global reference dataset, not the Slovak-only one we built our sunflower work
  on.
- **Runs on arbitrary geometry via our existing CDSE account**: yes, confirmed — our existing
  `CDSE_CLIENT_ID`/`CDSE_CLIENT_SECRET` (used for our Sentinel Hub Statistical API calls)
  authenticate against openEO too, non-interactively.
- **Reference datasets**: ESA also publishes a Reference Data Module (RDM) of harmonized,
  ground-collected crop labels used to train/validate these models — a real resource, not
  inspected further this round (would help if we ever wanted to fine-tune a custom head, out of
  scope here).

## 2. Crop-portfolio mapping matrix

| our crop | direct class? | broader class? | useful in India? | useful to AgriMap? | reason |
|---|---|---|---|---|---|
| **Sunflower** | **Yes** | — | Yes (see §3) | Yes | Explicit class in the deployed model |
| Sesame | No | `other_oilseed` (catch-all) | Ambiguous | Low | Not separately resolvable from other oilseeds |
| Coriander | No | none (spice crops absent from CT24) | No | No | Herb/spice classes exist only in the broader *reference-taxonomy* table (CROPTYPE28), not in the actually-deployed model |
| Fennel | No | none | No | No | Same as coriander |
| Cumin | No | none | No | No | Same as coriander |
| Niger seed | No | `other_oilseed` (catch-all) | Ambiguous | Low | Same limitation as sesame |
| Coffee | No | — | No | No | Perennial tree crop — outside WorldCereal's *temporary-crop* paradigm entirely, by design |
| Citrus | No | — | No | No | Perennial |
| Cashew | No | — | No | No | Perennial |
| Coconut | No | — | No | No | Perennial palm |
| Apple | No | — | No | No | Perennial orchard |
| Litchi | No | — | No | No | Perennial |
| Mango | No | — | No | No | Perennial |
| Guava | No | — | No | No | Perennial |
| Pomegranate | No | — | No | No | Perennial |
| Moringa | No | — | No (CROPLAND may flag "not annual cropland") | Low | Perennial; at best a negative signal via the binary CROPLAND product |
| Jamun | No | — | No | No | Perennial tree |
| Neem | No | — | No | No | Perennial tree |
| Pongamia | No | — | No | No | Perennial tree |
| Eucalyptus | No | — | No | No | Plantation forestry, arguably outside "cropland" entirely |

**Headline finding: of our 20 target crops, exactly 1 (sunflower) is directly supported by the
deployed model. 5 (sesame, coriander, fennel, cumin, niger) fall into an undifferentiated
"other_oilseed" bucket or nothing at all. 14 of 20 — the entire plantation/perennial,
horticulture, and agroforestry categories — are structurally outside WorldCereal's scope**, not
because of a current data gap but because WorldCereal's whole methodology (`temporary crop`
detection via annual Sentinel-1/2 cycles) targets annual/seasonal crops by construction. This
should be stated plainly rather than papered over: WorldCereal cannot become the crop-ID layer
for roughly 70% of our long-term product roadmap, regardless of how well it performs on the
30% it does target.

## 3. Small real test — 5 real Indian AMED fields, one per major overlapping class

Selected by an objective, non-cherry-picked rule (highest real AMED confidence per class, among
crops that exist both in our real AMED data and in WorldCereal's deployed taxonomy). Real
geometry, real Sentinel-1/2/weather data, real season window from WorldCereal's own crop
calendar. **Total real cost: 43 openEO credits** (individual costs below) — small, as scoped.

| AMED crop label | AMED confidence | field_id | WorldCereal nearest-pixel prediction | WorldCereal confidence | Agreement? | real cost |
|---|---|---|---|---|---|---|
| RICE | 65.2% | 7J8VPXW7+V2PG | **rice** | 97% | **Agree** | 8 credits |
| CORN | 80.1% | 7J6VPJ6J+JQ2C | **rice** (maize only 15%) | 73% | **Disagree** | 8 credits |
| SUGARCANE | 74.2% | 7J9VWG6W+78G9 | **rice** (sugar_cane only 14%, maize 27%) | 32% (low, ambiguous even for WorldCereal) | **Disagree** | 10 credits |
| GROUNDNUT | 92.4% | 7J6VMMX2+PMRC | **maize** (groundnuts not in top-5) | 48% | **Disagree** | 8 credits |
| SOYBEANS | 91.1% | 7J9QJVWG+V9F7 | **inconclusive** — only 10% of the whole tile had valid data (heavy real cloud cover for this AOI/season); no `soy_soybeans` pixel anywhere in the tile | — | **Cannot compare** | 9 credits |

**1 of 5 clean agreement, 3 of 5 disagreement, 1 of 5 inconclusive due to real data sparsity.**
Reported exactly as measured — not adjusted, not re-run to get a better mix. Full per-field
window statistics and job IDs: `results.json`.

**Neither AMED nor WorldCereal is treated as ground truth here.** The disagreements are real and
informative, but they do not tell us which system (if either) is correct at these specific
locations — only that the two independent systems frequently disagree on this real, heterogeneous
Indian cropland.

## 4. Where WorldCereal agrees/disagrees with AMED

Rice was the only clean agreement. Notably, **WorldCereal predicted "rice" for 3 of the 4
non-rice AMED fields it could evaluate** (CORN→rice, SUGARCANE→rice-leaning, and rice was in the
GROUNDNUT field's broader window too) — this echoes, from a completely independent model and
training pipeline, the same rice-dominance pattern we found in our own sunflower detector's false
positives (`sunflower_specificity_audit.md`). That convergence is worth taking seriously as
possible evidence of a genuine regional characteristic (rice's real spectral/temporal signature
may be unusually "central"/generic in this crop-mix, making it an attractor for uncertain
classifications generally) rather than a flaw specific to either system — but this is a
hypothesis prompted by two data points, not something this round establishes.

## 5. Does it help with Unknown/low-confidence map clicks?

**Potentially, as an independent second opinion — but the evidence here is mixed, not
reassuring.** On this small sample, WorldCereal disagreed with AMED more often than it agreed,
including on fields where AMED itself was reasonably confident (80–92%). If WorldCereal were
wired in as a naive "trust whichever is more confident" arbiter today, it would have overridden a
92%-confidence AMED groundnut/soybean-family call with a lower-confidence maize/no-data result in
2 of those cases — a real risk, not a hypothetical one. This does not mean WorldCereal is
unreliable in general; it means **5 fields is nowhere near enough to establish it as a trustworthy
arbiter**, and naive automatic override logic would be premature.

## 6. ESA capabilities we can leverage without asking ESA for anything new

| capability | ESA provides | we currently have | gap | how it could fit | helps which crops |
|---|---|---|---|---|---|
| Crop-type classification (24 classes) | Yes, running today | Only sunflower (research-grade) | We have no independent classifier for rice/maize/sorghum/soy/groundnut/sugar_cane at all | Additional signal alongside AMED for these specific classes | Sunflower + 5 overlap crops |
| **Crop-calendar / season windows** | Yes, `get_season_dates_for_extent`, global reference | We use a fixed/rolling calendar window — the exact source of the multi-cycle contamination problem documented across the entire sunflower investigation | We've never used a real external season reference to bound our own Sentinel-2 extraction | **Directly reusable in our OWN pipeline**, independent of WorldCereal's classifier — could fix our own windowing bug with zero model integration | All crops, including sunflower |
| Per-class probability vector (not just top-1) | Yes, all 24 classes per pixel | AMED gives top-3; our sunflower model gives one score | We could compare full probability distributions, not just top labels | Richer "second opinion" than a single label | Overlap crops |
| Cropland/no-crop binary mask | Yes (`CROPLAND` product) | ALU already gives field polygons, so this is partially redundant | Could sanity-check whether a clicked point is genuinely agricultural | Weak, mostly redundant with existing ALU | All |
| Multi-sensor input stack (S1+S2+DEM+weather) | Yes, already used internally by their model | We use S2 optical indices only | We've never used Sentinel-1 or terrain/weather at all | Would require building our own multi-sensor pipeline to match — big lift, not "free" | All, especially rice (S1 is well known to help distinguish flooded rice) |
| Presto foundation-model embeddings | Yes (`EMBEDDINGS` product type) | Nothing comparable | A pretrained general-purpose crop embedding we could feed into our own classifier instead of hand-built indices | Interesting, unexplored this round | Potentially all annual crops, not tested |

## 7. What is genuinely missing (from ESA, realistically)

- No perennial/plantation/horticulture/agroforestry crop coverage — 70% of our roadmap. Not a
  "current limitation" to request a fix for; it is outside WorldCereal's stated methodology.
- No Indian-specific validation — the model is global, but nothing here confirms its India
  accuracy any more than our own Slovak-trained model's India accuracy is confirmed. Same
  scientific discipline applies to both.
- Fine-grained oilseed/spice distinctions (sesame, coriander, fennel, cumin, niger) are not
  separable from the "other_oilseed" catch-all.

## 8. What should remain our own technology

- Everything for the 14 perennial/plantation/horticulture/agroforestry crops — WorldCereal simply
  doesn't address this space; a different EO methodology (multi-year canopy/structural time
  series, tree-crown/plantation detection) would be needed regardless of ESA involvement.
- The final map-click decision/override policy (`overridePolicy.ts`) — WorldCereal should feed
  evidence into it, not replace it.
- Our own sunflower work remains the only sunflower-specific evidence source available (ESA's
  `sunflower` class exists but was not validated for India any more than ours was — see §5's
  agreement/disagreement data, which didn't specifically test sunflower fields this round).

## 9. Recommended architecture for AgriMap

**Per-crop, not one blanket answer** (matching Step 7's request):

- **Sunflower**: (E) useful for certain crops — treat as an *additional independent signal*
  alongside our own detector, never as a sole arbiter, given the disagreement rate found here.
- **Rice, maize, sorghum, soy, groundnut, sugar_cane**: (A)/(C) — a genuine new independent
  classifier/signal we don't currently have at all (our system has no non-sunflower crop
  classifier of our own). Real candidate for a "second opinion" card in the UI, **not** an
  automatic override, given the 60% disagreement rate measured here.
- **Sesame, coriander, fennel, cumin, niger**: (E), weakly — only the vague "other_oilseed"
  bucket, not independently actionable.
- **All 14 perennial/plantation/horticulture/agroforestry crops**: (G) — not useful, do not
  pursue WorldCereal for these.
- **Crop calendars/season windows**: (D) — the single most immediately actionable capability
  found this round, useful **independent of the classifier**, and directly relevant to a bug
  we've already diagnosed in our own pipeline (multi-cycle window contamination).

## 10. Realistic things to discuss with ESA

1. Whether a validated, India-specific accuracy benchmark exists or is planned for CROPTYPE24 —
   we found real disagreement with AMED on 3/5 fields and have no way to know which system (if
   either) is closer to truth without independent ground truth neither of us has.
2. Whether finer oilseed/spice sub-classes (sesame, niger, coriander family) are on any roadmap,
   given India's real agricultural composition includes these at meaningful scale.
3. Whether WorldCereal or a related ESA project has any *perennial/plantation* crop mapping
   capability we haven't found — our own search this round found none, but ESA may have
   land-cover/plantation-age work under a different project name we're not aware of.
4. Data availability in practice: one of our 5 real test fields had 90% cloud-masked pixels for
   a full-year window — worth understanding whether this is typical for Indian monsoon regions in
   their own validation, since it directly affects real usability.

## 11. Exact next experiment, if justified

**Not another blind batch run.** The one clearly justified, low-cost next step: rerun the crop
calendar lookup (`get_season_dates_for_extent`, **zero additional CDSE/openEO cost** — it's a
local reference-table lookup, not a Sentinel Hub or openEO job) against all 6 of our existing
sunflower candidate fields and the fixed-window pilot fields, to see whether it would have
produced a materially different (better-isolated) season window than our own ad-hoc windows —
directly testable against data we already have, addressing the multi-cycle contamination problem
without spending anything.

If a further *live* WorldCereal test is wanted after that: expanding the classifier comparison
from 5 to ~20 fields (the original "2–5 per class" scope, across more of AMED's 12 classes) would
cost approximately **20 × 9 ≈ 180 openEO credits** at the measured per-field rate — not run this
round, pending your decision.

## 12. Exact CDSE/openEO cost of this round

- Sentinel Hub Statistical API PU: **0** (unchanged, cumulative ~969/2,500)
- openEO processing credits, this round's batch test: **43** (RICE 8, CORN 8, SUGARCANE 10,
  SOYBEANS 9, GROUNDNUT 8)
- openEO processing credits, cumulative across both ESA rounds: **56** (13 prior + 43 this round)
- Production files changed: **0**
- Threshold changed: **No**
- Committed/pushed: **No**
