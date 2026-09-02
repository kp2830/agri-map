# WorldCereal Sunflower Sanity Check — Region Selection & Static-Product Feasibility

**Zero openEO/CDSE credits spent this round.** This document answers the feasibility question and
proposes a plan; no live job has been run pending your approval.

## Does the official 2021 static WorldCereal product help here?

**No — confirmed directly from ESA's own product documentation, not assumed.** The public 2021
WorldCereal release (`esa-worldcereal.org/en/products/global-maps`, Zenodo record for
`ESA WorldCereal 10m 2021 v100`) contains exactly these layers: **temporarycrops** (binary
cropland extent), **maize** (binary), **wintercereals** (binary, wheat+barley+rye),
**springcereals** (binary), **activecropland**, and **activeirrigation**. **There is no
`sunflower` layer in the 2021 static product at all** — sunflower only exists in the newer
`CROPTYPE24` taxonomy used by the live inference model (`worldcereal==2.8.0`) we already ran
against the Gadag field.

**Consequence: any sunflower-specific check, in any region, requires a fresh live openEO job.**
There is no free/pre-computed path to this specific question. This is a hard constraint of ESA's
own product design, not a limitation of our integration.

## 3–5 independently-evidenced Indian sunflower regions (zero cost, real sources)

| region | evidence source | evidence type |
|---|---|---|
| **Gadag district, Karnataka** | agrifarming.in district crop list (govt. data); our own iNaturalist observation (265387815, 2025-02-27) | Named major district + direct field observation |
| **Bagalkote/Vijayapura district, Karnataka** | Same district list (as "Bijapur"); our own iNaturalist observation (56823200, 2020-08-18) | Named major district + direct field observation |
| **Raichur district, Karnataka** | Same district list; a real public-source location we identified in an earlier round ("Mittikellur/Lingasugur/Raichur", 16.0510, 76.5312) | Named major district + prior real location |
| **Siddipet district, Telangana** (18.0056, 78.8961) | Indiastat/statesinsights, citing real government production statistics naming Telangana's major sunflower districts as Siddipet, Sangareddy, Gadwal, Nagarkurnool | Named major district, state-government-sourced |
| **Kurukshetra district, Haryana** (29.9694, 76.8483) | Kumar et al. 2024, *Environmental Monitoring and Assessment* — a real peer-reviewed paper specifically mapping sunflower in Ambala/Kurukshetra districts | Peer-reviewed academic study |

Geographically distinct (3 states), agronomically distinct (Karnataka/Telangana = Deccan
Rabi-season sunflower; Haryana = North Indian spring/Zaid-season sunflower — a genuinely
different real cropping calendar, useful diversity for this sanity check).

## Proposed plan — NOT executed, stopping for approval as instructed

Same real methodology already validated (WorldCereal CROPTYPE inference, ~640m×640m box, season
window from WorldCereal's own real crop-calendar lookup for each exact point — not manually
assumed):

| region | representative point | expected job size | expected real cost (measured rate: 8–10 credits/job) |
|---|---|---|---|
| Gadag | 15.6744, 75.3440 — **already have a real WorldCereal result from a prior round** (rice-dominant, sunflower mean 0.9%/max 3%) | ~640m×640m, ~12mo | **0 — reuse existing result, no new job** |
| Bagalkote/Vijayapura (Sindgi) | 16.9536, 75.9901 — a real Sentinel-2 test was run here in an earlier round, but through **our own** pipeline (Statistical API), not WorldCereal. **No WorldCereal result exists for this point yet.** | same | ~8–10 credits |
| Raichur | 16.0510, 76.5312 | same | ~8–10 credits |
| Siddipet, Telangana | 18.0056, 78.8961 | same | ~8–10 credits |
| Kurukshetra, Haryana | 29.9694, 76.8483 | same | ~8–10 credits |

**Correction while drafting this**: only Gadag already has a real WorldCereal result. The other
4 regions (Bagalkote, Raichur, Siddipet, Kurukshetra) have never been run through WorldCereal —
only Gadag was (Sindgi/Bagalkote was tested through our own pipeline, a different system).

**Expected total new cost if all 4 remaining regions are run: 4 fresh jobs × ~8–10 credits ≈
32–40 credits.** Expected output per region: the same 26-band GeoTIFF (classification + 24 class
probabilities at 10m), decoded the same way as before (dominant class + sunflower probability in
an 11×11 pixel window around the real point).

**Not run. Waiting for your go-ahead** on: (a) whether to proceed with all 4 remaining regions at
the ~32–40 credit estimate, or a smaller subset, and (b) confirming Gadag's existing result
(already real, already paid for, zero additional cost to reuse) counts as region 1 of this
5-region check.

## Resource accounting

- openEO/CDSE credits spent this round: **0**
- Cumulative openEO credits (prior rounds): **56**
- Sentinel Hub Statistical API PU: **0** this round (cumulative ~969/2,500)
- Production files changed: **0**
- Threshold changed: **No**
- Committed/pushed: **No**
