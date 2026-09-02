"""
Pilot training + evaluation: leakage audit, feature-ablation Random Forest models, European
cross-validation, India transfer analysis, feature importance, top-candidate inspection.

Reuses assert_no_source_leakage from train.py (not duplicated) and the real feature matrix
from pilot_features.py. Never trains if the leakage guard fails — see main()'s hard stop.

Run: training/.venv/bin/python3 training/sunflower/pilot_train_eval.py
"""

from __future__ import annotations

import json
import platform
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import sklearn
from sklearn.calibration import CalibratedClassifierCV
from sklearn.ensemble import RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.metrics import (
    average_precision_score,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.model_selection import StratifiedKFold
from sklearn.pipeline import Pipeline

from train import assert_no_source_leakage

REPO_ROOT = Path(__file__).resolve().parents[2]
PILOT_DIR = REPO_ROOT / "training" / "data" / "pilot"
MODEL_SEED = 42
N_CV_FOLDS = 5

FEATURE_GROUPS = {
    "aggregate": [f"{idx}_{stat}" for idx in ["ndvi", "ndre", "ndwi", "ndyi"] for stat in ["mean", "peak_value"]] + ["ndre_ndvi_peak_ratio"],
    "temporal": [
        f"{idx}_{stat}"
        for idx in ["ndvi", "ndre", "ndwi", "ndyi"]
        for stat in ["slope", "pre_peak_slope", "post_peak_slope", "growth_acceleration", "variability"]
    ],
}
FEATURE_GROUPS["full_s2"] = FEATURE_GROUPS["aggregate"] + FEATURE_GROUPS["temporal"]


def load_feature_matrix() -> pd.DataFrame:
    path = PILOT_DIR / "pilot_feature_matrix.jsonl"
    return pd.read_json(path, orient="records", lines=True)


def missingness_report(df: pd.DataFrame, feature_cols: list[str]) -> dict:
    report = {}
    for col in feature_cols:
        by_source = {}
        for source, group in df.groupby("source"):
            missing = group[col].isna().mean()
            real = group[col].dropna()
            by_source[source] = {
                "missing_fraction": round(float(missing), 3),
                "mean": round(float(real.mean()), 4) if len(real) else None,
                "std": round(float(real.std()), 4) if len(real) > 1 else None,
            }
        report[col] = by_source
    return report


def build_model(config: str) -> Pipeline:
    return Pipeline(
        [
            ("impute", SimpleImputer(strategy="median")),  # fit on train fold only — no leakage, standard sklearn Pipeline behavior
            ("clf", CalibratedClassifierCV(RandomForestClassifier(n_estimators=300, max_depth=6, min_samples_leaf=3, class_weight="balanced", random_state=MODEL_SEED), method="isotonic", cv=3)),
        ]
    )


def evaluate_cv(X: pd.DataFrame, y: pd.Series) -> dict:
    skf = StratifiedKFold(n_splits=N_CV_FOLDS, shuffle=True, random_state=MODEL_SEED)
    y_true_all, y_proba_all = [], []
    for train_idx, test_idx in skf.split(X, y):
        model = build_model("cv")
        model.fit(X.iloc[train_idx], y.iloc[train_idx])
        proba = model.predict_proba(X.iloc[test_idx])[:, 1]
        y_true_all.extend(y.iloc[test_idx])
        y_proba_all.extend(proba)

    y_true_all = np.array(y_true_all)
    y_proba_all = np.array(y_proba_all)
    y_pred_all = (y_proba_all >= 0.5).astype(int)

    return {
        "roc_auc": float(roc_auc_score(y_true_all, y_proba_all)),
        "pr_auc": float(average_precision_score(y_true_all, y_proba_all)),
        "precision": float(precision_score(y_true_all, y_pred_all, zero_division=0)),
        "recall": float(recall_score(y_true_all, y_pred_all, zero_division=0)),
        "f1": float(f1_score(y_true_all, y_pred_all, zero_division=0)),
        "confusion_matrix": confusion_matrix(y_true_all, y_pred_all).tolist(),
        "n_folds": N_CV_FOLDS,
    }


def india_transfer_analysis(model: Pipeline, X_india: pd.DataFrame, india_meta: pd.DataFrame) -> dict:
    proba = model.predict_proba(X_india)[:, 1]
    thresholds = [0.1, 0.2, 0.3, 0.5, 0.7, 0.9]
    threshold_counts = {str(t): int((proba >= t).sum()) for t in thresholds}
    threshold_rates = {str(t): round(float((proba >= t).mean()), 4) for t in thresholds}

    top20_idx = np.argsort(proba)[::-1][:20]
    top20 = []
    for i in top20_idx:
        row = india_meta.iloc[i]
        top20.append(
            {
                "field_id": row["field_id"],
                "probability": round(float(proba[i]), 4),
                "amed_crop_label": row["crop_label"],
                "label_note": "candidate — NOT confirmed sunflower",
            }
        )

    return {
        "n_fields": len(proba),
        "mean_probability": float(np.mean(proba)),
        "median_probability": float(np.median(proba)),
        "p90": float(np.percentile(proba, 90)),
        "p95": float(np.percentile(proba, 95)),
        "p99": float(np.percentile(proba, 99)),
        "threshold_counts": threshold_counts,
        "threshold_false_positive_rates": threshold_rates,
        "top_20_candidates": top20,
        "note": "These are AMED-CONFIRMED NEGATIVE fields. Any nonzero probability here is a false positive by definition — this measures how often/how strongly the European model fires on real Indian agricultural fields, NOT Indian sunflower recall.",
    }


def main() -> None:
    df = load_feature_matrix()
    print(f"[pilot_train_eval] loaded {len(df)} rows ({df['label'].sum()} positive, {(df['label']==0).sum()} negative)")

    all_feature_cols = FEATURE_GROUPS["full_s2"]

    # --- Step 7: leakage audit ---
    print("\n[pilot_train_eval] === missingness/mean/std by source (audit) ===")
    report = missingness_report(df, all_feature_cols)
    for col, by_source in list(report.items())[:5]:  # print a sample; full report saved to disk
        print(f"  {col}: {by_source}")

    leak_df = df.rename(columns={"source": "label_source"})
    print("\n[pilot_train_eval] running assert_no_source_leakage on the real feature matrix...")
    try:
        assert_no_source_leakage(df[all_feature_cols], leak_df)
        print("[pilot_train_eval] LEAKAGE GUARD PASSED — features do not trivially identify source.")
        leakage_result = {"passed": True}
    except RuntimeError as e:
        print(f"[pilot_train_eval] LEAKAGE GUARD FAILED: {e}")
        leakage_result = {"passed": False, "reason": str(e)}
        (PILOT_DIR / "pilot_results.json").write_text(json.dumps({"leakage": leakage_result, "stopped": True}, indent=2), encoding="utf-8")
        print("\n[pilot_train_eval] STOPPING per Step 19 stop condition #3 — source leakage detected. Not training.")
        return

    europe_df = df[df["country"] == "Slovakia"].copy()
    india_df = df[df["country"] == "India"].copy()
    print(f"\n[pilot_train_eval] {len(europe_df)} European (all positive) + {len(india_df)} Indian (all confirmed negative) rows")

    # For CV, need both classes — combine a random subset of India negatives with all Europe
    # positives ONLY for the CV/training step (the India set is also separately used whole for
    # the transfer analysis below).
    rng = np.random.RandomState(MODEL_SEED)
    cv_negative_sample = india_df.sample(n=min(len(europe_df), len(india_df)), random_state=MODEL_SEED)
    cv_df = pd.concat([europe_df, cv_negative_sample], ignore_index=True)

    results = {"leakage": leakage_result, "ablation": {}, "config": {"model_seed": MODEL_SEED, "n_folds": N_CV_FOLDS, "sklearn_version": sklearn.__version__, "python_version": platform.python_version(), "run_at_utc": datetime.now(timezone.utc).isoformat()}}

    final_model = None
    final_X_cols = None
    for config_name, cols in [("A_aggregate", FEATURE_GROUPS["aggregate"]), ("B_temporal", FEATURE_GROUPS["temporal"]), ("C_full_s2", FEATURE_GROUPS["full_s2"])]:
        X = cv_df[cols]
        y = cv_df["label"]
        print(f"\n[pilot_train_eval] === Model {config_name} ({len(cols)} features) ===")
        cv_metrics = evaluate_cv(X, y)
        print(f"  ROC-AUC={cv_metrics['roc_auc']:.3f}  PR-AUC={cv_metrics['pr_auc']:.3f}  F1={cv_metrics['f1']:.3f}  precision={cv_metrics['precision']:.3f}  recall={cv_metrics['recall']:.3f}")
        results["ablation"][config_name] = {"features": cols, "cv_metrics": cv_metrics}

        if config_name == "C_full_s2":
            final_model = build_model("final")
            final_model.fit(X, y)
            final_X_cols = cols
            importances = final_model.named_steps["clf"].calibrated_classifiers_[0].estimator.feature_importances_
            results["feature_importance"] = sorted(zip(cols, [float(i) for i in importances]), key=lambda x: -x[1])

    print("\n[pilot_train_eval] === India transfer analysis (Model C, full S2) ===")
    india_transfer = india_transfer_analysis(final_model, india_df[final_X_cols], india_df[["field_id", "crop_label"]])
    results["india_transfer"] = india_transfer
    print(f"  mean_proba={india_transfer['mean_probability']:.4f}  median={india_transfer['median_probability']:.4f}  p95={india_transfer['p95']:.4f}")
    print(f"  threshold counts: {india_transfer['threshold_counts']}")

    # --- NDYI-specific analysis (Step 13) ---
    print("\n[pilot_train_eval] === NDYI ablation ===")
    ndyi_configs = {
        "ndyi_alone": ["ndyi_mean", "ndyi_peak_value"],
        "ndyi_ndvi": ["ndyi_mean", "ndyi_peak_value", "ndvi_mean", "ndvi_peak_value"],
        "ndyi_temporal": [c for c in FEATURE_GROUPS["temporal"] if c.startswith("ndyi")],
        "full_minus_ndyi": [c for c in FEATURE_GROUPS["full_s2"] if not c.startswith("ndyi")],
    }
    results["ndyi_ablation"] = {}
    for name, cols in ndyi_configs.items():
        cols = [c for c in cols if c in cv_df.columns]
        if not cols:
            continue
        m = evaluate_cv(cv_df[cols], cv_df["label"])
        print(f"  {name} ({len(cols)} feats): ROC-AUC={m['roc_auc']:.3f} PR-AUC={m['pr_auc']:.3f}")
        results["ndyi_ablation"][name] = {"features": cols, "cv_metrics": m}

    (PILOT_DIR / "pilot_results.json").write_text(json.dumps(results, indent=2, default=str), encoding="utf-8")
    (PILOT_DIR / "pilot_config.json").write_text(json.dumps(results["config"], indent=2), encoding="utf-8")
    print(f"\n[pilot_train_eval] wrote pilot_results.json and pilot_config.json")


if __name__ == "__main__":
    main()
