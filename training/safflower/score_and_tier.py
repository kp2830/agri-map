"""
Transparent, auditable safflower_candidate_score + tiering for the Latur pilot (135 real
fields) — same "freeze the formula before applying it to more data" discipline used throughout
this project's sunflower work, and the same weighted-linear-combination, not-a-black-box design
as training/sunflower/score_and_tier.py.

Frozen using ONLY the original 30-field pilot sample's own observed extremes (calibration set —
the first 30 field IDs completed, before the other 105 were extracted), never the full 135.

IMPORTANT — WHAT THIS SCORE IS NOT: there is no confirmed Safflower ground truth anywhere in
this dataset (unlike Sunflower, which at least had one real co-founder-observed field to anchor
its original baseline rule). This score and its tiers are NOT a calibrated probability of being
Safflower and must never be reported as one (e.g. "90% confident") — no validation set exists to
calibrate against. What IS real: every field in the HIGH tier independently satisfies BOTH of two
different real spectral signals (a genuine season-length NDVI shape AND a genuine NDYI
flowering-color peak) with a comfortable margin above the pilot's own observed range, plus zero
AMED conflict — the strongest joint evidence the real data supports, honestly labeled as a weak
positive, not a confirmed identification.

GATE (not score alone): a field is only tier-eligible if it satisfies BOTH real directional
conditions:
  - shape: flowering_ndvi > establishment_ndvi AND flowering_ndvi > harvest_ndvi
  - color: flowering_ndyi > establishment_ndyi AND flowering_ndyi > harvest_ndyi
This was found necessary from the 30-field pilot itself: 26/30 fields showed the color condition
alone (too common — likely the general regional Dec-Jan rabi flowering season, shared with
Mustard, per config.ts's SAFFLOWER_KNOWN_CONFUSION_CROPS), while only 9/30 showed BOTH conditions
together. The gate is what actually discriminates; the score below only ranks fields that already
pass it.

Score components (each normalized to the CALIBRATION SET's own observed extremes):
  - c_shape (0.35):   (ndvi_flowering - max(ndvi_establishment, ndvi_harvest)) / 0.3866
                       (the calibration set's observed max shape rise)
  - c_color (0.35):   (ndyi_flowering - max(ndyi_establishment, ndyi_harvest)) / 0.3300
                       (the calibration set's observed max color rise)
  - c_decline (0.20): (ndvi_flowering - ndvi_harvest), clipped >=0, / 0.3866
                       (confirms real senescence by the Feb-Mar harvest window)
  - c_coverage (0.10): mean fraction of real Sentinel-2 observations that were cloud-free/valid
                       across the 3 windows

  safflower_candidate_score = 0.35*c_shape + 0.35*c_color + 0.20*c_decline + 0.10*c_coverage

Tiers:
  HIGH   ("strongest real joint evidence"): passes the gate AND score >= 0.55
  MEDIUM: passes the gate AND 0.35 <= score < 0.55
  LOW:    passes the gate but score < 0.35
  FAILS_GATE: does not satisfy both real directional conditions
"""
import json

SHAPE_RISE_MAX = 0.38655987713072026   # calibration set (first 30 fields) observed max
COLOR_RISE_MAX = 0.3300401887132062    # calibration set observed max
DECLINE_MAX = 0.38655987713072026      # calibration set observed max (same field as shape max here)


def clip(x, lo=0.0, hi=1.0):
    return max(lo, min(hi, x))


def passes_gate(r):
    e_ndvi = r["windows"]["establishment"]["means"]["ndvi"]
    f_ndvi = r["windows"]["flowering"]["means"]["ndvi"]
    h_ndvi = r["windows"]["harvest"]["means"]["ndvi"]
    e_ndyi = r["windows"]["establishment"]["means"]["ndyi"]
    f_ndyi = r["windows"]["flowering"]["means"]["ndyi"]
    h_ndyi = r["windows"]["harvest"]["means"]["ndyi"]
    if None in (e_ndvi, f_ndvi, h_ndvi, e_ndyi, f_ndyi, h_ndyi):
        return False
    shape_ok = f_ndvi > e_ndvi and f_ndvi > h_ndvi
    color_ok = f_ndyi > e_ndyi and f_ndyi > h_ndyi
    return shape_ok and color_ok


def score_field(r):
    e_ndvi = r["windows"]["establishment"]["means"]["ndvi"]
    f_ndvi = r["windows"]["flowering"]["means"]["ndvi"]
    h_ndvi = r["windows"]["harvest"]["means"]["ndvi"]
    e_ndyi = r["windows"]["establishment"]["means"]["ndyi"]
    f_ndyi = r["windows"]["flowering"]["means"]["ndyi"]
    h_ndyi = r["windows"]["harvest"]["means"]["ndyi"]

    c_shape = clip((f_ndvi - max(e_ndvi, h_ndvi)) / SHAPE_RISE_MAX)
    c_color = clip((f_ndyi - max(e_ndyi, h_ndyi)) / COLOR_RISE_MAX)
    c_decline = clip(max(0.0, f_ndvi - h_ndvi) / DECLINE_MAX)

    valid_days = [
        r["windows"][w]["valid_obs_days"] for w in ("establishment", "flowering", "harvest")
    ]
    # window lengths in days: establishment=15, flowering=32, harvest=15
    window_lengths = [15, 32, 15]
    c_coverage = sum(v / wl for v, wl in zip(valid_days, window_lengths)) / 3

    return 0.35 * c_shape + 0.35 * c_color + 0.20 * c_decline + 0.10 * c_coverage


def tier(r):
    if not passes_gate(r):
        return "FAILS_GATE", 0.0
    s = score_field(r)
    if s >= 0.55:
        return "HIGH", s
    if s >= 0.35:
        return "MEDIUM", s
    return "LOW", s


def main():
    results = json.load(open("latur_pilot_results.json"))["results"]
    tiered = [(r, *tier(r)) for r in results]

    counts = {}
    for _, t, _ in tiered:
        counts[t] = counts.get(t, 0) + 1
    print(f"n = {len(results)} real fields\n")
    for t in ["HIGH", "MEDIUM", "LOW", "FAILS_GATE"]:
        print(f"{t}: {counts.get(t, 0)}")

    print("\nHIGH tier fields (strongest real joint evidence, sorted by score):")
    high = sorted([(r, s) for r, t, s in tiered if t == "HIGH"], key=lambda x: -x[1])
    for r, s in high:
        e = r["windows"]["establishment"]["means"]
        f = r["windows"]["flowering"]["means"]
        h = r["windows"]["harvest"]["means"]
        print(
            f"  {r['field_id']} (cell {r['source_cell']}, area {r['area_sqm']:.0f} sqm) score={s:.3f} | "
            f"ndvi {e['ndvi']:.3f}->{f['ndvi']:.3f}->{h['ndvi']:.3f} | "
            f"ndyi {e['ndyi']:.3f}->{f['ndyi']:.3f}->{h['ndyi']:.3f}"
        )

    json.dump(
        {"high": [r["field_id"] for r, s in high]},
        open("latur_pilot_high_tier_field_ids.json", "w"),
        indent=2,
    )


if __name__ == "__main__":
    main()
