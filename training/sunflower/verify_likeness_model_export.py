"""
Verification fixture for the TypeScript port (server/.../sunflower/likenessModel.ts) of the
exported model artifact. Recomputes Mahalanobis + kNN likeness for a handful of real India
target fields using ONLY the exported JSON artifact (server/.../model/sunflowerLikenessModel.v1.json)
-- not the original training data structures -- so this is a genuine "does the artifact alone
reproduce the right numbers" check, matching exactly what the TS side does.

Writes a fixture JSON (field_id, real raw spectral values, expected likeness/band) that
server/scripts/verifySunflowerLikeness.ts reads and compares its own TS computation against.

Run: training/.venv/bin/python3 training/sunflower/verify_likeness_model_export.py
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

REPO_ROOT = Path(__file__).resolve().parents[2]
PILOT_DIR = REPO_ROOT / "training" / "data" / "pilot"
MODEL_PATH = REPO_ROOT / "server" / "src" / "services" / "agricultural" / "sunflower" / "model" / "sunflowerLikenessModel.v1.json"
FIXTURE_PATH = REPO_ROOT / "server" / "scripts" / "sunflowerLikenessFixture.json"

N_FIELDS_TO_VERIFY = 8


def likeness_from_distance(value: float, sorted_reference: np.ndarray) -> float:
    rank = np.searchsorted(sorted_reference, value, side="right") / len(sorted_reference)
    return 1.0 - rank


def main() -> None:
    model = json.loads(MODEL_PATH.read_text(encoding="utf-8"))
    df = pd.read_json(PILOT_DIR / "pilot_feature_matrix.jsonl", orient="records", lines=True)
    india = df[df["country"] == "India"].reset_index(drop=True)

    features = model["features"]
    medians = model["featureMediansForImputation"]
    scaler_mean = np.array(model["scaler"]["mean"])
    scaler_scale = np.array(model["scaler"]["scale"])
    centroid = np.array(model["mahalanobis"]["centroid"])
    precision = np.array(model["mahalanobis"]["precision"])
    ref_vectors = np.array(model["knn"]["referenceVectorsScaled"])
    k = model["knn"]["k"]
    maha_ref_sorted = np.array(sorted(model["referencePopulationRawStatistics"]["mahalanobisDistances"]))
    knn_ref_sorted = np.array(sorted(model["referencePopulationRawStatistics"]["knnMeanDistances"]))
    thresholds = model["thresholds"]

    rng = np.random.RandomState(7)
    sample_idx = rng.choice(len(india), size=N_FIELDS_TO_VERIFY, replace=False)

    fixtures = []
    for idx in sample_idx:
        row = india.iloc[idx]
        raw = [row.get(f, None) for f in features[:-1]]  # last feature (ndre_ndvi_peak_ratio) computed below
        raw = [None if (v is None or (isinstance(v, float) and np.isnan(v))) else float(v) for v in raw]
        ndvi_peak, ndre_peak = raw[1], raw[3]
        ratio = ndre_peak / ndvi_peak if (ndre_peak is not None and ndvi_peak not in (None, 0)) else None
        full_raw = raw + [ratio]

        imputed = [v if v is not None else medians[f] for v, f in zip(full_raw, features)]
        scaled = (np.array(imputed) - scaler_mean) / scaler_scale

        diff = scaled - centroid
        maha_dist = float(np.sqrt(max(diff @ precision @ diff, 0)))
        knn_dists = np.sort(np.linalg.norm(ref_vectors - scaled, axis=1))[:k]
        knn_dist = float(knn_dists.mean())

        maha_likeness = float(likeness_from_distance(maha_dist, maha_ref_sorted))
        knn_likeness = float(likeness_from_distance(knn_dist, knn_ref_sorted))
        likeness = (maha_likeness + knn_likeness) / 2

        band = "below_exploratory"
        if likeness >= thresholds["conservative"]["threshold"]:
            band = "conservative"
        elif likeness >= thresholds["balanced"]["threshold"]:
            band = "balanced"
        elif likeness >= thresholds["exploratory"]["threshold"]:
            band = "exploratory"

        fixtures.append({
            "field_id": row["field_id"],
            "crop_label": row["crop_label"],
            "raw_spectral": {
                "ndviMean": raw[0], "ndviPeakValue": raw[1], "ndreMean": raw[2], "ndrePeakValue": raw[3],
                "ndwiMean": raw[4], "ndwiPeakValue": raw[5], "yellowIndexMean": raw[6], "yellowIndexPeakValue": raw[7],
                "observationCount": int(row.get("ndvi_n_obs", 10) or 10),
            },
            "expected": {
                "mahalanobisLikeness": round(maha_likeness, 10),
                "knnLikeness": round(knn_likeness, 10),
                "likeness": round(likeness, 10),
                "band": band,
            },
        })
        print(f"{row['field_id']} ({row['crop_label']}): likeness={likeness:.6f} band={band}")

    FIXTURE_PATH.write_text(json.dumps(fixtures, indent=2), encoding="utf-8")
    print(f"\n[verify_likeness_model_export] wrote {FIXTURE_PATH.relative_to(REPO_ROOT)} ({len(fixtures)} fields)")


if __name__ == "__main__":
    main()
