"""
Zero-PU offline research audit: can we build a useful India-targeted sunflower ranking signal
WITHOUT more cycle/representation tuning, using only the current PRODUCTION representation
(raw full-window mean/peak/ratio, the one actually deployed) plus fixed, non-tuned descriptive
statistics? Reuses fit_reference_frame/score_population/three_method_scores
(pilot_india_transfer_pu.py), build_observations (pilot_features.py), field_features
(pilot_features.py, the exact production feature builder) -- not duplicated.

No cycle isolation of any kind is used in this script -- per explicit instruction to stop
candidate-specific segmentation tuning, everything here operates on the SAME full-window
production representation already deployed, plus purely descriptive (never selection-driving)
temporal statistics.

Run: training/.venv/bin/python3 training/sunflower/india_target_scoring_audit.py
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import StratifiedKFold, cross_val_predict
from sklearn.metrics import roc_auc_score

from pilot_features import build_observations, field_features
from pilot_india_transfer_pu import fit_reference_frame, score_population, three_method_scores

REPO_ROOT = Path(__file__).resolve().parents[2]
PILOT_DIR = REPO_ROOT / "training" / "data" / "pilot"
SERVER_SCRIPTS = REPO_ROOT / "server" / "scripts"
SERVER_TRAINING_DATA = REPO_ROOT / "server" / "data" / "training" / "sunflower-belt-competing-crops.jsonl"
INDEX_NAMES = ["ndvi", "ndre", "ndwi", "ndyi"]
PRODUCTION_COLS = [f"{idx}_{stat}" for idx in INDEX_NAMES for stat in ["mean", "peak_value"]] + ["ndre_ndvi_peak_ratio"]
SEED = 0


def load_candidate(path: Path, key: str | None = None) -> dict:
    raw = json.loads(path.read_text(encoding="utf-8"))
    data = raw if key is None else raw[key]
    indices = data["indices"] if "indices" in data else data
    return {"indices": {idx: [{"date": p["date"], "mean": p["value"]} for p in indices[idx]["trajectory"]] for idx in INDEX_NAMES}}


# ---------------------------------------------------------------------------
# Part E: fixed, non-tuned temporal descriptors (descriptive only -- never selects/trims data)
# ---------------------------------------------------------------------------
def temporal_descriptors(field_result: dict) -> dict:
    out = {}
    obs_by_index = {}
    for idx in INDEX_NAMES:
        obs = build_observations(field_result["indices"].get(idx, []))
        obs_by_index[idx] = obs
        if not obs:
            out[f"{idx}_peak_day_fraction"] = None
            continue
        days = [o.days_since_start for o in obs]
        values = [o.value for o in obs]
        season_length = max(days)
        peak_idx = int(np.argmax(values))
        out[f"{idx}_peak_day_fraction"] = days[peak_idx] / season_length if season_length > 0 else None
        out[f"{idx}_peak_value_raw"] = values[peak_idx]
        out[f"{idx}_baseline_raw"] = float(np.min(values))
        out[f"{idx}_excursion_raw"] = values[peak_idx] - float(np.min(values))
        # duration above a FIXED, field-specific (not tuned) vegetation threshold: own mean + 0.5*own std
        std = float(np.std(values, ddof=1)) if len(values) > 1 else 0.0
        thresh = float(np.mean(values)) + 0.5 * std
        above = [v >= thresh for v in values]
        out[f"{idx}_frac_above_mean_plus_halfstd"] = float(np.mean(above))
        # rise/fall asymmetry: pre-peak slope magnitude vs post-peak slope magnitude (sign-aware)
        pre = [(d, v) for d, v in zip(days, values) if d <= days[peak_idx]]
        post = [(d, v) for d, v in zip(days, values) if d >= days[peak_idx]]
        def slope(pts):
            if len(pts) < 2:
                return None
            xs, ys = zip(*pts)
            xs, ys = np.array(xs, dtype=float), np.array(ys, dtype=float)
            if xs.std() == 0:
                return None
            return float(np.polyfit(xs, ys, 1)[0])
        pre_slope, post_slope = slope(pre), slope(post)
        out[f"{idx}_pre_slope"] = pre_slope
        out[f"{idx}_post_slope"] = post_slope
        if pre_slope is not None and post_slope is not None and (abs(pre_slope) + abs(post_slope)) > 0:
            out[f"{idx}_rise_fall_asymmetry"] = (abs(pre_slope) - abs(post_slope)) / (abs(pre_slope) + abs(post_slope))
        else:
            out[f"{idx}_rise_fall_asymmetry"] = None
        # number of meaningful vegetation cycles: count real local maxima with prominence >= same
        # fixed threshold formula used descriptively (READ-ONLY count, never used to trim/select
        # data in this script)
        n = len(values)
        local_maxima = [i for i in range(n) if (i == 0 or values[i] >= values[i-1]) and (i == n-1 or values[i] >= values[i+1]) and (i == 0 or values[i] > values[i-1] or i == n-1 or values[i] > values[i+1])]
        field_range = max(values) - min(values)
        prom_thresh = max(0.10, 0.25 * field_range) if field_range > 0 else None
        n_cycles = 0
        if prom_thresh is not None:
            # a local max counts as a "meaningful cycle peak" if it's >= prom_thresh above the nearest real local minima on both available sides
            local_minima_idx = [i for i in range(n) if (i == 0 or values[i] <= values[i-1]) and (i == n-1 or values[i] <= values[i+1])]
            for m in local_maxima:
                left_mins = [j for j in local_minima_idx if j <= m]
                right_mins = [j for j in local_minima_idx if j >= m]
                drops = []
                if left_mins:
                    drops.append(values[m] - values[max(left_mins)])
                if right_mins:
                    drops.append(values[m] - values[min(right_mins)])
                if drops and all(d >= prom_thresh for d in drops):
                    n_cycles += 1
        out[f"{idx}_n_meaningful_cycles"] = n_cycles

    ndvi_frac, ndyi_frac, ndre_frac = out.get("ndvi_peak_day_fraction"), out.get("ndyi_peak_day_fraction"), out.get("ndre_peak_day_fraction")
    if ndvi_frac is not None and ndyi_frac is not None:
        out["ndyi_minus_ndvi_peak_fraction"] = ndyi_frac - ndvi_frac
    return out


def main() -> None:
    pos_rows = [json.loads(l) for l in (PILOT_DIR / "eurocrops_sentinel2_features.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]
    neg_rows = [json.loads(l) for l in (PILOT_DIR / "amed_sentinel2_features.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]

    df_slovak = pd.DataFrame([field_features(r) | temporal_descriptors(r) | {"field_id": r["field_id"]} for r in pos_rows])
    df_india = pd.DataFrame([field_features(r) | temporal_descriptors(r) | {"field_id": r["field_id"], "crop_label": r["crop_label"]} for r in neg_rows])
    print(f"[audit] Slovak n={len(df_slovak)}, India (unlabeled target) n={len(df_india)} -- PRODUCTION representation, no cycle isolation")

    # ============================================================
    # PART A: decompose sunflower-likeness vs India-domain-likeness
    # ============================================================
    print("\n=== A. Feature decomposition: sunflower-specific vs source-sensitive vs India-common ===")
    combined = pd.concat([df_slovak.assign(source="slovak"), df_india.assign(source="india")], ignore_index=True)
    Xc = combined[PRODUCTION_COLS].fillna(combined[PRODUCTION_COLS].median(numeric_only=True))
    yc = (combined["source"] == "slovak").astype(int)
    skf = StratifiedKFold(n_splits=3, shuffle=True, random_state=SEED)
    leak_probe = RandomForestClassifier(n_estimators=150, random_state=SEED)
    leak_proba = cross_val_predict(leak_probe, Xc, yc, cv=skf, method="predict_proba")[:, 1]
    overall_auc = roc_auc_score(yc, leak_proba)
    leak_probe_full = RandomForestClassifier(n_estimators=200, random_state=SEED).fit(Xc, yc)
    leak_importance = dict(zip(PRODUCTION_COLS, leak_probe_full.feature_importances_))

    decomposition = []
    for col in PRODUCTION_COLS:
        slovak_vals = df_slovak[col].dropna()
        india_vals = df_india[col].dropna()
        cv = float(slovak_vals.std() / abs(slovak_vals.mean())) if slovak_vals.mean() else None
        slovak_p25 = float(slovak_vals.quantile(0.25))
        slovak_p75 = float(slovak_vals.quantile(0.75))
        frac_india_in_slovak_iqr = float(((india_vals >= slovak_p25) & (india_vals <= slovak_p75)).mean())
        decomposition.append({
            "feature": col,
            "slovak_cv": cv,
            "source_leak_importance": float(leak_importance[col]),
            "frac_india_fields_within_slovak_iqr": frac_india_in_slovak_iqr,
        })
    df_decomp = pd.DataFrame(decomposition).sort_values("slovak_cv")
    print(f"  overall production-representation source ROC-AUC: {overall_auc:.4f}")
    print(df_decomp.to_string(index=False))

    # "sunflower-specific + transferable" candidate features: low CV (top half) AND low leak
    # importance (bottom half) AND low frac_india_in_iqr (bottom half) -- intersection, not
    # chosen by looking at any candidate's score.
    cv_median = df_decomp["slovak_cv"].median()
    leak_median = df_decomp["source_leak_importance"].median()
    frac_median = df_decomp["frac_india_fields_within_slovak_iqr"].median()
    intersection = df_decomp[(df_decomp["slovak_cv"] <= cv_median) & (df_decomp["source_leak_importance"] <= leak_median) & (df_decomp["frac_india_fields_within_slovak_iqr"] <= frac_median)]
    print(f"\n  Features meeting ALL THREE criteria (low CV, low leak-importance, low India-IQR-overlap): {intersection['feature'].tolist() if len(intersection) else 'NONE'}")

    # ============================================================
    # PART B: India null distribution + candidate scoring
    # ============================================================
    print("\n=== B. India background null distribution (production representation, 3-method) ===")
    scaler, medians, X_pos = fit_reference_frame(df_slovak, PRODUCTION_COLS)
    X_india = score_population(df_india, PRODUCTION_COLS, scaler, medians)
    india_method_scores = three_method_scores(X_pos, X_india)
    india_combined = np.vstack([india_method_scores[m]["likeness"] for m in india_method_scores]).mean(axis=0)
    print(f"  n={len(india_combined)}")
    for p in [50, 75, 90, 95, 99]:
        print(f"  p{p}: {np.percentile(india_combined, p)*100:.2f}%")
    print(f"  mean={india_combined.mean()*100:.2f}%  max={india_combined.max()*100:.2f}%")

    candidates_raw = {
        "Gadag-dated": load_candidate(SERVER_SCRIPTS / "datedCandidateFullResult.json"),
        "Sindgi-Bijapur": load_candidate(SERVER_SCRIPTS / "secondCandidateFullResult.json"),
        "Karnataka-1": load_candidate(SERVER_SCRIPTS / "karnatakaCandidateFullResult.json"),
    }
    extra = json.loads((SERVER_SCRIPTS / "additionalCandidatesFullResults.json").read_text(encoding="utf-8"))
    for name in extra:
        candidates_raw[name] = load_candidate(SERVER_SCRIPTS / "additionalCandidatesFullResults.json", key=name)

    df_candidates = pd.DataFrame([field_features(c) | temporal_descriptors(c) | {"field_id": name} for name, c in candidates_raw.items()])
    X_cand = score_population(df_candidates, PRODUCTION_COLS, scaler, medians)
    cand_method_scores = three_method_scores(X_pos, X_cand)

    print("\n=== C. Candidate India-relative ranking (top 1% / 5% / 10% / 20%) -- EXPLORATORY, NOT VALIDATION ===")
    candidate_results = {}
    for i, name in enumerate(df_candidates["field_id"]):
        combined_score = float(np.mean([cand_method_scores[m]["likeness"][i] for m in cand_method_scores]))
        maha_like = float(cand_method_scores["mahalanobis"]["likeness"][i])
        knn_like = float(cand_method_scores["knn"]["likeness"][i])
        iso_like = float(cand_method_scores["isolation_forest"]["likeness"][i])
        percentile = float((india_combined < combined_score).mean() * 100)
        tail_prob = float((india_combined >= combined_score).mean())
        rank = int((india_combined >= combined_score).sum()) + 1
        band = "top 1%" if percentile >= 99 else "top 5%" if percentile >= 95 else "top 10%" if percentile >= 90 else "top 20%" if percentile >= 80 else "below top 20%"
        candidate_results[name] = {
            "raw_likeness": combined_score, "mahalanobis_component": maha_like, "knn_component": knn_like, "isolation_forest_component": iso_like,
            "india_percentile": percentile, "empirical_tail_probability": tail_prob, "rank_of_250": rank, "band": band,
        }
        print(f"  {name:20s} score={combined_score*100:5.2f}%  percentile={percentile:5.1f}  tail_p={tail_prob:.3f}  rank={rank}/250  band={band}")

    # ============================================================
    # PART D: Slovak-only stability (bootstrap) analysis
    # ============================================================
    print("\n=== D. Slovak feature stability (bootstrap, 200 resamples) ===")
    rng = np.random.RandomState(SEED)
    boot_cv = {col: [] for col in PRODUCTION_COLS}
    n_slovak = len(df_slovak)
    for _ in range(200):
        sample = df_slovak.iloc[rng.choice(n_slovak, n_slovak, replace=True)]
        for col in PRODUCTION_COLS:
            vals = sample[col].dropna()
            if len(vals) > 1 and vals.mean() != 0:
                boot_cv[col].append(vals.std() / abs(vals.mean()))
    stability_report = {}
    for col in PRODUCTION_COLS:
        arr = np.array(boot_cv[col])
        stability_report[col] = {"bootstrap_cv_mean": float(arr.mean()), "bootstrap_cv_std": float(arr.std())}
        print(f"  {col:22s} bootstrap CV mean={arr.mean():.3f} std={arr.std():.3f}  (lower mean+lower std = more stable)")

    # ============================================================
    # PART E: temporal descriptors -- consistency across populations
    # ============================================================
    print("\n=== E. Temporal descriptors (fixed, non-tuned) ===")
    temporal_cols = [c for c in df_slovak.columns if any(c.startswith(f"{idx}_") for idx in INDEX_NAMES) and c not in PRODUCTION_COLS and "peak_value" not in c]
    for col in ["ndvi_peak_day_fraction", "ndyi_peak_day_fraction", "ndyi_minus_ndvi_peak_fraction", "ndvi_frac_above_mean_plus_halfstd", "ndvi_rise_fall_asymmetry", "ndvi_n_meaningful_cycles"]:
        if col not in df_slovak.columns:
            continue
        s = df_slovak[col].dropna()
        i = df_india[col].dropna()
        print(f"  {col:35s} Slovak: median={s.median():.3f} IQR=[{s.quantile(.25):.3f},{s.quantile(.75):.3f}]   India: median={i.median():.3f} IQR=[{i.quantile(.25):.3f},{i.quantile(.75):.3f}]")

    print("\n  Candidate temporal descriptors:")
    for name in candidates_raw:
        row = df_candidates[df_candidates["field_id"] == name].iloc[0]
        print(f"    {name}: ndvi_peak_frac={row.get('ndvi_peak_day_fraction')}, ndyi_peak_frac={row.get('ndyi_peak_day_fraction')}, n_cycles(ndvi)={row.get('ndvi_n_meaningful_cycles')}")

    # ============================================================
    # PART F: simulate the actual map-click decision
    # ============================================================
    print("\n=== F. Simulated map-click behavior on the 250 real India (unlabeled) fields ===")
    src_rows = [json.loads(l) for l in SERVER_TRAINING_DATA.read_text(encoding="utf-8").splitlines() if l.strip()]
    src_by_id = {r["fieldId"]: r for r in src_rows}

    amed_top_confidence = []
    for fid in df_india["field_id"]:
        src = src_by_id.get(fid)
        amed_top_confidence.append(src["amedConfidence"] if src else None)
    df_india_sim = df_india.copy()
    df_india_sim["amed_confidence"] = amed_top_confidence
    df_india_sim["sunflower_score"] = india_combined
    df_india_sim["india_percentile"] = [float((india_combined < s).mean() * 100) for s in india_combined]

    AMED_STRONG_THRESHOLD = 0.8
    eligible = df_india_sim["amed_confidence"].isna() | (df_india_sim["amed_confidence"] < AMED_STRONG_THRESHOLD)
    print(f"  {eligible.sum()}/{len(df_india_sim)} real fields would be ELIGIBLE for the sunflower check (Unknown or AMED confidence < {AMED_STRONG_THRESHOLD})")
    gate_7pct = eligible & (df_india_sim["sunflower_score"] >= 0.07)
    gate_top5pct = eligible & (df_india_sim["india_percentile"] >= 95)
    gate_top10pct = eligible & (df_india_sim["india_percentile"] >= 90)
    print(f"  Of those eligible, {gate_7pct.sum()} would trigger the CURRENT 7% gate (unchanged)")
    print(f"  Of those eligible, {gate_top5pct.sum()} would trigger an EXPLORATORY top-5%-of-India-background gate")
    print(f"  Of those eligible, {gate_top10pct.sum()} would trigger an EXPLORATORY top-10%-of-India-background gate")
    if gate_7pct.sum() > 0:
        print("  Real fields that would trigger the 7% gate (crop_label = real AMED result, NOT ground truth for sunflower):")
        print(df_india_sim[gate_7pct][["field_id", "crop_label", "amed_confidence", "sunflower_score"]].to_string(index=False))

    out = {
        "n_slovak": len(df_slovak), "n_india": len(df_india),
        "part_a_decomposition": df_decomp.to_dict(orient="records"),
        "part_a_intersection_features": intersection["feature"].tolist(),
        "part_a_overall_source_auc": float(overall_auc),
        "part_b_india_distribution": {"mean": float(india_combined.mean()), **{f"p{p}": float(np.percentile(india_combined, p)) for p in [50, 75, 90, 95, 99]}, "max": float(india_combined.max())},
        "part_c_candidates": candidate_results,
        "part_d_bootstrap_stability": stability_report,
        "part_f_simulation": {
            "n_eligible": int(eligible.sum()), "n_total": len(df_india_sim),
            "n_trigger_7pct_gate": int(gate_7pct.sum()), "n_trigger_top5pct_gate": int(gate_top5pct.sum()), "n_trigger_top10pct_gate": int(gate_top10pct.sum()),
        },
    }
    out_path = PILOT_DIR / "india_target_scoring_audit.json"
    out_path.write_text(json.dumps(out, indent=2, default=str), encoding="utf-8")
    print(f"\n[audit] wrote {out_path.relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    main()
