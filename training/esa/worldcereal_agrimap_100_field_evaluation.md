# ESA WorldCereal × AgriMap: Engineering/Product Evaluation

**Status: Part A (map-click integration) complete and verified. Part B (100-field comparison)
methodology is frozen and ready to run, but execution is PAUSED pending explicit cost approval —
see §15. Do not read §§9-14 as final; they will be filled in with real results once Part B runs.**

No production code, threshold, or UI was changed. Nothing was committed or pushed. The custom
Sunflower model and AMED are untouched.

---

## 1. Executive summary

WorldCereal's live CROPTYPE24 inference model (openEO/CDSE) is now **technically wired into
AgriMap** as an isolated, feature-flagged research integration (`ENABLE_WORLDCEREAL_RESEARCH`):
a map click can trigger a real WorldCereal job, poll it, decode its result, and compare it against
AMED — without ever touching the production AMED decision path. This was built and verified
end-to-end against a real, already-paid-for job (Kurukshetra) at zero additional cost.

Two structural findings hold regardless of Part B's eventual numbers:

- **WorldCereal directly names only 1 of AgriMap's 20 target crops** (sunflower). 5 more
  (sesame, coriander, fennel, cumin, niger) fall under a broad `other_oilseed` bucket with no
  crop-specific signal. The remaining 14 — every plantation tree, perennial, and horticulture
  crop in AgriMap's portfolio — are structurally out of scope: WorldCereal's CROPTYPE model is
  built for annual/temporary crops and explicitly does not classify trees or perennials. See §4.
- **Every real job takes 5-15 minutes and costs 8-17 openEO credits** (measured across 9 real
  jobs so far). Synchronous "call WorldCereal on click" is not viable at any crop coverage level.
  See §6.

Whether WorldCereal is a *useful independent signal for AMED's existing annual-crop coverage*
(rice, corn, sugarcane, etc. — not the 20 target crops) is what Part B is designed to answer, and
that answer isn't in yet. The 3 real single-field tests run before this phase (Gadag, Siddipet,
Kurukshetra — see `sunflower_two_region_test.md`, `worldcereal_agrimap_evaluation.md`) showed
weak/no sunflower signal and one real infrastructure failure; they are too few and too
sunflower-specific to answer the broader question Part B asks.

## 2. How WorldCereal actually works in our integration

Real, verified mechanics (not assumed from docs):

- **Model**: `worldcereal==2.8.0`'s CROPTYPE24 inference model, run as a real openEO batch job
  on CDSE's Spark backend. Not the static 2021 product (see §3) — there is no free/pre-computed
  path to any of AgriMap's crops of interest.
- **Auth**: OAuth2 client-credentials against `identity.dataspace.copernicus.eu`, same
  `CDSE_CLIENT_ID`/`CDSE_CLIENT_SECRET` already used for the Sentinel Hub Statistical API. Real,
  confirmed quirk: openEO rejects the plain bearer token that works for Statistical API calls —
  it requires `scope=openid` on the token request AND a `Bearer oidc/CDSE/<token>` header format,
  neither of which is documented anywhere obvious; found by testing against the real API.
- **Process graph**: captured once, for real, from the Python SDK
  (`worldcereal.job.create_inference_process_graph` → `cube.flat_graph()`, zero cost — building a
  graph is local, only running one bills credits) and re-submitted via plain REST from
  TypeScript. Verified for real: a job built entirely from the captured template was created via
  raw REST (201 Created), confirmed, then deleted without starting it (also zero cost).
- **Spatial/temporal parameterization**: the graph's `filter_bbox` node carries the exact bbox;
  temporal extent is set on 3-4 `load_collection`/`load_stac` nodes. Both are swapped per field
  before submission — see `openeoClient.ts`.
- **Season window**: every real Indian location queried so far (Gadag, the 5-field batch,
  Siddipet, Kurukshetra) logged *"No crop-calendar lookup points found inside extent; falling
  back to nearest point"* and resolved to the identical `2024-12-01..2025-11-30` window. WorldCereal
  has no dense Indian crop-calendar reference yet, so the integration uses this as a fixed
  default rather than re-deriving it per field (see `config.ts`) — cheaper and, on current
  evidence, identical to what the real per-field lookup would return anyway.
- **Output**: a 26-band GeoTIFF (classification, overall probability, 24 per-class
  probabilities), 10m resolution, reprojected to the local UTM zone, one job per field/area.
- **Decoding**: the pure-JS `geotiff` npm package (v3.0.5, current latest) **fails to parse these
  real files** — its IFD tag parser resolves zero fields for this real GDAL/openEO-generated
  multi-band uint8 layout (confirmed against the real Kurukshetra output, not a config mistake on
  our side). Decoding therefore shells out to a small Python script
  (`training/esa/experiments/decode_for_node.py`, `rasterio`-backed) — the one place the
  TypeScript integration still depends on the local `training/esa/.venv`. See §21.

## 3. What WorldCereal supports today (vs. what's coming)

Checked directly against ESA's own product page, not assumed:

- **Released today**: only the **2021** static product — temporary-crop extent, maize, winter
  cereals, spring cereals, active cropland, active irrigation. **No sunflower layer, no
  crop-type layer beyond maize/cereals, at all.** Confirmed empty for our purposes before
  spending any credits.
- **The live CROPTYPE24 inference model** (what this whole evaluation uses) is not a "product" in
  the above sense — it's the processing system, runnable for any area/time via openEO, and it's
  the only real path to a sunflower (or any non-cereal crop-type) answer for India today.
- **Stated 2026 plan** (esa-worldcereal.org, quoted directly): *"Currently, our product
  collection contains data for 2021, but more products will be added by the end of 2026."* No
  specific year, region, or crop list is committed yet for that update, beyond ESA's stated
  intent to fully open the cloud processing system for arbitrary areas/years — which is
  functionally the capability this integration already exercises. **There is nothing to wait
  for**: the live inference model we're already using is the most current real capability, not a
  preview of something better arriving later.

## 4. Our 20-crop coverage matrix

| AgriMap crop | Direct WorldCereal CROPTYPE24 class? | Broader class? | Usable as 2nd opinion? | Recommended role |
|---|---|---|---|---|
| Sunflower | **Yes** (`sunflower`) | — | Yes, but weak so far (real tests: 0-3% max probability at 3 real Indian sites) | Independent secondary signal only — do not weight highly yet |
| Sesame | No | `other_oilseed` (no crop-specific signal) | No | Not covered |
| Coriander | No | — (spice, not in CROPTYPE24 at all) | No | Not covered |
| Fennel | No | — | No | Not covered |
| Cumin | No | — | No | Not covered |
| Niger seed | No | `other_oilseed` (loose) | No | Not covered |
| Coffee | No | — (perennial, out of model scope) | No | Not covered — structural |
| Citrus | No | — | No | Not covered — structural |
| Cashew | No | — | No | Not covered — structural |
| Coconut | No | — | No | Not covered — structural |
| Apple | No | — | No | Not covered — structural |
| Litchi | No | — | No | Not covered — structural |
| Mango | No | — | No | Not covered — structural |
| Guava | No | — | No | Not covered — structural |
| Pomegranate | No | — | No | Not covered — structural |
| Moringa | No | — | No | Not covered — structural |
| Jamun | No | — | No | Not covered — structural |
| Neem | No | — | No | Not covered — structural |
| Pongamia | No | — | No | Not covered — structural |
| Eucalyptus | No | — | No | Not covered — structural |

**1/20 direct, 5/20 loosely bucketed with no crop-specific resolution, 14/20 structurally
unsupported.** WorldCereal's CROPTYPE model targets temporary/annual crops by design — it is not
a gap that a future release is likely to close; it's a scope boundary. Every perennial/plantation/
horticulture/agroforestry crop in AgriMap's target list needs a different data source regardless
of Part B's outcome.

*(A separate, real matrix for AMED's own already-covered annual crops — rice, corn, sugarcane,
cotton, sorghum, etc. — is what Part B directly measures; those are not AgriMap's "target"
portfolio but are where WorldCereal could plausibly add value. See §7-8, pending.)*

## 5. How the map-click integration works technically

Isolated code, `ENABLE_WORLDCEREAL_RESEARCH=true` only, never imported by
`agriculturalController.ts`:

```
server/src/services/agricultural/worldcereal/
  types.ts              WorldCerealResult, comparison types, real CROPTYPE24 class list
  config.ts             feature flag, fixed India season window, bbox buffer
  processGraphTemplate.json   the real captured process graph (41 nodes)
  openeoClient.ts        pure REST: auth, submit, poll, download (no Python)
  geotiffDecoder.ts       decode via subprocess to decode_for_node.py (Python/rasterio)
  jobStore.ts             file-based cache keyed by S2 Level-13 cell token
  worldCerealService.ts   orchestrates: cache check -> submit or reuse -> poll -> decode -> cache
  consensus.ts            AMED-vs-WorldCereal comparison, advisory only, never overrides

server/src/controllers/worldCerealResearchController.ts
server/src/routes/worldcerealResearch.ts   mounted at /research/worldcereal, 404s if flag is off
```

Flow: `POST /research/worldcereal/trigger {lat, lng}` → real S2 cell token computed → if a job
already ran for this cell, returns it (no new credits); otherwise submits a real job and returns
its ID immediately (not synchronous). `GET /research/worldcereal/result?lat=&lng=&amedCropLabel=&amedConfidence=`
polls the real job; once finished, downloads the result once, decodes it, caches the decoded
result permanently, and returns a plain `WorldCerealAmedComparison` — one of `agreement`,
`disagreement`, `second_opinion`, `insufficient_worldcereal_data`, or `worldcereal_unavailable`.
AMED's own result is passed in by the caller and is never fetched, modified, or overridden here.

## 6. Live integration: latency and operational behavior (real, measured)

All 9 real jobs run in this project so far:

| job | status | credits | duration | input megapixels |
|---|---|---|---|---|
| Gadag (attempt 1) | error (fixed bug, see README) | 4 | — | — |
| Gadag (attempt 2) | finished | 9 | 298s (5.0 min) | 17.5 |
| RICE (batch) | finished | 8 | 346s (5.8 min) | 18.3 |
| CORN (batch) | finished | 8 | 346s (5.8 min) | 17.6 |
| SUGARCANE (batch) | finished | 10 | 611s (10.2 min) | 21.9 |
| SOYBEANS (batch) | finished | 9 | 915s (15.3 min) | 18.6 |
| GROUNDNUT (batch) | finished | 8 | 923s (15.4 min) | 17.6 |
| Siddipet | error (real CDSE-side DNS failure) | 9 | 458s (7.6 min) | — |
| Kurukshetra | finished | 17 | 695s (11.6 min) | 20.0 |

7 successful jobs: **mean 590s (9.8 min), min 298s, max 923s** — no job has ever finished in
under 5 minutes, several took 15+. Real per-job cost: **mean 9.9 credits, median 9, range 8-17**.
2 of 9 real attempts (22%) failed outright and still consumed credits (4 and 9).

**This settles the A/B/C/D architecture question on measured evidence, not assumption**: (A)
synchronous on-click processing is not viable at any scale — no user waits 5-15 minutes for a
field click, and a ~20% real failure rate means a meaningful fraction of clicks would simply
error out. The implementation therefore uses **(C) background job + cache**: a click triggers (or
reuses) a job asynchronously; the result is served once ready and cached indefinitely per S2 cell
so a field is never reprocessed. This was end-to-end verified for real: the already-finished,
already-paid Kurukshetra job was fetched and decoded through the full pipeline in ~6.5s (download
+ decode), and a second request for the same cell returned in 9ms from cache — zero additional
credits spent on either call.

A pure "(B) fallback for AMED Unknown/low-confidence only" or "(D) fully precomputed batch"
posture are both compatible with this same code — the trigger step can be restricted to only
Unknown/low-confidence fields, or run as an offline batch ahead of time — but that's a policy
choice on top of the same underlying async+cache mechanism, not a different mechanism. See §18
for the recommendation once Part B's numbers are in.

## 7. 100-field dataset composition

Inspected before selecting anything: `training/data/pilot/amed_negative_manifest.jsonl` — 250
real Indian AMED fields (field_id, region, district, crop_label, amed_confidence, season, year,
full polygon geometry), originally assembled as the sunflower project's real
"confirmed-not-sunflower" background population. Real composition:

| crop | n (of 250) | confidence range | mean |
|---|---|---|---|
| SUGARCANE | 56 | 0.185–0.738 | 0.480 |
| SORGHUM | 46 | 0.124–0.894 | 0.463 |
| RICE | 42 | 0.160–0.639 | 0.506 |
| COTTON | 37 | 0.173–0.660 | 0.388 |
| CORN | 22 | 0.163–0.729 | 0.407 |
| GROUNDNUT | 17 | 0.231–0.759 | 0.410 |
| SOYBEANS | 13 | 0.205–0.752 | 0.464 |
| GRAM | 8 | 0.251–0.706 | 0.520 |
| CHILLI | 6 | 0.343–0.589 | 0.426 |
| MUSTARD | 1 | 0.268 | — |
| WHEAT | 1 | 0.475 | — |
| BAJRA | 1 | 0.194 | — |

- **Regions**: Karnataka 133, Andhra Pradesh 57, Maharashtra 45, Telangana 15.
- **Confidence distribution**: <0.30 → 54 fields, 0.30-0.49 → 96, 0.50-0.69 → 77, 0.70-0.84 → 21,
  ≥0.85 → 2. Overall mean 0.454, median 0.437.
- **Unknown-labeled fields: zero.** This manifest was built by filtering to confirmed
  crop-labeled AMED negatives for the sunflower project, so it contains no genuine "AMED
  returned Unknown" fields — an honest gap, not something papered over. The **<0.30-confidence
  bucket (54 real fields)** is used as the closest available proxy for "AMED is uncertain here,"
  and is deliberately over-represented in the selection below. See §21 for what a true
  Unknown-fields test would require.
- **Field sizes / Sentinel observation availability**: not separately re-derived here — every
  field in this manifest already has a confirmed real Sentinel-2 extraction on file
  (`amed_sentinel2_features.jsonl`, same 250 fields, real per-field observation counts), so
  suitability for a second real extraction (WorldCereal's own S1/S2/DEM/AGERA5 stack) is not in
  question — WorldCereal fetches its own inputs independently of our existing pipeline.

**Selected 100-field evaluation set** — deterministic, frozen **before** any WorldCereal job for
these fields is run (`training/esa/experiments/select_100_fields.py` →
`selected_100_fields.json`): per crop, sort all real fields by `amed_confidence` ascending and
take an evenly-spaced subset, so every crop's sample spans its own real confidence range without
hand-picking a single field. Result: 100 fields, all 12 real crop classes represented
(SUGARCANE 21, SORGHUM 18, RICE 17, COTTON 15, CORN 9, GROUNDNUT 7, SOYBEANS 5, GRAM 3, CHILLI 2,
MUSTARD 1, WHEAT 1, BAJRA 1), confidence buckets <0.30→24, 0.30-0.49→35, 0.50-0.69→31,
0.70-0.84→9, ≥0.85→1, regions Karnataka 52 / Andhra Pradesh 21 / Maharashtra 21 / Telangana 6.

## 8-14. AMED vs WorldCereal comparison, results by crop/confidence/agreement — PENDING

Not run yet. See §15.

## 15. Exact processing costs — estimate, pending approval to run Part B

**Historical real per-job cost** (7 successful jobs): mean **9.9 credits**, median 9, min 8, max
17. **Historical real failure rate**: 2 of 9 attempts (22%), still billed (4 and 9 credits).

**Estimate for the 100-field batch** (one job per field, current architecture):
- **Typical case**: 100 × ~9.9 ≈ **~990 credits**, plus credits burned on any real job failures
  that need a retry to get a usable result for that field (historically ~1 in 5 jobs) — realistic
  total **~900-1,200 credits**.
- **Worst case**: if a meaningful fraction of fields resemble Kurukshetra (heavy real cloud
  cover → more backend reprocessing → 17 credits, nearly double the median), total could reach
  **~1,500-1,700 credits**.

**This is roughly 11-15x everything spent on WorldCereal across this entire evaluation so far**
(cumulative real openEO spend to date: **82 credits**). Per your own cost-control instructions,
this is a "materially higher than expected" jump that must be surfaced before running anything,
not assumed to be fine because a 100-field evaluation was approved in principle.

**I cannot check the remaining CDSE credit quota programmatically** — confirmed directly: the
openEO REST API has no `/credits` or balance endpoint (`describe_account()` and every plausible
raw path return either no balance field or 404). CDSE does not expose remaining balance via the
API at all; it's only visible on the CDSE web dashboard. **You'll need to check that yourself
before I proceed.**

**One unverified but plausible cost-reduction lever, not yet tested**: real job `input_pixel`
counts (17.5-21.9 megapixels) are far larger than the requested ~640m×640m bbox implies, which is
consistent with the backend loading a larger fixed data granule internally regardless of the
tiny requested area. If true, a single job covering a *cluster* of nearby fields (several AMED
fields in the pool sit within the same few-km area — see district bounding boxes in
`experiments/amed_pool_with_centroids.json`) might cost close to the same as one field, turning
~10 credits/field into ~10 credits per several fields. **This is a hypothesis, not a measured
fact** — confirming it would need its own small real test (~1-2 jobs, ~10-20 credits) before it
could be trusted to cut the 100-field estimate down.

## 16-23. Remaining sections — pending Part B execution

To be completed once Part B runs (or once you decide not to run it). §18 (recommended
architecture) can be partly answered already from §6's timing evidence — async + cache is settled
regardless of Part B's outcome — but the crop-by-crop and confidence-bucket recommendation needs
real comparison data first.
