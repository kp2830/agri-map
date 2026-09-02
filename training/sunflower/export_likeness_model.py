"""
Exports a portable JSON model artifact for the TypeScript production inference module
(server/src/services/agricultural/sunflower/likenessModel.ts). This project's stack is
Node/Express in production (CLAUDE.md) -- no Python runtime in the server -- so the trained
reference frame is exported as plain data (scaler params, Mahalanobis centroid+precision, kNN
reference vectors, LOFO calibration thresholds) and re-scored in TypeScript with the same math,
not by shelling out to Python.

Uses ONLY Mahalanobis distance + kNN similarity (drops IsolationForest for production -- a tree
ensemble doesn't port to a small portable JSON/TS reimplementation the way linear-algebra-based
methods do). This matches the "raw, indices_only" view identified in
pilot_ensemble_score.py/pilot_india_transfer_pu.py as the most cross-method-consistent
representation across two independent rounds of testing -- not an arbitrary choice.

Zero new CDSE requests -- reads only already-extracted/already-computed local pilot data.

Run: training/.venv/bin/python3 training/sunflower/export_likeness_model.py
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.covariance import LedoitWolf
from sklearn.neighbors import NearestNeighbors
from sklearn.preprocessing import StandardScaler

REPO_ROOT = Path(__file__).resolve().parents[2]
PILOT_DIR = REPO_ROOT / "training" / "data" / "pilot"
MODEL_OUT_DIR = REPO_ROOT / "server" / "src" / "services" / "agricultural" / "sunflower" / "model"
K_NEIGHBORS = 10
MODEL_VERSION = "sunflower-likeness-pu-v1"
FEATURE_SCHEMA_VERSION = "sentinel2-native-res-v1"
TRAINING_DATASET_VERSION = "eurocrops-slovakia-2021-pilot100"

# indices_only, the same 9-feature aggregate set used throughout (mean + peak_value per index,
# plus the cross-index ratio) -- deliberately excludes the temporal/slope family, which prior
# rounds showed carries most of the Slovakia-vs-India domain-shift leakage and, in
# pilot_india_transfer_pu.py, sharply reduced cross-method rank agreement when included.
FEATURES = [f"{idx}_{stat}" for idx in ["ndvi", "ndre", "ndwi", "ndyi"] for stat in ["mean", "peak_value"]] + ["ndre_ndvi_peak_ratio"]


def mahalanobis(X: np.ndarray, centroid: np.ndarray, precision: np.ndarray) -> np.ndarray:
    diff = X - centroid
    return np.sqrt(np.einsum("ij,jk,ik->i", diff, precision, diff))


def main() -> None:
    df = pd.read_json(PILOT_DIR / "pilot_feature_matrix.jsonl", orient="records", lines=True)
    positives = df[df["label"] == 1].reset_index(drop=True)
    assert len(positives) == 100

    medians = positives[FEATURES].median(numeric_only=True)
    X = positives[FEATURES].fillna(medians)
    scaler = StandardScaler().fit(X)
    X_scaled = scaler.transform(X)

    cov = LedoitWolf().fit(X_scaled)
    centroid = X_scaled.mean(axis=0)
    precision = cov.precision_
    maha_pos = mahalanobis(X_scaled, centroid, precision)

    nn = NearestNeighbors(n_neighbors=K_NEIGHBORS).fit(X_scaled)
    knn_dist_pos, _ = nn.kneighbors(X_scaled)
    knn_pos = knn_dist_pos.mean(axis=1)

    # LOFO calibration (re-run here, matching pilot_ensemble_score.py's methodology exactly, so
    # the exported thresholds are traceable to a real, reproducible computation rather than
    # copy-pasted from a printed log).
    lofo_scores = []
    idx_array = np.arange(len(positives))
    for i in idx_array:
        train_idx = np.delete(idx_array, i)
        X_train = X_scaled[train_idx]
        scaler_i = StandardScaler().fit(X.iloc[train_idx])
        X_train_s = scaler_i.transform(X.iloc[train_idx])
        cov_i = LedoitWolf().fit(X_train_s)
        centroid_i = X_train_s.mean(axis=0)
        precision_i = cov_i.precision_
        maha_train = mahalanobis(X_train_s, centroid_i, precision_i)
        nn_i = NearestNeighbors(n_neighbors=K_NEIGHBORS).fit(X_train_s)
        knn_dist_train, _ = nn_i.kneighbors(X_train_s)
        knn_train = knn_dist_train.mean(axis=1)

        held_out_s = scaler_i.transform(X.iloc[[i]])
        maha_held = mahalanobis(held_out_s, centroid_i, precision_i)[0]
        knn_dist_held, _ = nn_i.kneighbors(held_out_s)
        knn_held = knn_dist_held.mean(axis=1)[0]

        maha_rank = np.searchsorted(np.sort(maha_train), maha_held, side="right") / len(maha_train)
        maha_likeness = 1.0 - maha_rank
        knn_rank = np.searchsorted(np.sort(knn_train), knn_held, side="right") / len(knn_train)
        knn_likeness = 1.0 - knn_rank
        lofo_scores.append((maha_likeness + knn_likeness) / 2.0)

    lofo_scores = np.array(lofo_scores)
    thresholds = {
        "conservative": {"acceptance_rate": 0.90, "threshold": float(np.percentile(lofo_scores, 10))},
        "balanced": {"acceptance_rate": 0.75, "threshold": float(np.percentile(lofo_scores, 25))},
        "exploratory": {"acceptance_rate": 0.50, "threshold": float(np.percentile(lofo_scores, 50))},
    }

    artifact = {
        "modelVersion": MODEL_VERSION,
        "featureSchemaVersion": FEATURE_SCHEMA_VERSION,
        "trainingDatasetVersion": TRAINING_DATASET_VERSION,
        "exportedAtUtc": datetime.now(timezone.utc).isoformat(),
        "methodology": (
            "Positive-unlabeled: trained ONLY on 100 real EuroCrops Slovakia Sunflower fields "
            "(no negative class, no fabricated Indian labels). Scores are Mahalanobis + kNN "
            "similarity to this positive reference population, converted to a percentile "
            "'likeness' against the SAME positive population's own leave-one-field-out score "
            "distribution -- NOT a calibrated probability, and NOT validated against any real "
            "Indian ground truth (none exists). See "
            "training/data/pilot/methodology_investigation_report_v4.md for full derivation, "
            "limitations, and honesty requirements."
        ),
        "features": FEATURES,
        "featureMediansForImputation": {f: float(medians[f]) for f in FEATURES},
        "scaler": {"mean": scaler.mean_.tolist(), "scale": scaler.scale_.tolist()},
        "mahalanobis": {"centroid": centroid.tolist(), "precision": precision.tolist()},
        "knn": {"k": K_NEIGHBORS, "referenceVectorsScaled": X_scaled.tolist()},
        "referencePopulationRawStatistics": {
            "mahalanobisDistances": sorted(maha_pos.tolist()),
            "knnMeanDistances": sorted(knn_pos.tolist()),
        },
        "lofoCalibration": {
            "n_held_out_folds": 100,
            "score_distribution": {
                "mean": float(lofo_scores.mean()), "std": float(lofo_scores.std()),
                "min": float(lofo_scores.min()), "max": float(lofo_scores.max()),
                "p10": float(np.percentile(lofo_scores, 10)), "p25": float(np.percentile(lofo_scores, 25)),
                "median": float(np.median(lofo_scores)), "p75": float(np.percentile(lofo_scores, 75)),
            },
        },
        "thresholds": thresholds,
    }

    MODEL_OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = MODEL_OUT_DIR / "sunflowerLikenessModel.v1.json"
    out_path.write_text(json.dumps(artifact, indent=2), encoding="utf-8")
    print(f"[export_likeness_model] wrote {out_path.relative_to(REPO_ROOT)}")
    print(f"[export_likeness_model] {len(FEATURES)} features, 100 reference positives, thresholds: {json.dumps({k: v['threshold'] for k, v in thresholds.items()}, indent=2)}")


if __name__ == "__main__":
    main()
