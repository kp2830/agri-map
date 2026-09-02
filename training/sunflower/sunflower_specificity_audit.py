"""
Zero-PU sunflower-specificity audit: does any combination of Sentinel-2 spectral/temporal
properties distinguish Slovak sunflower from the real Indian crop classes that currently trigger
the detector (RICE, CORN) -- without using Indian sunflower labels (none exist) and without
tuning toward Gadag/Sindgi? Reuses field_features (pilot_features.py), within_india_crop_signal /
feature_importance_for (pilot_within_source_crop_signal_check.py), fit_reference_frame /
score_population / three_method_scores (pilot_india_transfer_pu.py), diagnose
(pilot_leakage_diagnosis.py) -- not duplicated.

Run: training/.venv/bin/python3 training/sunflower/sunflower_specificity_audit.py
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import roc_auc_score

from pilot_features import build_observations, field_features
from pilot_india_transfer_pu import fit_reference_frame, score_population, three_method_scores
from pilot_leakage_diagnosis import diagnose
from pilot_within_source_crop_signal_check import within_india_crop_signal

REPO_ROOT = Path(__file__).resolve().parents[2]
PILOT_DIR = REPO_ROOT / "training" / "data" / "pilot"
SERVER_SCRIPTS = REPO_ROOT / "server" / "scripts"
SERVER_TRAINING_DATA = REPO_ROOT / "server" / "data" / "training" / "sunflower-belt-competing-crops.jsonl"
INDEX_NAMES = ["ndvi", "ndre", "ndwi", "ndyi"]
PRODUCTION_COLS = [f"{idx}_{stat}" for idx in INDEX_NAMES for stat in ["mean", "peak_value"]] + ["ndre_ndvi_peak_ratio"]
MIN_CROP_N = 10


def load_candidate(path: Path, key: str | None = None) -> dict:
    raw = json.loads(path.read_text(encoding="utf-8"))
    data = raw if key is None else raw[key]
    indices = data["indices"] if "indices" in data else data
    return {"indices": {idx: [{"date": p["date"], "mean": p["value"]} for p in indices[idx]["trajectory"]] for idx in INDEX_NAMES}}


def cohens_d(a: pd.Series, b: pd.Series) -> float | None:
    a, b = a.dropna(), b.dropna()
    if len(a) < 2 or len(b) < 2:
        return None
    pooled_std = np.sqrt(((len(a) - 1) * a.std() ** 2 + (len(b) - 1) * b.std() ** 2) / (len(a) + len(b) - 2))
    return float((a.mean() - b.mean()) / pooled_std) if pooled_std > 0 else None


def pairwise_auc(a: pd.Series, b: pd.Series) -> float | None:
    """AUC of using this single feature to distinguish population a (label=1) from b (label=0)."""
    a, b = a.dropna(), b.dropna()
    if len(a) < 3 or len(b) < 3:
        return None
    y = np.concatenate([np.ones(len(a)), np.zeros(len(b))])
    scores = np.concatenate([a.values, b.values])
    return float(roc_auc_score(y, scores))


def main() -> None:
    pos_rows = [json.loads(l) for l in (PILOT_DIR / "eurocrops_sentinel2_features.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]
    neg_rows = [json.loads(l) for l in (PILOT_DIR / "amed_sentinel2_features.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]
    src_rows = [json.loads(l) for l in SERVER_TRAINING_DATA.read_text(encoding="utf-8").splitlines() if l.strip()]
    src_by_id = {r["fieldId"]: r for r in src_rows}

    df_slovak = pd.DataFrame([field_features(r) | {"field_id": r["field_id"]} for r in pos_rows])
    df_india = pd.DataFrame([field_features(r) | {"field_id": r["field_id"], "crop_label": r["crop_label"]} for r in neg_rows])
    df_india["amed_confidence"] = df_india["field_id"].map(lambda fid: src_by_id.get(fid, {}).get("amedConfidence"))
    df_india["region"] = df_india["field_id"].map(lambda fid: src_by_id.get(fid, {}).get("region"))
    df_india["country"] = "India"  # required by within_india_crop_signal()

    # ============================================================
    # 1. AMED crop distribution
    # ============================================================
    print("=== 1. Real AMED crop distribution (250 unlabeled target fields) ===")
    counts = df_india["crop_label"].value_counts()
    print(counts.to_string())
    print(f"\nAMED confidence: mean={df_india['amed_confidence'].mean():.3f} median={df_india['amed_confidence'].median():.3f}")
    major_crops = counts[counts >= MIN_CROP_N].index.tolist()
    print(f"Crops with >= {MIN_CROP_N} fields (used for per-crop comparison below): {major_crops}")

    # ============================================================
    # 2. Slovak sunflower vs EACH Indian crop class
    # ============================================================
    print("\n=== 2. Slovak sunflower vs each Indian crop class (effect size + pairwise AUC) ===")
    compare_cols = PRODUCTION_COLS
    per_crop_report = {}
    for crop in major_crops:
        crop_df = df_india[df_india["crop_label"] == crop]
        rows = []
        for col in compare_cols:
            d = cohens_d(df_slovak[col], crop_df[col])
            auc = pairwise_auc(df_slovak[col], crop_df[col])
            rows.append({"feature": col, "slovak_mean": float(df_slovak[col].mean()), f"{crop}_mean": float(crop_df[col].mean()), "cohens_d": d, "pairwise_auc": auc})
        per_crop_report[crop] = rows
        print(f"\n  Slovak vs {crop} (n={len(crop_df)}):")
        for r in sorted(rows, key=lambda x: -abs(x["cohens_d"]) if x["cohens_d"] is not None else 0)[:4]:
            print(f"    {r['feature']:22s} slovak={r['slovak_mean']:.3f} {crop}={r[f'{crop}_mean']:.3f}  d={r['cohens_d']:.2f}  AUC={r['pairwise_auc']:.3f}" if r['cohens_d'] is not None else f"    {r['feature']}: n/a")

    # ============================================================
    # 3. RICE and CORN false-positive deep dive
    # ============================================================
    print("\n=== 3. RICE and CORN false-positive deep dive ===")
    scaler, medians, X_pos = fit_reference_frame(df_slovak, PRODUCTION_COLS)
    X_india = score_population(df_india, PRODUCTION_COLS, scaler, medians)
    india_scores_all = three_method_scores(X_pos, X_india)
    df_india["current_score"] = np.vstack([india_scores_all[m]["likeness"] for m in india_scores_all]).mean(axis=0)
    df_india["maha_component"] = india_scores_all["mahalanobis"]["likeness"]
    df_india["knn_component"] = india_scores_all["knn"]["likeness"]

    for crop in ["RICE", "CORN"]:
        crop_df = df_india[df_india["crop_label"] == crop].sort_values("current_score", ascending=False)
        print(f"\n  Top 3 highest-scoring {crop} fields:")
        print(crop_df.head(3)[["field_id", "current_score", "maha_component", "knn_component"] + compare_cols].to_string(index=False))

    # ============================================================
    # 4 & 5. NDVI peak specificity + vigor-confound
    # ============================================================
    print("\n=== 4. NDVI peak: Slovak vs Rice vs Corn vs other crops (pairwise AUC) ===")
    for crop in major_crops:
        auc = pairwise_auc(df_slovak["ndvi_peak_value"], df_india[df_india["crop_label"] == crop]["ndvi_peak_value"])
        print(f"  Slovak vs {crop}: ndvi_peak_value AUC = {auc:.3f}" if auc else f"  Slovak vs {crop}: n/a")

    print("\n=== 5. Vigor-confound: correlation of current score with vigor features (within India background) ===")
    vigor_corrs = {}
    for col in ["ndvi_peak_value", "ndvi_mean", "ndre_peak_value", "ndwi_peak_value"]:
        corr = float(df_india["current_score"].corr(df_india[col]))
        vigor_corrs[col] = corr
        print(f"  corr(current_score, {col}) = {corr:.3f}")

    # ============================================================
    # 6 & 7. Frozen multivariate feature selection -- NO candidates referenced
    # ============================================================
    print("\n=== 6 & 7. Frozen feature-selection procedure (Slovak + India background ONLY -- Gadag/Sindgi NOT used) ===")
    candidate_feature_sets = {
        "current_production_9": PRODUCTION_COLS,
        "low_leak_3": ["ndvi_peak_value", "ndre_peak_value", "ndvi_mean"],  # from last round's intersection + top low-leak feature
        "low_leak_4_plus_ratio": ["ndvi_peak_value", "ndre_peak_value", "ndvi_mean", "ndre_ndvi_peak_ratio"],
        "ndvi_peak_only": ["ndvi_peak_value"],
    }
    selection_report = {}
    for name, cols in candidate_feature_sets.items():
        combined = pd.concat([df_slovak.assign(source="slovak"), df_india.assign(source="india")], ignore_index=True)
        sep = diagnose(combined, cols, name)
        crop_signal = within_india_crop_signal(df_india, cols)
        selection_report[name] = {
            "n_features": len(cols),
            "source_separability_roc_auc": sep["roc_auc"],
            "within_india_crop_signal_accuracy": crop_signal["cv_accuracy"],
            "within_india_majority_baseline": crop_signal["majority_class_baseline_accuracy"],
            "within_india_lift": crop_signal["lift_over_baseline"],
            "within_india_roc_auc": crop_signal["roc_auc_macro_ovr"],
        }
        print(f"\n  {name} ({len(cols)} feats):")
        print(f"    source separability ROC-AUC (lower is more domain-robust): {sep['roc_auc']:.4f}")
        print(f"    within-India 7-crop signal: acc={crop_signal['cv_accuracy']:.4f} (baseline={crop_signal['majority_class_baseline_accuracy']:.4f}, lift={crop_signal['lift_over_baseline']:+.4f}) ROC-AUC={crop_signal['roc_auc_macro_ovr']:.4f}")

    # FREEZE: select the representation with the best (source_auc lower is better, crop_lift higher
    # is better) trade-off -- decided by this objective rule, not by candidate scores.
    frozen_name = min(selection_report, key=lambda k: selection_report[k]["source_separability_roc_auc"] - selection_report[k]["within_india_lift"])
    print(f"\n  FROZEN representation (lowest [source_AUC - within_India_lift]): {frozen_name} = {candidate_feature_sets[frozen_name]}")
    frozen_cols = candidate_feature_sets[frozen_name]

    # ============================================================
    # 8. Simulated map-click, frozen representation
    # ============================================================
    print("\n=== 8. Simulated map-click, FROZEN representation ===")
    scaler_f, medians_f, X_pos_f = fit_reference_frame(df_slovak, frozen_cols)
    X_india_f = score_population(df_india, frozen_cols, scaler_f, medians_f)
    frozen_scores_all = three_method_scores(X_pos_f, X_india_f)
    df_india["frozen_score"] = np.vstack([frozen_scores_all[m]["likeness"] for m in frozen_scores_all]).mean(axis=0)
    df_india["frozen_percentile"] = [float((df_india["frozen_score"] < s).mean() * 100) for s in df_india["frozen_score"]]

    eligible = df_india["amed_confidence"].isna() | (df_india["amed_confidence"] < 0.8)
    current_gate = eligible & (df_india["current_score"] >= 0.07)
    frozen_gate_top5 = eligible & (df_india["frozen_percentile"] >= 95)
    print(f"  eligible fields: {eligible.sum()}/250")
    print(f"  current 7% gate triggers: {current_gate.sum()} -- by crop: {df_india[current_gate]['crop_label'].value_counts().to_dict()}")
    print(f"  frozen-representation top-5%-of-background gate triggers: {frozen_gate_top5.sum()} -- by crop: {df_india[frozen_gate_top5]['crop_label'].value_counts().to_dict()}")

    # ============================================================
    # 9. Candidates -- ONLY NOW evaluated, after freezing
    # ============================================================
    print("\n=== 9. Candidates evaluated AFTER freezing (external sanity check, not validation) ===")
    candidates_raw = {
        "Gadag-dated": load_candidate(SERVER_SCRIPTS / "datedCandidateFullResult.json"),
        "Sindgi-Bijapur": load_candidate(SERVER_SCRIPTS / "secondCandidateFullResult.json"),
        "Karnataka-1": load_candidate(SERVER_SCRIPTS / "karnatakaCandidateFullResult.json"),
    }
    extra = json.loads((SERVER_SCRIPTS / "additionalCandidatesFullResults.json").read_text(encoding="utf-8"))
    for name in extra:
        candidates_raw[name] = load_candidate(SERVER_SCRIPTS / "additionalCandidatesFullResults.json", key=name)
    df_candidates = pd.DataFrame([field_features(c) | {"field_id": name} for name, c in candidates_raw.items()])
    X_cand_f = score_population(df_candidates, frozen_cols, scaler_f, medians_f)
    cand_scores_all = three_method_scores(X_pos_f, X_cand_f)
    cand_combined = np.vstack([cand_scores_all[m]["likeness"] for m in cand_scores_all]).mean(axis=0)

    candidate_results = {}
    for i, name in enumerate(df_candidates["field_id"]):
        score = float(cand_combined[i])
        pct = float((df_india["frozen_score"] < score).mean() * 100)
        candidate_results[name] = {"frozen_score": score, "india_percentile": pct}
        print(f"    {name:20s} frozen_score={score*100:.2f}%  india_percentile={pct:.1f}")

    out = {
        "amed_crop_distribution": counts.to_dict(),
        "per_crop_comparison": per_crop_report,
        "vigor_correlation": vigor_corrs,
        "feature_selection_candidates": selection_report,
        "frozen_representation": {"name": frozen_name, "features": frozen_cols},
        "simulation": {
            "n_eligible": int(eligible.sum()),
            "current_gate_n": int(current_gate.sum()), "current_gate_crops": df_india[current_gate]["crop_label"].value_counts().to_dict(),
            "frozen_gate_n": int(frozen_gate_top5.sum()), "frozen_gate_crops": df_india[frozen_gate_top5]["crop_label"].value_counts().to_dict(),
        },
        "candidates_after_freezing": candidate_results,
    }
    out_path = PILOT_DIR / "sunflower_specificity_audit.json"
    out_path.write_text(json.dumps(out, indent=2, default=str), encoding="utf-8")
    print(f"\n[audit] wrote {out_path.relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    main()
