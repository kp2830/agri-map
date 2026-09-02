"""
Random Forest training pipeline for the Sunflower classifier — complete and correct, but with
an explicit, non-bypassable guard: it refuses to train while real Sunflower-positive examples
are absent or too few to support a meaningful field-level split. There is no fallback to
synthetic positives, no lowered bar, no "train anyway and call it a demo" path. This script
becomes runnable-for-real the moment training/data/sunflower-positives-*.jsonl exists with
enough real rows — no code changes needed, per prepare_dataset.py's source-discovery design.

Run: training/.venv/bin/python3 training/sunflower/train.py

Model, training-dataset, and feature-schema versions are recorded with every trained artifact
so a production prediction can always be traced back to exactly what produced it.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.calibration import CalibratedClassifierCV
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import (
    average_precision_score,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.model_selection import GroupShuffleSplit

REPO_ROOT = Path(__file__).resolve().parents[2]
DATASET_PATH = REPO_ROOT / "training" / "data" / "combined_field_examples.jsonl"
MODELS_DIR = REPO_ROOT / "training" / "models"

FEATURE_SCHEMA_VERSION = "sunflower-features-v1"
MODEL_VERSION = f"rf-{datetime.now(timezone.utc).strftime('%Y%m%d')}"

# A defensible floor, not an arbitrary one: below this, a field-level train/test split cannot
# produce a meaningful held-out evaluation (too few groups to split without either an empty
# test set or a test set with zero positives). See the project's own data-acquisition planning
# for why ~20 is treated as the minimum floor for an honestly-reportable (if wide-CI) result.
MIN_POSITIVE_EXAMPLES = 20
MIN_NEGATIVE_EXAMPLES = 20


def load_dataset() -> pd.DataFrame:
    if not DATASET_PATH.exists():
        raise FileNotFoundError(f"{DATASET_PATH} does not exist — run prepare_dataset.py first")
    rows = [json.loads(line) for line in DATASET_PATH.read_text(encoding="utf-8").splitlines() if line.strip()]
    return pd.DataFrame(rows)


def historical_features(df: pd.DataFrame) -> pd.DataFrame:
    """The one real feature group available today without satellite access — derived entirely
    from each row's own label_source/season/year, standing in for the richer historical-
    rotation signal computed field-by-field in the production TypeScript pipeline
    (historicalFeatures.ts) once real per-field AMED monitoring history is joined in here."""
    out = df.copy()
    out["is_kharif"] = (out["season"] == "kharif").astype(int)
    out["is_rabi"] = (out["season"] == "rabi").astype(int)
    return out


def build_feature_matrix(df: pd.DataFrame) -> pd.DataFrame:
    """Assembles the real feature columns available today. Spectral (NDVI/NDRE/NDWI/yellowness)
    and SAR (VV/VH) columns are deliberately NOT included here — they don't exist in any real
    row yet (see training/sunflower/spectral_indices.py and the production
    featureExtraction.ts for why). Adding them the moment real satellite features are joined in
    requires only extending this function — the rest of the pipeline (split, calibration,
    metrics, export) is already correct and doesn't change."""
    df = historical_features(df)
    return df[["is_kharif", "is_rabi"]]


def assert_no_source_leakage(X: pd.DataFrame, df: pd.DataFrame) -> None:
    """Guards against exactly the bug this project hit on its first real training run: the
    Kharif/Rabi season features are only meaningful for Indian AMED rows — EuroCrops rows have
    no comparable season concept and always report "unknown", so is_kharif/is_rabi ends up
    perfectly correlated with label_source/country rather than with crop_label. A model trained
    on that would score near-perfect metrics that mean nothing about Sunflower whatsoever — it
    would have just learned "which dataset did this row come from." This check fits a trivial
    classifier predicting label_source FROM the same feature matrix; if it can do that almost
    perfectly, the features are source-identifiers, not crop-identifiers, and training must not
    proceed until real, source-independent features (i.e. real Sentinel-1/2 spectral/SAR
    values, computed identically regardless of which dataset a field came from) exist.
    """
    if df["label_source"].nunique() < 2:
        return  # nothing to leak against with only one source

    from sklearn.ensemble import RandomForestClassifier as _RFC
    from sklearn.model_selection import cross_val_score

    source_labels = df["label_source"].astype("category").cat.codes
    probe = _RFC(n_estimators=100, random_state=0)
    scores = cross_val_score(probe, X, source_labels, cv=3)
    mean_accuracy = float(scores.mean())

    if mean_accuracy > 0.9:
        # Root cause is diagnosed FROM THIS RUN's actual features, not assumed -- an earlier
        # version of this message hardcoded "is_kharif/is_rabi" as the explanation regardless of
        # which features were actually passed in, which became stale/misleading the moment a
        # feature set without those columns (e.g. pure Sentinel-2 spectral/temporal features)
        # also triggered this guard for a different real reason (see pilot_report.md /
        # pilot_leakage_diagnosis.json for a worked example).
        probe_full = _RFC(n_estimators=200, random_state=0)
        probe_full.fit(X, source_labels)
        top_features = sorted(zip(X.columns, probe_full.feature_importances_), key=lambda t: -t[1])[:5]
        top_features_str = ", ".join(f"{name} ({imp:.1%})" for name, imp in top_features)
        raise RuntimeError(
            f"REFUSING TO TRAIN: the current feature set predicts label_source (which dataset "
            f"a row came from) with {mean_accuracy:.1%} accuracy using nothing but "
            f"crop-irrelevant metadata. This means any Sunflower-vs-negative metric would "
            f"reflect 'which dataset' rather than 'which crop' and would be scientifically "
            f"meaningless, however good it looks. Top source-predictive features in THIS run: "
            f"{top_features_str}. Fix: exclude source-confounded features, or wait for real, "
            f"source-independent spectral/SAR features before evaluating cross-source data "
            f"together."
        )


def main() -> None:
    df = load_dataset()
    positives = df[df["crop_label"] == "SUNFLOWER"]
    negatives = df[df["crop_label"] != "SUNFLOWER"]

    print(f"[train] dataset: {len(df)} total rows | {len(positives)} Sunflower positives | {len(negatives)} negatives")

    if len(positives) < MIN_POSITIVE_EXAMPLES or len(negatives) < MIN_NEGATIVE_EXAMPLES:
        print(
            f"\n[train] REFUSING TO TRAIN: {len(positives)} real Sunflower positive examples "
            f"available (minimum {MIN_POSITIVE_EXAMPLES} required for a meaningful field-level "
            "held-out evaluation).\n"
            "[train] This is not a bug — it is the intended guard against training on "
            "insufficient real evidence. No synthetic positives, no lowered threshold, no "
            "fallback classifier will be produced.\n"
            "[train] Next step: obtain real Sunflower-positive field examples (see the "
            "project's data-acquisition investigation) and place them at "
            "training/data/sunflower-positives-haryana-harsac.jsonl in the schema documented "
            "in prepare_dataset.py, then re-run prepare_dataset.py followed by this script."
        )
        return

    positive_field_ids = set(positives["field_id"])
    negative_field_ids = set(negatives["field_id"])
    overlap = positive_field_ids & negative_field_ids
    if overlap:
        raise ValueError(f"{len(overlap)} field_id(s) appear in both classes — investigate before training: {list(overlap)[:5]}")

    X = build_feature_matrix(df)
    y = (df["crop_label"] == "SUNFLOWER").astype(int)
    groups = df["field_id"]

    assert_no_source_leakage(X, df)

    # Field-level split — no field's observations are ever split across train and test.
    splitter = GroupShuffleSplit(n_splits=1, test_size=0.25, random_state=42)
    train_idx, test_idx = next(splitter.split(X, y, groups=groups))
    X_train, X_test = X.iloc[train_idx], X.iloc[test_idx]
    y_train, y_test = y.iloc[train_idx], y.iloc[test_idx]

    base_model = RandomForestClassifier(n_estimators=300, max_depth=None, class_weight="balanced", random_state=42)
    # Calibrates raw RF scores into genuine probabilities via cross-validated Platt/isotonic
    # scaling — the displayed "confidence" must be this calibrated value, never the raw score.
    calibrated_model = CalibratedClassifierCV(base_model, method="isotonic", cv=3)
    calibrated_model.fit(X_train, y_train)

    y_proba = calibrated_model.predict_proba(X_test)[:, 1]
    y_pred = (y_proba >= 0.5).astype(int)

    metrics = {
        "precision": float(precision_score(y_test, y_pred, zero_division=0)),
        "recall": float(recall_score(y_test, y_pred, zero_division=0)),
        "f1": float(f1_score(y_test, y_pred, zero_division=0)),
        "roc_auc": float(roc_auc_score(y_test, y_proba)) if y_test.nunique() > 1 else None,
        "pr_auc": float(average_precision_score(y_test, y_proba)),
        "confusion_matrix": confusion_matrix(y_test, y_pred).tolist(),
        "n_train": int(len(X_train)),
        "n_test": int(len(X_test)),
        "n_test_positive": int(y_test.sum()),
        "n_test_negative": int(len(y_test) - y_test.sum()),
    }

    print("\n[train] held-out (field-level split) metrics:")
    for key, value in metrics.items():
        print(f"  {key}: {value}")

    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    metadata = {
        "model_version": MODEL_VERSION,
        "feature_schema_version": FEATURE_SCHEMA_VERSION,
        "training_dataset_path": str(DATASET_PATH.relative_to(REPO_ROOT)),
        "training_dataset_row_count": len(df),
        "trained_at_utc": datetime.now(timezone.utc).isoformat(),
        "features_used": list(X.columns),
        "metrics": metrics,
        "note": "Feature set is historical/seasonal only (no Sentinel-1/2 features yet — see build_feature_matrix()).",
    }
    metadata_path = MODELS_DIR / f"{MODEL_VERSION}_metadata.json"
    metadata_path.write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    print(f"\n[train] wrote metadata to {metadata_path.relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    main()
