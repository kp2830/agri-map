"""
Zero-PU evaluation-validity audit: does the v1->v2 Gadag improvement (6.06%->11.47%) survive a
fair, matched-cohort comparison, or is it confounded by the fact that v2 discards 70% of the
India background population? Reuses v1 (isolated_cycle_transfer.py) and v2
(isolated_cycle_transfer_v2.py) verbatim -- not duplicated -- plus the same scoring machinery
(combo_score, leave_one_field_out_source_scores, diagnose) used throughout this project.

Run: training/.venv/bin/python3 training/sunflower/evaluation_validity_audit.py
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import StratifiedKFold, cross_val_predict
from sklearn.metrics import roc_auc_score

from pilot_features import build_observations, field_features as raw_window_production_features
from pilot_ensemble_score import combo_score, leave_one_field_out_source_scores
from pilot_leakage_diagnosis import diagnose
import isolated_cycle_transfer as v1
import isolated_cycle_transfer_v2 as v2

REPO_ROOT = Path(__file__).resolve().parents[2]
PILOT_DIR = REPO_ROOT / "training" / "data" / "pilot"
SERVER_SCRIPTS = REPO_ROOT / "server" / "scripts"
INDEX_NAMES = ["ndvi", "ndre", "ndwi", "ndyi"]
PRODUCTION_COLS = v1.PRODUCTION_COLS


def raw_preisolation_stats(field_result: dict) -> dict:
    """Statistics computed BEFORE any cycle isolation -- the inputs v2's algorithm actually
    consumes -- used for the selection-bias audit."""
    out = {}
    for idx in INDEX_NAMES:
        obs = build_observations(field_result["indices"].get(idx, []))
        if not obs:
            for k in ["mean", "std", "range", "n_obs"]:
                out[f"{idx}_raw_{k}"] = None
            continue
        values = [o.value for o in obs]
        out[f"{idx}_raw_mean"] = float(np.mean(values))
        out[f"{idx}_raw_std"] = float(np.std(values, ddof=1)) if len(values) > 1 else None
        out[f"{idx}_raw_range"] = float(max(values) - min(values))
        out[f"{idx}_raw_n_obs"] = len(obs)
    ndvi_obs = build_observations(field_result["indices"].get("ndvi", []))
    out["date_span_days"] = max(o.days_since_start for o in ndvi_obs) if ndvi_obs else None
    return out


def load_candidate(path: Path, key: str | None = None) -> dict:
    raw = json.loads(path.read_text(encoding="utf-8"))
    data = raw if key is None else raw[key]
    indices = data["indices"] if "indices" in data else data
    return {"indices": {idx: [{"date": p["date"], "mean": p["value"]} for p in indices[idx]["trajectory"]] for idx in INDEX_NAMES}}


def main() -> None:
    pos_rows = [json.loads(l) for l in (PILOT_DIR / "eurocrops_sentinel2_features.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]
    neg_rows = [json.loads(l) for l in (PILOT_DIR / "amed_sentinel2_features.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]

    # === Build v1 + v2 features + raw pre-isolation stats for every field, once ===
    slovak_all, india_all = [], []
    for r in pos_rows:
        rec = {"field_id": r["field_id"]}
        v1f = v1.field_isolated_features(r)
        v2f = v2.field_isolated_features_v2(r)
        rec["v1_ok"] = v1f is not None
        rec["v2_ok"] = v2f is not None
        if v1f:
            rec.update({f"v1_{k}": val for k, val in v1f.items() if k not in ("ndvi_shape_vector", "ndyi_shape_vector")})
        if v2f:
            rec.update({f"v2_{k}": val for k, val in v2f.items()})
        rec.update(raw_preisolation_stats(r))
        slovak_all.append(rec)
    df_slovak_all = pd.DataFrame(slovak_all)

    for r in neg_rows:
        rec = {"field_id": r["field_id"], "crop_label": r["crop_label"]}
        v1f = v1.field_isolated_features(r)
        v2f = v2.field_isolated_features_v2(r)
        rec["v1_ok"] = v1f is not None
        rec["v2_ok"] = v2f is not None
        if v1f:
            rec.update({f"v1_{k}": val for k, val in v1f.items() if k not in ("ndvi_shape_vector", "ndyi_shape_vector")})
        if v2f:
            rec.update({f"v2_{k}": val for k, val in v2f.items()})
        rec.update(raw_preisolation_stats(r))
        india_all.append(rec)
    df_india_all = pd.DataFrame(india_all)

    print("=== 1. Common evaluation cohort ===")
    slovak_v1n, slovak_v2n, slovak_both = df_slovak_all["v1_ok"].sum(), df_slovak_all["v2_ok"].sum(), (df_slovak_all["v1_ok"] & df_slovak_all["v2_ok"]).sum()
    india_v1n, india_v2n, india_both = df_india_all["v1_ok"].sum(), df_india_all["v2_ok"].sum(), (df_india_all["v1_ok"] & df_india_all["v2_ok"]).sum()
    print(f"Slovak: v1={slovak_v1n} v2={slovak_v2n} both={slovak_both} (of 100)")
    print(f"India:  v1={india_v1n} v2={india_v2n} both={india_both} (of 250)")

    slovak_common = df_slovak_all[df_slovak_all["v1_ok"] & df_slovak_all["v2_ok"]].copy()
    india_common = df_india_all[df_india_all["v1_ok"] & df_india_all["v2_ok"]].copy()
    print(f"\nCommon cohort sizes used below: Slovak={len(slovak_common)}, India={len(india_common)}")

    # === 2. Selection-bias audit: v2-retained vs v2-rejected India fields, on PRE-isolation stats ===
    print("\n=== 2. Selection-bias audit (India, pre-isolation raw stats: v2-retained vs v2-rejected) ===")
    raw_cols = [c for c in df_india_all.columns if c.startswith(tuple(f"{i}_raw_" for i in INDEX_NAMES)) or c == "date_span_days"]
    retained = df_india_all[df_india_all["v2_ok"]]
    rejected = df_india_all[~df_india_all["v2_ok"]]
    print(f"retained n={len(retained)}, rejected n={len(rejected)}")
    bias_report = {}
    for col in raw_cols:
        r_vals = retained[col].dropna()
        j_vals = rejected[col].dropna()
        if len(r_vals) < 5 or len(j_vals) < 5:
            continue
        diff = r_vals.mean() - j_vals.mean()
        bias_report[col] = {"retained_mean": float(r_vals.mean()), "rejected_mean": float(j_vals.mean()), "diff": float(diff)}
        print(f"  {col:20s} retained_mean={r_vals.mean():.3f}  rejected_mean={j_vals.mean():.3f}  diff={diff:+.3f}")

    X = df_india_all[raw_cols].copy()
    X = X.fillna(X.median(numeric_only=True))
    y = df_india_all["v2_ok"].astype(int)
    skf = StratifiedKFold(n_splits=3, shuffle=True, random_state=0)
    probe = RandomForestClassifier(n_estimators=150, random_state=0)
    proba = cross_val_predict(probe, X, y, cv=skf, method="predict_proba")[:, 1]
    auc = roc_auc_score(y, proba)
    probe_full = RandomForestClassifier(n_estimators=150, random_state=0).fit(X, y)
    importances = sorted(zip(raw_cols, probe_full.feature_importances_), key=lambda t: -t[1])
    print(f"\n  Probe: can pre-isolation raw stats predict whether v2 will retain a field? ROC-AUC={auc:.4f}")
    print(f"  Top predictors of v2-retention: {[(f, round(i,3)) for f,i in importances[:5]]}")

    # === 3, 6, 7: matched v1-vs-v2 comparison on the COMMON cohort ===
    print("\n=== 3, 6 & 7: v1 vs v2 on the COMMON cohort (fair, matched comparison) ===")
    v1_cols_common = [f"v1_{c}" for c in PRODUCTION_COLS]
    v2_cols_common = [f"v2_{c}" for c in PRODUCTION_COLS]
    slovak_v1_df = slovak_common[v1_cols_common].rename(columns=lambda c: c[3:])
    slovak_v2_df = slovak_common[v2_cols_common].rename(columns=lambda c: c[3:])
    india_v1_df = india_common[v1_cols_common].rename(columns=lambda c: c[3:])
    india_v2_df = india_common[v2_cols_common].rename(columns=lambda c: c[3:])

    lofo_v1 = leave_one_field_out_source_scores(slovak_v1_df, PRODUCTION_COLS)
    lofo_v2 = leave_one_field_out_source_scores(slovak_v2_df, PRODUCTION_COLS)
    india_scores_v1 = combo_score(slovak_v1_df, india_v1_df, PRODUCTION_COLS)
    india_scores_v2 = combo_score(slovak_v2_df, india_v2_df, PRODUCTION_COLS)

    def dist_report(name: str, scores: np.ndarray) -> dict:
        d = {"n": len(scores), "mean": float(scores.mean()), "median": float(np.median(scores)),
             "p75": float(np.percentile(scores, 75)), "p90": float(np.percentile(scores, 90)),
             "p95": float(np.percentile(scores, 95)), "p99": float(np.percentile(scores, 99)), "max": float(scores.max())}
        print(f"  {name}: n={d['n']} mean={d['mean']*100:.2f}% median={d['median']*100:.2f}% p75={d['p75']*100:.2f}% p90={d['p90']*100:.2f}% p95={d['p95']*100:.2f}% p99={d['p99']*100:.2f}% max={d['max']*100:.2f}%")
        return d

    india_v1_dist = dist_report("India background v1 (common cohort)", india_scores_v1)
    india_v2_dist = dist_report("India background v2 (common cohort)", india_scores_v2)

    combined_v1 = pd.concat([slovak_v1_df.assign(source="slovak"), india_v1_df.assign(source="india")], ignore_index=True)
    combined_v2 = pd.concat([slovak_v2_df.assign(source="slovak"), india_v2_df.assign(source="india")], ignore_index=True)
    sep_v1 = diagnose(combined_v1, PRODUCTION_COLS, "v1_common_cohort")
    sep_v2 = diagnose(combined_v2, PRODUCTION_COLS, "v2_common_cohort")
    print(f"\n  Source separability (COMMON cohort): v1 ROC-AUC={sep_v1['roc_auc']:.4f}  v2 ROC-AUC={sep_v2['roc_auc']:.4f}")

    # Paired comparison: for the SAME India fields, did v2 raise scores broadly or just for Gadag-like fields?
    paired_delta = india_scores_v2 - india_scores_v1
    print(f"\n  Paired per-field score change (v2-v1) on common India cohort: mean={paired_delta.mean()*100:+.3f}pp  median={np.median(paired_delta)*100:+.3f}pp  n_increased={int((paired_delta>0).sum())}/{len(paired_delta)}  n_decreased={int((paired_delta<0).sum())}")

    # === Candidates: A (raw production), B (v1), C (v2), scored against the COMMON-cohort reference frames ===
    print("\n=== Candidates: raw vs v1 vs v2, scored against the SAME common-cohort Slovak reference ===")
    candidates_raw = {
        "Karnataka-1": load_candidate(SERVER_SCRIPTS / "karnatakaCandidateFullResult.json"),
        "Gadag-dated": load_candidate(SERVER_SCRIPTS / "datedCandidateFullResult.json"),
        "Sindgi-Bijapur": load_candidate(SERVER_SCRIPTS / "secondCandidateFullResult.json"),
    }
    extra = json.loads((SERVER_SCRIPTS / "additionalCandidatesFullResults.json").read_text(encoding="utf-8"))
    for name in extra:
        candidates_raw[name] = load_candidate(SERVER_SCRIPTS / "additionalCandidatesFullResults.json", key=name)

    candidate_report = {}
    for name, c in candidates_raw.items():
        entry = {}
        # A: raw full-window production
        raw_feats = raw_window_production_features(c)  # same production feature builder, no isolation
        df_raw_cand = pd.DataFrame([raw_feats])
        # Use the FULL (uncommon) v1 Slovak/India for the "raw" comparison since raw isn't isolation-dependent
        full_slovak_raw = pd.DataFrame([raw_window_production_features(r) for r in pos_rows])
        a_score = combo_score(full_slovak_raw, df_raw_cand, PRODUCTION_COLS)[0]
        entry["A_raw_production"] = float(a_score)

        # B: v1 isolated cycle, scored against the COMMON cohort Slovak reference
        v1f = v1.field_isolated_features(c)
        if v1f:
            df_b = pd.DataFrame([{k: val for k, val in v1f.items() if k not in ("ndvi_shape_vector", "ndyi_shape_vector")}])
            b_score = combo_score(slovak_v1_df, df_b[PRODUCTION_COLS], PRODUCTION_COLS)[0]
            b_pct = float((india_scores_v1 < b_score).mean() * 100)
            entry["B_v1_isolated"] = {"score": float(b_score), "percentile_common_cohort": b_pct, "cycle": [v1f["cycle_start_day"], v1f["cycle_end_day"]]}
        else:
            entry["B_v1_isolated"] = None

        # C: v2 unified cycle, scored against the COMMON cohort Slovak reference (fair, matched)
        v2f = v2.field_isolated_features_v2(c)
        if v2f:
            df_c = pd.DataFrame([v2f])
            c_score = combo_score(slovak_v2_df, df_c[PRODUCTION_COLS], PRODUCTION_COLS)[0]
            c_pct = float((india_scores_v2 < c_score).mean() * 100)
            entry["C_v2_unified"] = {"score": float(c_score), "percentile_common_cohort": c_pct, "cycle": [v2f["cycle_start_day"], v2f["cycle_end_day"]], "pct_retained": v2f["pct_retained"]}
        else:
            entry["C_v2_unified"] = None

        candidate_report[name] = entry
        print(f"\n  {name}:")
        print(f"    A (raw production): {a_score*100:.2f}%")
        print(f"    B (v1 isolated, common-cohort pct): {entry['B_v1_isolated']}")
        print(f"    C (v2 unified, common-cohort pct): {entry['C_v2_unified']}")

    # === 4. Feature-level decomposition of Gadag's v1->v2 move ===
    print("\n=== 4. Feature-level decomposition: Gadag v1 -> v2 ===")
    gadag_v1f = v1.field_isolated_features(candidates_raw["Gadag-dated"])
    gadag_v2f = v2.field_isolated_features_v2(candidates_raw["Gadag-dated"])
    model_path = REPO_ROOT / "server" / "src" / "services" / "agricultural" / "sunflower" / "model" / "sunflowerLikenessModel.v1.json"
    model = json.loads(model_path.read_text(encoding="utf-8"))
    print(f"  {'feature':22s} {'v1_value':>10s} {'v2_value':>10s} {'delta':>10s}")
    for col in PRODUCTION_COLS:
        v1v, v2v = gadag_v1f.get(col), gadag_v2f.get(col)
        if v1v is None or v2v is None:
            continue
        print(f"  {col:22s} {v1v:10.4f} {v2v:10.4f} {v2v-v1v:+10.4f}")

    out = {
        "cohort_sizes": {"slovak_v1": int(slovak_v1n), "slovak_v2": int(slovak_v2n), "slovak_both": int(slovak_both),
                          "india_v1": int(india_v1n), "india_v2": int(india_v2n), "india_both": int(india_both)},
        "selection_bias": {"retained_vs_rejected_stats": bias_report, "probe_roc_auc": float(auc), "top_predictors": [(f, float(i)) for f, i in importances[:5]]},
        "india_background_common_cohort": {"v1": india_v1_dist, "v2": india_v2_dist},
        "source_separability_common_cohort": {"v1_roc_auc": sep_v1["roc_auc"], "v2_roc_auc": sep_v2["roc_auc"]},
        "paired_score_change": {"mean_pp": float(paired_delta.mean() * 100), "median_pp": float(np.median(paired_delta) * 100), "n_increased": int((paired_delta > 0).sum()), "n_total": len(paired_delta)},
        "candidates": candidate_report,
        "gadag_feature_decomposition": {col: {"v1": gadag_v1f.get(col), "v2": gadag_v2f.get(col)} for col in PRODUCTION_COLS},
    }
    out_path = PILOT_DIR / "evaluation_validity_audit.json"
    out_path.write_text(json.dumps(out, indent=2, default=str), encoding="utf-8")
    print(f"\n[audit] wrote {out_path.relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    main()
