"""
Unified cycle-isolation algorithm (v2), designed to fix the specific asymmetry found in the
Sindgi validation: v1 (isolated_cycle_transfer.py) can trim INTERIOR contamination bounded by two
real local maxima (this is what helped Gadag), but cannot trim a LEADING or TRAILING real bare/
fallow baseline that has no bounding peak on one side (this is what hurt Sindgi -- its long real
pre-season low period was kept in full, diluting the mean-based features even though its peak
values were reasonably aligned with the Slovak reference).

=== FROZEN v2 ALGORITHM (defined before re-examining any candidate result) ===

Given a field's real NDVI (day, value) series:

1. Require >= MIN_OBS_TOTAL=8 real observations, else INSUFFICIENT (unchanged from v1).
2. field_range = max(value) - min(value). Require >= ABS_RANGE_FLOOR=0.05, else INSUFFICIENT
   (unchanged from v1).
3. baseline = the field's OWN 25th percentile of its real observed values -- a robust, fully
   data-driven "typical background/fallow level" specific to that field, never a fixed global
   number and never chosen with reference to any candidate.
4. elevation_threshold = baseline + max(PROMINENCE_ABS_FLOOR=0.10, PROMINENCE_FRAC=0.25 *
   field_range) -- REUSES THE EXACT SAME threshold-construction formula as v1 (same constants),
   just applied relative to the field's own baseline instead of to a trough-vs-local-max
   comparison. This is a deliberate methodological continuity choice, not a new free parameter
   introduced to fit any candidate.
5. Classify each real observation as "elevated" (value >= elevation_threshold) or not.
6. Find contiguous real runs of elevated observations (real chronological adjacency in the
   observed sequence -- no interpolation).
7. If no elevated run exists, INSUFFICIENT.
8. Select the elevated run containing the field's own global observed maximum -- the SAME
   candidate-independent selection rule as v1.
9. The cycle = exactly that elevated run's real observations (this is what differs from v1: v1
   kept the full trough-to-trough segment including near-baseline shoulders; v2 keeps only the
   observations that are themselves elevated above the field's own baseline).
10. Require >= MIN_OBS_CYCLE=5 real observations in the run, else INSUFFICIENT.
11. Re-base to the run's own first real observation.

This single rule handles BOTH failure modes found so far: a leading/trailing baseline never
enters an elevated run at all (fixing Sindgi's problem), and a real preceding-crop peak forms its
OWN separate elevated run, excluded by the same peak-containing-run selection that already
excluded it under v1 (preserving Gadag's fix).

Reuses the exact same downstream scoring machinery as v1 and every prior round (combo_score,
leave_one_field_out_source_scores, diagnose) -- unchanged, not duplicated.

Run: training/.venv/bin/python3 training/sunflower/isolated_cycle_transfer_v2.py
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

from pilot_features import build_observations
from pilot_ensemble_score import combo_score, leave_one_field_out_source_scores
from pilot_leakage_diagnosis import diagnose
from temporal_features import Observation, compute_phenology_features

REPO_ROOT = Path(__file__).resolve().parents[2]
PILOT_DIR = REPO_ROOT / "training" / "data" / "pilot"
SERVER_SCRIPTS = REPO_ROOT / "server" / "scripts"
INDEX_NAMES = ["ndvi", "ndre", "ndwi", "ndyi"]

MIN_OBS_TOTAL = 8
ABS_RANGE_FLOOR = 0.05
PROMINENCE_ABS_FLOOR = 0.10
PROMINENCE_FRAC = 0.25
MIN_OBS_CYCLE = 5
BASELINE_PERCENTILE = 25


def isolate_cycle_v2(ndvi_series: list[dict]) -> tuple[int, int] | None:
    obs = build_observations(ndvi_series)
    if len(obs) < MIN_OBS_TOTAL:
        return None
    days = [o.days_since_start for o in obs]
    values = [o.value for o in obs]
    field_range = max(values) - min(values)
    if field_range < ABS_RANGE_FLOOR:
        return None

    baseline = float(np.percentile(values, BASELINE_PERCENTILE))
    threshold = max(PROMINENCE_ABS_FLOOR, PROMINENCE_FRAC * field_range)
    elevation_threshold = baseline + threshold

    elevated = [v >= elevation_threshold for v in values]
    if not any(elevated):
        return None

    # Contiguous real runs of elevated observations (real chronological adjacency).
    runs: list[tuple[int, int]] = []
    run_start = None
    for i, is_elevated in enumerate(elevated):
        if is_elevated and run_start is None:
            run_start = i
        elif not is_elevated and run_start is not None:
            runs.append((run_start, i - 1))
            run_start = None
    if run_start is not None:
        runs.append((run_start, len(elevated) - 1))

    global_peak_idx = int(np.argmax(values))
    selected = None
    for start, end in runs:
        if start <= global_peak_idx <= end:
            selected = (start, end)
            break
    if selected is None:
        return None  # the global peak itself wasn't classified elevated -- degenerate, real edge case

    start_day, end_day = days[selected[0]], days[selected[1]]
    n_in_cycle = sum(1 for d in days if start_day <= d <= end_day)
    if n_in_cycle < MIN_OBS_CYCLE:
        return None
    return start_day, end_day


def rebased_observations(daily_series: list[dict], start_day: int, end_day: int) -> list[Observation]:
    obs = build_observations(daily_series)
    in_cycle = [o for o in obs if start_day <= o.days_since_start <= end_day]
    if not in_cycle:
        return []
    cycle_start = min(o.days_since_start for o in in_cycle)
    return [Observation(days_since_start=o.days_since_start - cycle_start, value=o.value) for o in in_cycle]


def field_isolated_features_v2(field_result: dict) -> dict | None:
    ndvi_series = field_result["indices"].get("ndvi", [])
    cycle = isolate_cycle_v2(ndvi_series)
    if cycle is None:
        return None
    start_day, end_day = cycle
    total_real_obs = len(build_observations(ndvi_series))

    feats: dict = {"cycle_start_day": start_day, "cycle_end_day": end_day, "cycle_length_days": end_day - start_day}
    n_retained = None
    for idx in INDEX_NAMES:
        obs = rebased_observations(field_result["indices"].get(idx, []), start_day, end_day)
        if idx == "ndvi":
            n_retained = len(obs)
        values = [o.value for o in obs]
        feats[f"{idx}_mean"] = float(np.mean(values)) if values else None
        feats[f"{idx}_peak_value"] = float(np.max(values)) if values else None
        if len(obs) >= 2:
            pf = compute_phenology_features(obs, as_of_day=max(o.days_since_start for o in obs))
            feats[f"{idx}_slope"] = pf.slope
            feats[f"{idx}_pre_peak_slope"] = pf.pre_peak_slope
            feats[f"{idx}_post_peak_slope"] = pf.post_peak_slope
            feats[f"{idx}_growth_acceleration"] = pf.growth_acceleration
            feats[f"{idx}_variability"] = pf.variability
        else:
            for suffix in ["slope", "pre_peak_slope", "post_peak_slope", "growth_acceleration", "variability"]:
                feats[f"{idx}_{suffix}"] = None

    ndre_p, ndvi_p = feats.get("ndre_peak_value"), feats.get("ndvi_peak_value")
    feats["ndre_ndvi_peak_ratio"] = ndre_p / ndvi_p if (ndre_p is not None and ndvi_p not in (None, 0)) else None
    feats["observations_retained"] = n_retained
    feats["observations_total"] = total_real_obs
    feats["pct_retained"] = round(100 * n_retained / total_real_obs, 1) if total_real_obs else None
    return feats


def load_candidate(path: Path, key: str | None = None) -> dict:
    raw = json.loads(path.read_text(encoding="utf-8"))
    data = raw if key is None else raw[key]
    indices = data["indices"] if "indices" in data else data
    return {"indices": {idx: [{"date": p["date"], "mean": p["value"]} for p in indices[idx]["trajectory"]] for idx in INDEX_NAMES}}


PRODUCTION_COLS = [f"{idx}_{stat}" for idx in INDEX_NAMES for stat in ["mean", "peak_value"]] + ["ndre_ndvi_peak_ratio"]


def main() -> None:
    pos_rows = [json.loads(l) for l in (PILOT_DIR / "eurocrops_sentinel2_features.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]
    neg_rows = [json.loads(l) for l in (PILOT_DIR / "amed_sentinel2_features.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]

    slovak_records, slovak_insufficient = [], 0
    for r in pos_rows:
        feats = field_isolated_features_v2(r)
        if feats is None:
            slovak_insufficient += 1
            continue
        feats["field_id"] = r["field_id"]
        slovak_records.append(feats)
    df_slovak = pd.DataFrame(slovak_records)
    print(f"[v2] Slovak: {len(df_slovak)}/{len(pos_rows)} segmented, {slovak_insufficient} insufficient")
    print(f"  cycle length (days): median={df_slovak['cycle_length_days'].median():.0f} IQR=[{df_slovak['cycle_length_days'].quantile(.25):.0f},{df_slovak['cycle_length_days'].quantile(.75):.0f}]")
    print(f"  pct observations retained: median={df_slovak['pct_retained'].median():.1f}%")

    india_records, india_insufficient = [], 0
    for r in neg_rows:
        feats = field_isolated_features_v2(r)
        if feats is None:
            india_insufficient += 1
            continue
        feats["field_id"] = r["field_id"]
        feats["crop_label"] = r["crop_label"]
        india_records.append(feats)
    df_india = pd.DataFrame(india_records)
    print(f"[v2] India (unlabeled target): {len(df_india)}/{len(neg_rows)} segmented, {india_insufficient} insufficient")
    print(f"  cycle length (days): median={df_india['cycle_length_days'].median():.0f} IQR=[{df_india['cycle_length_days'].quantile(.25):.0f},{df_india['cycle_length_days'].quantile(.75):.0f}]")
    print(f"  pct observations retained: median={df_india['pct_retained'].median():.1f}%")

    candidates_raw = {
        "Karnataka-1": load_candidate(SERVER_SCRIPTS / "karnatakaCandidateFullResult.json"),
        "Gadag-dated": load_candidate(SERVER_SCRIPTS / "datedCandidateFullResult.json"),
        "Sindgi-Bijapur": load_candidate(SERVER_SCRIPTS / "secondCandidateFullResult.json"),
    }
    extra = json.loads((SERVER_SCRIPTS / "additionalCandidatesFullResults.json").read_text(encoding="utf-8"))
    for name in extra:
        candidates_raw[name] = load_candidate(SERVER_SCRIPTS / "additionalCandidatesFullResults.json", key=name)

    print("\n[v2] Candidate segmentation:")
    candidate_records = {}
    for name, c in candidates_raw.items():
        feats = field_isolated_features_v2(c)
        if feats is None:
            print(f"  {name}: INSUFFICIENT")
            candidate_records[name] = None
        else:
            print(f"  {name}: cycle=[{feats['cycle_start_day']},{feats['cycle_end_day']}] length={feats['cycle_length_days']}d retained={feats['observations_retained']}/{feats['observations_total']} ({feats['pct_retained']}%)")
            candidate_records[name] = feats

    df_candidates = pd.DataFrame([v | {"field_id": k} for k, v in candidate_records.items() if v is not None])

    cols = [c for c in PRODUCTION_COLS if c in df_slovak.columns]
    lofo = leave_one_field_out_source_scores(df_slovak, cols)
    print(f"\n[v2] Slovak LOFO (Representation D, v2 segmentation): mean={lofo.mean():.3f} median={np.median(lofo):.3f} std={lofo.std():.3f}")

    combined = pd.concat([df_slovak.assign(source="slovak"), df_india.assign(source="india")], ignore_index=True)
    sep = diagnose(combined, cols, "v2_production_isolated")

    india_scores = combo_score(df_slovak, df_india, cols)
    print(f"[v2] India background score: mean={india_scores.mean()*100:.2f}% p90={np.percentile(india_scores,90)*100:.2f}% p99={np.percentile(india_scores,99)*100:.2f}% max={india_scores.max()*100:.2f}%")
    print(f"[v2] Source separability: accuracy={sep['accuracy']:.4f} ROC-AUC={sep['roc_auc']:.4f}")

    print("\n[v2] Candidate scores:")
    cand_results = {}
    if len(df_candidates) > 0:
        cand_scores = combo_score(df_slovak, df_candidates, cols)
        for fid, s in zip(df_candidates["field_id"], cand_scores):
            pct = float((india_scores < s).mean() * 100)
            cand_results[fid] = {"score": float(s), "percentile_vs_india_background": pct}
            print(f"    {fid}: score={s*100:.2f}%  (percentile vs India background: {pct:.0f}%)")
    for name in candidates_raw:
        if name not in cand_results:
            cand_results[name] = None
            print(f"    {name}: no isolated cycle (insufficient)")

    results = {
        "n_fields": {"slovak_total": len(pos_rows), "slovak_segmented": len(df_slovak), "slovak_insufficient": slovak_insufficient,
                     "india_total": len(neg_rows), "india_segmented": len(df_india), "india_insufficient": india_insufficient},
        "cycle_length_days": {"slovak_median": float(df_slovak["cycle_length_days"].median()), "india_median": float(df_india["cycle_length_days"].median())},
        "pct_retained": {"slovak_median": float(df_slovak["pct_retained"].median()), "india_median": float(df_india["pct_retained"].median())},
        "lofo_stats": {"mean": float(lofo.mean()), "median": float(np.median(lofo)), "std": float(lofo.std())},
        "source_separability": {"accuracy": sep["accuracy"], "roc_auc": sep["roc_auc"]},
        "india_background_score": {"mean": float(india_scores.mean()), "p90": float(np.percentile(india_scores, 90)), "p99": float(np.percentile(india_scores, 99)), "max": float(india_scores.max())},
        "candidates": cand_results,
        "candidate_segmentation": {k: (v if v is None else {kk: vv for kk, vv in v.items() if kk not in ("field_id",)}) for k, v in candidate_records.items()},
    }
    out_path = PILOT_DIR / "isolated_cycle_transfer_v2_results.json"
    out_path.write_text(json.dumps(results, indent=2, default=str), encoding="utf-8")
    print(f"\n[v2] wrote {out_path.relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    main()
