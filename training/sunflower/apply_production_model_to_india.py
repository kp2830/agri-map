"""
Applies the EXACT exported production model artifact (the same one likenessModel.ts loads) to
all 250 real Indian AMED target fields -- this is "what the shipped TS module would actually say"
for every field in the pilot, not the broader 10-view research ensemble in
pilot_ensemble_score.py. Distinct deliverable: the research ensemble explores whether the signal
is robust across representations; this script reports the specific, single, production-committed
score.

Zero new CDSE requests -- reads only the already-exported model artifact and already-extracted
local pilot data.

Run: training/.venv/bin/python3 training/sunflower/apply_production_model_to_india.py
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

REPO_ROOT = Path(__file__).resolve().parents[2]
PILOT_DIR = REPO_ROOT / "training" / "data" / "pilot"
MODEL_PATH = REPO_ROOT / "server" / "src" / "services" / "agricultural" / "sunflower" / "model" / "sunflowerLikenessModel.v1.json"
SERVER_TRAINING_DATA = REPO_ROOT / "server" / "data" / "training" / "sunflower-belt-competing-crops.jsonl"


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

    src_by_id = {}
    if SERVER_TRAINING_DATA.exists():
        for line in SERVER_TRAINING_DATA.read_text(encoding="utf-8").splitlines():
            if line.strip():
                r = json.loads(line)
                src_by_id[r["fieldId"]] = r

    rows = []
    for _, row in india.iterrows():
        raw_base = [row.get(f, None) for f in features[:-1]]
        raw_base = [None if (v is None or (isinstance(v, float) and np.isnan(v))) else float(v) for v in raw_base]
        ndvi_peak, ndre_peak = raw_base[1], raw_base[3]
        ratio = ndre_peak / ndvi_peak if (ndre_peak is not None and ndvi_peak not in (None, 0)) else None
        full_raw = raw_base + [ratio]
        imputed = [v if v is not None else medians[f] for v, f in zip(full_raw, features)]
        scaled = (np.array(imputed) - scaler_mean) / scaler_scale

        diff = scaled - centroid
        maha_dist = float(np.sqrt(max(diff @ precision @ diff, 0)))
        knn_dist = float(np.sort(np.linalg.norm(ref_vectors - scaled, axis=1))[:k].mean())
        maha_likeness = likeness_from_distance(maha_dist, maha_ref_sorted)
        knn_likeness = likeness_from_distance(knn_dist, knn_ref_sorted)
        likeness = (maha_likeness + knn_likeness) / 2

        band = "below_exploratory"
        if likeness >= thresholds["conservative"]["threshold"]:
            band = "conservative"
        elif likeness >= thresholds["balanced"]["threshold"]:
            band = "balanced"
        elif likeness >= thresholds["exploratory"]["threshold"]:
            band = "exploratory"

        meta = src_by_id.get(row["field_id"], {})
        rows.append({
            "field_id": row["field_id"],
            "crop_label": row["crop_label"],
            "region": meta.get("region"),
            "district": meta.get("district"),
            "mahalanobisLikeness": round(maha_likeness, 6),
            "knnLikeness": round(knn_likeness, 6),
            "likeness": round(likeness, 6),
            "band": band,
        })

    result = pd.DataFrame(rows).sort_values("likeness", ascending=False).reset_index(drop=True)
    result["rank"] = result.index + 1

    print(f"[apply_production_model_to_india] production model likeness distribution (250 real India fields):")
    print(result["likeness"].describe())
    print(f"\nband counts: {result['band'].value_counts().to_dict()}")
    print(f"\ntop 20 by production model score:")
    print(result.head(20)[["rank", "field_id", "crop_label", "region", "likeness", "band"]].to_string(index=False))

    out_path = PILOT_DIR / "pilot_production_model_india_ranking.jsonl"
    result.to_json(out_path, orient="records", lines=True)
    print(f"\n[apply_production_model_to_india] wrote {out_path.relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    main()
