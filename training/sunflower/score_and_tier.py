"""
Continuous sunflower_candidate_score + tiering for the Kurukshetra-Karnal weak-label dataset.

Frozen BEFORE being applied to the 245-field batch 2 results (calibrated only against the known
30-field batch 1 sample) -- same "freeze methodology before seeing more data" discipline used
throughout this project. This is a transparent, auditable weighted linear combination, not a
trained/black-box model -- every component and weight is stated explicitly below.

Score components (each independently reflects one of the co-founder's described signal
properties, each scaled to [0,1] using the OBSERVED extremes of the 30-field reference sample):
  - c_apr:     April greenness (ndvi_apr / 0.764, the observed max in the 30-field sample)
  - c_may:     May vegetation, same scale (falls back to ndvi_apr if May is missing)
  - c_decline: April->June decline ((ndvi_apr - ndvi_june) / 0.646, the observed max decline)
  - c_june_low: reward for June being below the co-founder's own 0.25 "brown/ploughed" reference
                (1 - ndvi_june/0.25, clipped to [0,1] -- zero credit once June >= 0.25)
  - c_cov:     mean fraction of real Sentinel-2 observations that were cloud-free/valid across
               the 3 windows

  sunflower_candidate_score = 0.25*c_apr + 0.15*c_may + 0.30*c_decline + 0.20*c_june_low + 0.10*c_cov

Weights emphasize the decline (the actual hypothesis) most heavily, April/June absolute levels
next, May and data-quality as smaller modifiers -- stated plainly so the weighting choice itself
is auditable, not hidden.

Tiering: NOT score-alone. A field cannot enter Tier A or Tier B unless it also shows a REAL
positive decline consistent with "green in April/May, brown by June" -- otherwise a field that's
simply green all season (e.g. a longer-season crop that never declines) could score moderately
high on the April/May components alone while contradicting the actual hypothesis. This gate was
found necessary by inspecting the real 30-field results (field 7JXRWWPV+H9P3: apr=0.727,
may=0.754, june=0.507 -- stays green, does NOT decline -- scored 0.580 on raw components alone,
which would have wrongly landed it in a "candidate" tier without this gate).

  TIER A / SUNFLOWER_WEAK_POSITIVE_HIGH:   baseline_rule_pass == True (exact co-founder rule)
  TIER B / SUNFLOWER_WEAK_POSITIVE_MEDIUM: baseline_rule_pass == False AND
                                            ndvi_apr_minus_june > 0.25 AND ndvi_june < 0.35 AND
                                            (ndvi_apr > 0.40 OR ndvi_june < 0.30)
                                            (real decline + June already fairly low + close to
                                            at least one of the two original hard thresholds)
  TIER C / candidate/uncertain:            0.35 <= score < 0.60, not already A/B
  TIER D / NON_SUNFLOWER_TEMPORAL_NEGATIVE: everything else (flat/low all season, or increasing
                                            April->June -- the opposite of the hypothesis)
"""
import statistics

APRIL_MAX = 0.764
DECLINE_MAX = 0.646
JUNE_BROWN_REF = 0.25


def clip(x, lo=0.0, hi=1.0):
    return max(lo, min(hi, x))


def score_field(r):
    apr, may, june = r.get("ndvi_apr"), r.get("ndvi_may"), r.get("ndvi_june")
    if apr is None or june is None:
        return None, None
    decline = apr - june
    c_apr = clip(apr / APRIL_MAX)
    c_may = clip((may if may is not None else apr) / APRIL_MAX)
    c_decline = clip(decline / DECLINE_MAX)
    c_june_low = clip(1 - (june / JUNE_BROWN_REF))
    obs = r.get("valid_obs_days") or {}
    tot = r.get("total_obs_days") or {}
    coverages = [obs.get(k, 0) / tot[k] if tot.get(k, 0) > 0 else 0 for k in ["april", "may", "june"]]
    c_cov = statistics.mean(coverages) if coverages else 0
    score = 0.25 * c_apr + 0.15 * c_may + 0.30 * c_decline + 0.20 * c_june_low + 0.10 * c_cov
    components = {"c_apr": round(c_apr, 3), "c_may": round(c_may, 3), "c_decline": round(c_decline, 3), "c_june_low": round(c_june_low, 3), "c_cov": round(c_cov, 3)}
    return round(score, 4), components


def tier_and_label(r, score):
    apr, may, june = r.get("ndvi_apr"), r.get("ndvi_may"), r.get("ndvi_june")
    decline = (apr - june) if (apr is not None and june is not None) else None
    rule_pass = r.get("baseline_rule_pass", False)
    # A field that never showed meaningful vegetation at all (near-bare/fallow all season) can
    # still score moderately on the c_june_low component alone -- that's a low-vegetation field,
    # not a "green-then-brown" candidate, so it's gated out of Tier C regardless of score.
    ever_green = max(v for v in [apr, may] if v is not None) if (apr is not None or may is not None) else 0

    if rule_pass:
        return "A", "SUNFLOWER_WEAK_POSITIVE_HIGH"
    if decline is not None and decline > 0.25 and june is not None and june < 0.35 and (apr is not None and apr > 0.40 or june < 0.30):
        return "B", "SUNFLOWER_WEAK_POSITIVE_MEDIUM"
    if score is not None and 0.35 <= score < 0.60 and ever_green >= 0.30:
        return "C", "UNCERTAIN"
    return "D", "NON_SUNFLOWER_TEMPORAL_NEGATIVE"


def score_and_tier_all(results):
    out = []
    for r in results:
        if r.get("status") != "ok":
            continue
        score, components = score_field(r)
        tier, label = tier_and_label(r, score) if score is not None else ("D", "NON_SUNFLOWER_TEMPORAL_NEGATIVE")
        out.append({**r, "sunflower_candidate_score": score, "score_components": components, "candidate_tier": tier, "training_label": label})
    return out
