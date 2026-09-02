"""
Orthogonal sanity check ("is there a crop-specific signal in the spectral/temporal features at
all?"). The cross-source (Europe vs. India) probe is dominated by a geography/domain-shift
signal (see pilot_leakage_diagnosis.py) -- that alone doesn't tell us whether these Sentinel-2
features carry ANY real crop-discriminative information, or whether they are simply crop-blind.

This answers that narrower question WITHIN a single geography, where there is no cross-country
domain shift to confound the result: using only the real AMED (Indian) negative fields that have
enough real examples of a given confirmed crop label, can a feature family discriminate between
them better than a majority-class baseline?

`within_india_crop_signal()` is importable and reused by pilot_normalization_experiments.py and
pilot_feature_ablation.py so the exact same probe design (model, CV scheme, seed, metrics) is
never duplicated across those follow-on scripts.

Every row in the underlying pilot_feature_matrix already represents ONE real field's whole-season
aggregate -- there is no per-observation row to leak across a split, so any row-level CV split
here already IS a field-level split; `_assert_field_level(...)` proves that by construction
(each field_id appears exactly once) rather than assuming it.

Zero new CDSE requests -- reads only the already-extracted local feature matrix.

Run: training/.venv/bin/python3 training/sunflower/pilot_within_source_crop_signal_check.py
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import (
    accuracy_score,
    average_precision_score,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.model_selection import StratifiedKFold, cross_val_predict

REPO_ROOT = Path(__file__).resolve().parents[2]
PILOT_DIR = REPO_ROOT / "training" / "data" / "pilot"
PROBE_SEED = 0
MIN_EXAMPLES_PER_CROP = 10

FULL_S2 = [f"{idx}_{stat}" for idx in ["ndvi", "ndre", "ndwi", "ndyi"] for stat in ["mean", "peak_value"]] + ["ndre_ndvi_peak_ratio"]
FULL_S2 += [f"{idx}_{stat}" for idx in ["ndvi", "ndre", "ndwi", "ndyi"] for stat in ["slope", "pre_peak_slope", "post_peak_slope", "growth_acceleration", "variability"]]


def _assert_field_level(df: pd.DataFrame) -> None:
    dupes = df["field_id"].duplicated().sum()
    assert dupes == 0, f"{dupes} field_id(s) appear more than once -- a row-level CV split here would NOT be field-level"


def within_india_crop_signal(df: pd.DataFrame, feature_cols: list[str], min_examples: int = MIN_EXAMPLES_PER_CROP, seed: int = PROBE_SEED) -> dict:
    """Runs the real within-India multi-crop classification probe on whatever feature_cols/df are
    passed in (so callers can swap in a normalized feature representation without duplicating
    this function). Returns None-safe metrics; never fabricates a class that has too few real
    examples to evaluate."""
    amed = df[df["country"] == "India"].copy()
    _assert_field_level(amed)

    counts = amed["crop_label"].value_counts()
    keep_labels = counts[counts >= min_examples].index.tolist()
    sub = amed[amed["crop_label"].isin(keep_labels)].copy()

    X = sub[feature_cols].fillna(sub[feature_cols].median(numeric_only=True))
    y = sub["crop_label"].astype("category").cat.codes
    n_classes = len(keep_labels)

    skf = StratifiedKFold(n_splits=3, shuffle=True, random_state=seed)
    probe = RandomForestClassifier(n_estimators=200, random_state=seed, class_weight="balanced")
    y_pred = cross_val_predict(probe, X, y, cv=skf)
    y_proba = cross_val_predict(probe, X, y, cv=skf, method="predict_proba")

    accuracy = float(accuracy_score(y, y_pred))
    majority_baseline = float(sub["crop_label"].value_counts(normalize=True).max())
    precision_macro = float(precision_score(y, y_pred, average="macro", zero_division=0))
    recall_macro = float(recall_score(y, y_pred, average="macro", zero_division=0))
    f1_macro = float(f1_score(y, y_pred, average="macro", zero_division=0))
    try:
        roc_auc_macro = float(roc_auc_score(y, y_proba, multi_class="ovr", average="macro"))
        pr_auc_macro = float(average_precision_score(pd.get_dummies(y).to_numpy(), y_proba, average="macro"))
    except ValueError:
        roc_auc_macro = None
        pr_auc_macro = None

    return {
        "n_rows": int(len(sub)),
        "crop_labels_used": keep_labels,
        "crop_label_counts": {k: int(v) for k, v in counts[counts >= min_examples].items()},
        "excluded_crop_labels_below_min_examples": {k: int(v) for k, v in counts[counts < min_examples].items()},
        "n_classes": n_classes,
        "chance_level_uniform": 1.0 / n_classes,
        "cv_accuracy": accuracy,
        "majority_class_baseline_accuracy": majority_baseline,
        "lift_over_baseline": accuracy - majority_baseline,
        "precision_macro": precision_macro,
        "recall_macro": recall_macro,
        "f1_macro": f1_macro,
        "roc_auc_macro_ovr": roc_auc_macro,
        "pr_auc_macro": pr_auc_macro,
        "confusion_matrix": confusion_matrix(y, y_pred).tolist(),
        "confusion_matrix_labels": [keep_labels[i] for i in sorted(y.unique())],
    }


def feature_importance_for(df: pd.DataFrame, feature_cols: list[str], min_examples: int = MIN_EXAMPLES_PER_CROP, seed: int = PROBE_SEED) -> list[tuple[str, float]]:
    amed = df[df["country"] == "India"].copy()
    counts = amed["crop_label"].value_counts()
    keep_labels = counts[counts >= min_examples].index.tolist()
    sub = amed[amed["crop_label"].isin(keep_labels)].copy()
    X = sub[feature_cols].fillna(sub[feature_cols].median(numeric_only=True))
    y = sub["crop_label"].astype("category").cat.codes
    clf = RandomForestClassifier(n_estimators=200, random_state=seed, class_weight="balanced")
    clf.fit(X, y)
    return sorted(zip(feature_cols, clf.feature_importances_), key=lambda t: -t[1])


def main() -> None:
    df = pd.read_json(PILOT_DIR / "pilot_feature_matrix.jsonl", orient="records", lines=True)
    result = within_india_crop_signal(df, FULL_S2)
    result["purpose"] = (
        "Within-India (single geography, no cross-country domain shift) real multi-crop "
        "classification using the FULL_S2 feature family -- tests whether these features carry "
        "ANY real crop-discriminative signal at all, independent of the cross-source leakage "
        "question."
    )
    result["interpretation"] = (
        "A real accuracy lift over the majority baseline here means these Sentinel-2 spectral/"
        "temporal features DO carry real, usable crop-discriminative information within a single "
        "geography -- they are not crop-blind. It does NOT by itself mean this signal transfers "
        "across the India-Europe domain gap, or that it specifically distinguishes Sunflower "
        "(no real Indian Sunflower label exists in this pilot to test that directly -- see "
        "methodology_investigation_report_v2.md)."
    )

    print(f"[pilot_within_source_crop_signal_check] {result['n_rows']} rows, {result['n_classes']} real crop labels: {result['crop_labels_used']}")
    print(f"  CV accuracy: {result['cv_accuracy']:.4f}  majority baseline: {result['majority_class_baseline_accuracy']:.4f}  lift: {result['lift_over_baseline']:+.4f}")
    print(f"  precision_macro={result['precision_macro']:.4f} recall_macro={result['recall_macro']:.4f} f1_macro={result['f1_macro']:.4f}")
    print(f"  roc_auc_macro_ovr={result['roc_auc_macro_ovr']} pr_auc_macro={result['pr_auc_macro']}")
    print(f"  confusion matrix (labels={result['confusion_matrix_labels']}): {result['confusion_matrix']}")

    out_path = PILOT_DIR / "pilot_within_source_crop_signal_check.json"
    out_path.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(f"[pilot_within_source_crop_signal_check] wrote {out_path.relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    main()
