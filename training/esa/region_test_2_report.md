# Two-Region WorldCereal Sunflower Sanity Test — Siddipet & Kurukshetra

Locations frozen before the run (from `sunflower_region_sanity_check.md`, written before either
result was seen). Same exact methodology as the Gadag test: ~640m box, WorldCereal's own real
crop-calendar season lookup, `DEFAULT_INFERENCE_JOB_OPTIONS`. **Real credits spent this round:
26** (Siddipet 9, failed; Kurukshetra 17, succeeded). Cumulative openEO credits across all rounds:
**82**. Stopping here as instructed — no further regions run.

## Siddipet, Telangana — job failed (real, external, not our code)

- **Evidence**: real government sunflower production statistics naming Siddipet a major
  district; evidence type: state-level statistics, not field-level.
- **Job**: submitted, ran for 458s, then failed.
- **Real cause** (from the job's own logs): `rasterio._err.CPLE_HttpResponseError: CURL error:
  Could not resolve host: data.cloudferro.com` — a DNS resolution failure **inside ESA/CDSE's own
  backend infrastructure** while fetching one of its auxiliary input layers (DEM/AGERA5, hosted on
  CloudFerro). This is a transient platform-side failure, not a bug in our integration code or
  process graph — the identical process graph succeeded for both Gadag (prior round) and
  Kurukshetra (this round).
- **Real cost of the failed attempt: 9 credits** — charged despite failure, reported honestly,
  not hidden.
- **Not retried without your instruction.**

## Kurukshetra, Haryana — real result

- **Exact point**: 29.9693747, 76.8482787 (Kurukshetra city centroid — the representative point
  frozen in advance).
- **Independent evidence**: Kumar et al. 2024, *Environmental Monitoring and Assessment* — a real
  peer-reviewed study specifically mapping sunflower in Ambala/Kurukshetra districts, Haryana.
- **Evidence date/season**: the paper's own real study season (not independently re-verified
  beyond the paper's existence — same caveat as any literature-sourced evidence).
- **WorldCereal processing period**: 2024-12-01 to 2025-11-30 (`tc-annual`, from WorldCereal's
  own real crop-calendar lookup for this exact point — same rule as every prior region).
- **Real data availability**: severe — only 164 of 4,080 pixels (4%) in the whole ~640m tile had
  any valid (non-cloud-masked) classification for the full year. The immediate ~130m around the
  exact centroid had **zero** valid pixels; the nearest real data was 13 pixels (~130m) away.
  Widened the inspection window to 31×31 px (~310m radius) to find any real signal at all —
  disclosed, not hidden.
- **WorldCereal sunflower probability**: **0% (min, max, and mean) across every valid pixel in
  the widened window.** Weaker than even Gadag's already-weak 0.9% mean / 3% max.
- **Dominant competing class**: **maize**, 13 of 14 valid pixels, 59% confidence at the nearest
  real cropland pixel. Secondary: no_crop, millet, dry_pulses_legumes.
- **Spatial consistency**: the maize signal is consistent across all 13 maize-classified pixels
  (no fragmentation into multiple competing classes) — but the *sample itself* is small and
  spatially offset from the exact target point due to the real cloud-cover gap.
- **Real processing time**: 695 seconds (~11.6 min) — the slowest job run so far in this project,
  plausibly related to the region's data characteristics.
- **Real cost**: 17 credits — nearly double the typical 8–10 credit rate seen at Gadag/the
  5-field batch, plausibly reflecting more retried/reprocessed tiles given the real data gaps.

## Conclusions

**A. Does WorldCereal show a meaningful sunflower signal in either region?**
**No.** Kurukshetra: 0% everywhere real data exists. Siddipet: no result obtained (real
infrastructure failure, not a null finding — genuinely unknown, not evidence of absence).

**B. Substantially better/worse than Gadag?**
**Worse, or at best equal-and-weaker.** Gadag had a real, if very weak, non-zero signal (mean
0.9%, max 3%). Kurukshetra's real signal is flatly zero. Two independent real tests now both
show essentially no sunflower detection from WorldCereal in real, independently-evidenced Indian
sunflower districts.

**C. Geographically/seasonally plausible?**
**Partially, and with an important caveat.** Maize dominance at Kurukshetra is not implausible in
itself (maize is a real, common North Indian crop), but a full year covering the wrong part of
the calendar for a real spring-sown sunflower crop (typically ~January–May) could plausibly wash
out the signal *if the field-level ground truth is elsewhere in the same district* — this test
used a district-centroid point (city center), not a field-level location known to be under
sunflower, which is a real, material limitation of this specific test's precision (worth stating
plainly: this round tested a *representative district point*, not a *verified sunflower field*,
unlike Gadag which was tied to an exact real photographed observation).

**D. Enough evidence to justify testing the remaining two regions (Bagalkote, Raichur)?**
**Not yet, and not in the same form.** Two real tests, one non-signal and one failed/inconclusive,
is thin evidence either way. More importantly, this round exposed a **methodological gap**:
Gadag's real advantage was a field-level photographed observation; Siddipet and Kurukshetra used
district-centroid points, which is a materially weaker test (as seen in C). Before spending more
credits on Bagalkote/Raichur, the more informative fix is to use exact field-level points there
too — we already have one for each (the real iNaturalist-derived Bagalkote/Sindgi point, and the
real "Mittikellur/Lingasugur/Raichur" point from an earlier round), which would make any further
test directly comparable to Gadag rather than repeating this round's weaker district-centroid
methodology.

**E. Does this suggest WorldCereal could realistically become a useful independent sunflower
signal for AgriMap?**
**On current evidence, no — or at least not demonstrated.** Three real tests (Gadag, Siddipet
attempted, Kurukshetra) have now produced zero convincing sunflower detections in real,
independently-evidenced Indian sunflower-growing areas. This does not prove WorldCereal's
sunflower class is unreliable for India in general (small sample, one test used an imprecise
point, one failed for external reasons) — but it does mean **no positive evidence has yet been
found** for using WorldCereal as a sunflower signal specifically. Its value for the *other*
overlap crops (rice, maize, etc. — §3 of `worldcereal_agrimap_evaluation.md`) is unaffected by
this finding and remains a separate question.

## Resource accounting

- openEO/CDSE credits spent this round: **26** (9 failed + 17 succeeded)
- Cumulative openEO credits: **82**
- Sentinel Hub Statistical API PU: **0** this round (cumulative ~969/2,500)
- Production files changed: **0**
- Threshold changed: **No**
- Committed/pushed: **No**
