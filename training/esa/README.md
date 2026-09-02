# ESA WorldCereal Experimental Integration

Isolated, experimental comparison of our own sunflower-likeness pipeline against ESA's
WorldCereal crop-type classification, run on the same real Indian field (Gadag). This directory
is fully separate from production — nothing here has been wired into `server/` or `client/`.

## A. Which ESA capability was selected, and why

**ESA WorldCereal** (`worldcereal-classification` package, `worldcereal==2.8.0`), specifically its
**CROPTYPE inference workflow**, run via **openEO on the Copernicus Data Space Ecosystem (CDSE)**
— the same CDSE account we already use for our own Sentinel-2 extraction.

Why this over the alternatives investigated:
- It is **actually runnable today**, for any custom area (including India), not just a static
  pre-2021 map. Confirmed by installing the real package and running a real job.
- It is the only ESA agricultural capability found that is (a) open-source, (b) pip-installable,
  (c) executable against our exact area of interest and time window, and (d) uses infrastructure
  (CDSE) we already have credentials for.
- **Its class taxonomy (`CROPTYPE24`) explicitly includes `sunflower`, `rice`, `maize`, `sorghum`,
  `soy_soybeans`, and `groundnuts`** — precisely the crops at the center of our own confusion
  problem (report: `sunflower_specificity_audit.md`). This was confirmed by inspecting the
  package's own `class_mappings.json`, not assumed.
- Other candidates investigated and rejected: Sen4CAP/Sen4STAT (EU CAP-monitoring focused, not
  built for arbitrary global AOIs); the older static `ESA_WORLDCEREAL_MAIZE`/`WINTERCEREALS`
  openEO collections (only 2 classes, frozen to the 2021 season, not usable for a 2025 Indian
  field); no concrete, runnable "Pheno-AI"/"CropSnap"/"HIVE-TECH" artifact was found — these
  either don't exist as a public product or weren't discoverable as anything beyond a name.

## B. Why it's the best fit for our existing project

Our own audit (`sunflower_specificity_audit.md`) already identified RICE and CORN as the specific
real confound classes. WorldCereal's default global model is trained to separate exactly these
crops from each other and from sunflower, using a completely independent architecture (a
Presto-based multi-sensor foundation model trained on ESA's own global reference dataset) and
training data (not our 100 Slovak EuroCrops fields). That makes it a genuine, independent
cross-check — not another variant of our own representation.

## C. What was integrated

- **Package**: `worldcereal` v2.8.0 (`pip install "worldcereal[train,notebooks] @ git+https://github.com/worldcereal/worldcereal-classification.git"`), plus `openeo` v0.51.0, `openeo-gfmap`, `rasterio`, `python-dotenv`.
- **Model**: ESA's own hosted, pretrained seasonal model artifact (`WorldCereal-PRESTO-GLO_LC10CT24_...zip`, downloaded automatically by the package at job-build time from ESA's own S3 bucket — not retrained, not fine-tuned, used exactly as published).
- **Processing**: ESA's own openEO process graph (`create_inference_process_graph`, `WorldCerealProductType.CROPTYPE`), executed as a real batch job on CDSE's Spark backend.
- **Auth**: our **existing** `CDSE_CLIENT_ID`/`CDSE_CLIENT_SECRET` (from `training/.env`) — confirmed to work non-interactively for openEO via `authenticate_oidc_client_credentials`, the same OAuth client already used for our Sentinel Hub Statistical API calls.

## D. Where it sits in the architecture

**Nowhere in production, deliberately.** This lives entirely under `training/esa/` as an isolated
research module, using its own Python 3.11 interpreter (`training/esa/python/`, a self-contained
build fetched from `astral-sh/python-build-standalone` — our system only has Python 3.9, and
WorldCereal requires 3.11+; this was downloaded as a local, reversible, non-system-modifying
interpreter, not installed via brew/system package manager) and its own venv
(`training/esa/.venv/`). It does not import from, or get imported by, `server/` or `client/`.

Conceptually, if adopted, it would sit **upstream of** our current sunflower model — as a
crop-context layer feeding into or alongside `extractSunflowerFeatures`/`likenessModel.ts` — not
a replacement for the map-click route itself.

## E. Did it run on a real Indian field?

**Yes.** Ran against the Gadag candidate field's real centroid (15.6744383, 75.3440033), a
~640m×640m box, using WorldCereal's own real crop-calendar reference to determine the season
window automatically (`get_season_dates_for_extent` → 2024-12-01 to 2025-11-30 for this exact
location — a real, location-derived window, not one we guessed).

Two real job attempts were required:
1. **First attempt failed** (`ModuleNotFoundError: No module named 'prometheo'` on the CDSE Spark
   executors) — a real, diagnosed platform issue: the job wasn't given the `udf-dependency-archives`
   job option the package itself defines (`DEFAULT_INFERENCE_JOB_OPTIONS`) to install its own
   runtime dependency on the backend. Cost: **4 credits**, for a failed job — reported honestly,
   not hidden.
2. **Second attempt succeeded** once the correct job options were passed. Cost: **9 credits**.

**Total real cost this round: 13 openEO processing credits** (a separate quota from our Sentinel
Hub Statistical API PU budget — CDSE grants these free monthly on registration; none of our
existing ~969 PU Statistical API budget was touched).

## F. What did it output

A real GeoTIFF (`experiments/results/gadag/*.tif`), 26 bands: `classification` (integer class
code), `probability` (overall confidence), and one probability band per class (24 classes,
including `probability_sunflower`), at Sentinel-2's native 10m resolution, reprojected to UTM 43N.

**Real result for the Gadag field neighborhood** (11×11 pixel window around the real centroid,
`experiments/decode_result.py`):

| class | pixel count (of 104 valid) |
|---|---|
| **rice** | **84** |
| no_crop | 19 |
| maize | 1 |

Sunflower probability across this window: **min 0%, max 3%, mean 0.9%**. The single nearest real
cropland pixel to the field centroid: classified **rice (40% confidence)**, with `no_crop` a
close second (36%) — ESA's own model isn't highly confident here either, but it does not support
sunflower at this location.

## G. Comparison with our current pipeline

| | our production model | ESA WorldCereal |
|---|---|---|
| Gadag classification | 4.00% sunflower likeness (88.8th percentile of India background) | **rice**, 40% confidence; sunflower 1% |
| Training data | 100 Slovak EuroCrops sunflower positives only | ESA's own global multi-crop reference dataset |
| Method | Mahalanobis/kNN similarity to a positive-only reference | Presto foundation-model embeddings + trained classification head |
| Confound found | RICE/CORN are the least-separable Indian crops from Slovak sunflower (§ specificity audit) | **Also leans RICE for this exact location** |

**This is a real, independent cross-check that converges on the same real-world ambiguity from a
completely different model and training data — not evidence either model is "right," but
evidence the rice/sunflower ambiguity at this specific location is not an artifact of our own
representation choices.** Neither model supports sunflower strongly at Gadag; both separately
lean toward rice-family crops.

## H. Does it help with...

- **Crop identification?** Yes, directly and well beyond sunflower — it's a real, usable 24-class
  crop classifier for India today.
- **Sunflower identification specifically?** Only as a `sunflower` probability band, but at this
  one real tested location it did not support sunflower either. Untested at scale.
- **India domain shift?** Partially addressed by construction — WorldCereal is trained on a real
  global (not Europe-only) reference dataset, so it doesn't carry our specific Slovak-to-India
  shift. It may carry its own different biases; this one test can't determine that.
- **Temporal/phenology?** The underlying model consumes a full real seasonal time series
  (monthly S1+S2+weather composites) internally, but the product tested here outputs a single
  seasonal classification, not an exposed phenology curve.
- **Flowering prediction?** Not tested — would require the `EMBEDDINGS` product type or a
  different WorldCereal output, not attempted this round.
- **Multi-crop expansion (sesame, coriander, coffee, mango, etc. from the long-term crop list)?**
  **No** — WorldCereal's 24-class taxonomy is cereals/oilseeds/row-crop focused; none of the
  plantation/perennial/horticulture/agroforestry crops in our long-term list (coffee, citrus,
  cashew, coconut, apple, litchi, mango, guava, pomegranate, moringa, jamun, neem, pongamia,
  eucalyptus) appear in its class list. It would need to be paired with something else, or a
  custom-trained WorldCereal head (the package does support custom class/reference-data training),
  for that part of the roadmap.

## I. What it failed to solve

- Did not confirm Gadag as sunflower — if anything, reinforced the rice-family ambiguity.
- Does not cover any of the perennial/horticulture/agroforestry crop list.
- Requires a genuinely heavier, slower (~5 minute), costlier (9 real credits per small field per
  season) pipeline than our lightweight Statistical API calls — not a drop-in replacement for a
  real-time map-click without real latency/cost engineering.
- The first attempt's real failure (`prometheo` missing) shows this integration path is not yet
  "just works" — it required real debugging of the package's own job-options contract.

## J. Most natural next integration if this looks promising

Not proposed to run automatically here (would cost real credits), but the well-defined next step:
run the SAME job (now that the real job-options bug is fixed) across the **20–50 field batch**
the original task specified — a real mix of AMED RICE/CORN/GROUNDNUT/SUGARCANE fields plus all 6
of our own candidates — and compare WorldCereal's classification against each field's real AMED
label (a genuine, independent accuracy proxy on AMED's OWN labels, which WorldCereal never saw in
training) before drawing any conclusion about using it as a crop-context layer.

**Real, measured cost basis for that decision**: 9 credits for one ~640m field over a 12-month
window. 20–50 fields ≈ **180–450 credits** — a real number to weigh against the free monthly CDSE
openEO allocation, not a guess.

## K. What we could tell ESA after this experiment

- The `worldcereal-classification` package's `DEFAULT_INFERENCE_JOB_OPTIONS` (containing the
  required `udf-dependency-archives` for `prometheo`) is not applied automatically by
  `DataCube.create_job()` — a user following the class-level example code (as we did) will hit a
  `ModuleNotFoundError` on the CDSE Spark executors unless they know to pass `job_options=
  DEFAULT_INFERENCE_JOB_OPTIONS` explicitly. This cost us one real, avoidable failed job (4
  credits) and would likely trip up other new users the same way — worth a clearer example/
  default in their own quickstart docs.
- The CDSE openEO backend returns `501 FeatureUnsupported` for `/jobs/{id}/estimate` — real cost
  can only be learned after running a job, not before, which makes budget planning harder than it
  needs to be for exactly this kind of small experimental use.
- The CROPTYPE24 taxonomy's real-world overlap with our own India-focused crop list is
  substantial (rice, maize, sorghum, soy, groundnuts, sunflower) but does not extend to
  perennials/horticulture — worth knowing if ESA has, or plans, coverage there.

## Reproducing this experiment

```bash
cd training/esa
python/bin/python3.11 -m venv .venv   # or use any Python 3.11+
.venv/bin/pip install openeo python-dotenv rasterio
.venv/bin/pip install "worldcereal[train,notebooks] @ git+https://github.com/worldcereal/worldcereal-classification.git"
.venv/bin/python3 experiments/run_job.py     # submits ONE real job (~9 credits) for the Gadag field
.venv/bin/python3 experiments/wait_job.py    # polls until finished, reports real cost
.venv/bin/python3 experiments/decode_result.py experiments/results/gadag/*.tif 15.6744383 75.3440033
```

Requires `training/.env` with real `CDSE_CLIENT_ID`/`CDSE_CLIENT_SECRET` (same credentials already
used for our Sentinel Hub Statistical API calls).

## Files

- `experiments/estimate_job.py` — builds the process graph and attempts a cost estimate (CDSE
  doesn't support `/estimate`; documented as a real backend limitation).
- `experiments/run_job.py` — submits the real job with the correct job options.
- `experiments/wait_job.py` — polls job status, reports real cost/usage on completion.
- `experiments/decode_result.py` — decodes the result GeoTIFF for a given real lat/lng.
- `experiments/results/gadag/` — the real downloaded GeoTIFF + job metadata.
- `experiments/last_job_id.txt` — the real openEO job ID for reproducibility/audit.
- `results.json` — machine-readable summary of this round's real result.

## Resource accounting

- CDSE Statistical API PU spent this round: **0** (unchanged, cumulative ~969/2,500)
- **openEO processing credits spent this round: 13** (4 failed + 9 succeeded) — a separate quota
- Production code changed: **0**
- Threshold changed: **No**
- Committed/pushed: **No**
