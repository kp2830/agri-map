"""
Positive-unlabeled India-transfer experiment -- the actual product hypothesis test.

CRITICAL FRAMING (per explicit instruction): the 250 real Indian AMED fields in the pilot are
NOT treated as labeled negatives. They have no Sunflower label (positive OR negative) in this
pipeline -- AMED simply has no Sunflower class. Labeling them "non-sunflower" would be a fabricated
label. They are the real TARGET/INFERENCE population: unlabeled Indian fields we want a
sunflower-likeness score for.

The only real labeled data available without a new CDSE extraction is the 100 real Slovak
EuroCrops Sunflower positives (already extracted). So this trains a POSITIVE-ONLY model (no
negative class at all) on those 100 fields, and scores the 250 Indian fields by similarity/
typicality relative to that positive distribution -- three independent methods, to check they
agree before trusting any of them:

  1. Mahalanobis distance to the positive-class centroid (LedoitWolf-shrunk covariance --
     appropriate given n=100 positives vs. up to 29 features, where an unshrunk empirical
     covariance would be unstable/singular).
  2. IsolationForest fit on positives only (score_samples: higher = more "normal" relative to
     the positive training distribution).
  3. Mean distance to the k=10 nearest positive neighbors in standardized feature space.

All three converted to comparable [0,1] "sunflower-likeness" scores via percentile rank AGAINST
THE POSITIVE CLASS'S OWN internal score distribution (never against India's distribution -- using
India's own stats to score India would leak target-population information into the reference
frame and stop this from being a real positive-only-trained detector). This is explicitly NOT a
calibrated probability (no Indian ground truth exists to calibrate against) -- documented as a
"likeness score," never called "accuracy" or "recall."

StandardScaler and the median imputer are BOTH fit on the 100 positives only, then applied
unchanged to the 250 Indian fields -- no target-domain statistic ever leaks into the reference
frame, matching "learn sunflower-specific features, not India-specific baselines."

Zero new CDSE requests -- reads only the already-extracted local pilot Sentinel-2 features.

Run: training/.venv/bin/python3 training/sunflower/pilot_india_transfer_pu.py
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import spearmanr
from sklearn.covariance import LedoitWolf
from sklearn.ensemble import IsolationForest
from sklearn.neighbors import NearestNeighbors
from sklearn.preprocessing import StandardScaler

REPO_ROOT = Path(__file__).resolve().parents[2]
PILOT_DIR = REPO_ROOT / "training" / "data" / "pilot"
SEED = 42
K_NEIGHBORS = 10

AGGREGATE = [f"{idx}_{stat}" for idx in ["ndvi", "ndre", "ndwi", "ndyi"] for stat in ["mean", "peak_value"]] + ["ndre_ndvi_peak_ratio"]
TEMPORAL = [f"{idx}_{stat}" for idx in ["ndvi", "ndre", "ndwi", "ndyi"] for stat in ["slope", "pre_peak_slope", "post_peak_slope", "growth_acceleration", "variability"]]
FEATURE_SETS = {
    "indices_only": AGGREGATE,
    "indices_plus_temporal": AGGREGATE + TEMPORAL,
}


def fit_reference_frame(positives: pd.DataFrame, feature_cols: list[str]) -> tuple[StandardScaler, pd.Series, np.ndarray]:
    """Imputer stats and scaler are fit ONLY on the 100 real positives -- this is the one part of
    the pipeline that must never see India's data, or the "likeness" score stops being
    sunflower-specific and starts being partly India-specific."""
    medians = positives[feature_cols].median(numeric_only=True)
    X = positives[feature_cols].fillna(medians)
    scaler = StandardScaler().fit(X)
    return scaler, medians, scaler.transform(X)


def score_population(df: pd.DataFrame, feature_cols: list[str], scaler: StandardScaler, medians: pd.Series) -> np.ndarray:
    X = df[feature_cols].fillna(medians)
    return scaler.transform(X)


def three_method_scores(X_pos_scaled: np.ndarray, X_target_scaled: np.ndarray) -> dict[str, dict]:
    # 1. Mahalanobis distance to the positive-class centroid, LedoitWolf-shrunk covariance.
    cov = LedoitWolf().fit(X_pos_scaled)
    centroid = X_pos_scaled.mean(axis=0)
    precision = cov.precision_

    def mahalanobis(X):
        diff = X - centroid
        return np.sqrt(np.einsum("ij,jk,ik->i", diff, precision, diff))

    maha_pos = mahalanobis(X_pos_scaled)
    maha_target = mahalanobis(X_target_scaled)

    # 2. IsolationForest fit on positives only.
    iso = IsolationForest(n_estimators=200, random_state=SEED, contamination="auto").fit(X_pos_scaled)
    iso_pos = iso.score_samples(X_pos_scaled)  # higher = more "normal" (more sunflower-like)
    iso_target = iso.score_samples(X_target_scaled)

    # 3. Mean distance to k nearest positive neighbors.
    nn = NearestNeighbors(n_neighbors=min(K_NEIGHBORS, len(X_pos_scaled))).fit(X_pos_scaled)
    knn_dist_pos, _ = nn.kneighbors(X_pos_scaled)
    knn_dist_target, _ = nn.kneighbors(X_target_scaled)
    knn_pos = knn_dist_pos.mean(axis=1)
    knn_target = knn_dist_target.mean(axis=1)

    def to_likeness(target_values: np.ndarray, pos_reference: np.ndarray, higher_pos_reference_is_more_typical: bool) -> np.ndarray:
        """Percentile rank of each target value AGAINST the positive class's own internal
        distribution of the same statistic -- e.g. "this India field's distance-to-centroid is
        smaller than X% of real Slovak sunflower fields' own distance-to-centroid." Never uses
        India's own distribution as the reference."""
        order = np.argsort(pos_reference)
        ranks = np.searchsorted(pos_reference[order], target_values, side="right") / len(pos_reference)
        return ranks if higher_pos_reference_is_more_typical else 1.0 - ranks

    return {
        "mahalanobis": {"likeness": to_likeness(maha_target, maha_pos, higher_pos_reference_is_more_typical=False), "raw_target": maha_target, "raw_positive_mean": float(maha_pos.mean()), "raw_positive_std": float(maha_pos.std())},
        "isolation_forest": {"likeness": to_likeness(iso_target, iso_pos, higher_pos_reference_is_more_typical=True), "raw_target": iso_target, "raw_positive_mean": float(iso_pos.mean()), "raw_positive_std": float(iso_pos.std())},
        "knn": {"likeness": to_likeness(knn_target, knn_pos, higher_pos_reference_is_more_typical=False), "raw_target": knn_target, "raw_positive_mean": float(knn_pos.mean()), "raw_positive_std": float(knn_pos.std())},
    }


def main() -> None:
    df = pd.read_json(PILOT_DIR / "pilot_feature_matrix.jsonl", orient="records", lines=True)
    positives = df[df["label"] == 1].copy()
    india = df[df["country"] == "India"].copy()
    assert len(positives) == 100 and len(india) == 250, f"unexpected pilot sizes: {len(positives)} positives, {len(india)} India rows"

    all_results = {}
    for set_name, feature_cols in FEATURE_SETS.items():
        print(f"\n[pilot_india_transfer_pu] === feature set: {set_name} ({len(feature_cols)} features) ===")
        scaler, medians, X_pos = fit_reference_frame(positives, feature_cols)
        X_india = score_population(india, feature_cols, scaler, medians)

        scores = three_method_scores(X_pos, X_india)
        india_out = india[["field_id", "crop_label", "region"]].copy() if "region" in india.columns else india[["field_id", "crop_label"]].copy()
        for method, s in scores.items():
            india_out[f"likeness_{method}"] = s["likeness"]
        india_out["likeness_combined_mean"] = india_out[[f"likeness_{m}" for m in scores]].mean(axis=1)

        rho_mi, p_mi = spearmanr(india_out["likeness_mahalanobis"], india_out["likeness_isolation_forest"])
        rho_mk, p_mk = spearmanr(india_out["likeness_mahalanobis"], india_out["likeness_knn"])
        rho_ik, p_ik = spearmanr(india_out["likeness_isolation_forest"], india_out["likeness_knn"])
        print(f"  cross-method rank agreement (Spearman rho): mahalanobis-vs-isoforest={rho_mi:.3f}(p={p_mi:.3g})  mahalanobis-vs-knn={rho_mk:.3f}(p={p_mk:.3g})  isoforest-vs-knn={rho_ik:.3f}(p={p_ik:.3g})")

        by_crop = india_out.groupby("crop_label")["likeness_combined_mean"].agg(["mean", "std", "count"]).sort_values("mean", ascending=False)
        print(f"  mean combined likeness score BY REAL AMED CROP LABEL (weak validation signal, NOT ground truth):")
        print(by_crop.to_string())

        top20 = india_out.sort_values("likeness_combined_mean", ascending=False).head(20)
        bottom20 = india_out.sort_values("likeness_combined_mean", ascending=True).head(20)
        print(f"\n  top 20 most sunflower-LIKE Indian fields (candidates, NOT confirmed):")
        print(top20[["field_id", "crop_label", "likeness_combined_mean"]].to_string(index=False))

        all_results[set_name] = {
            "n_positive_reference": len(positives),
            "n_india_target": len(india),
            "spearman_rho": {"mahalanobis_vs_isoforest": rho_mi, "mahalanobis_vs_knn": rho_mk, "isoforest_vs_knn": rho_ik},
            "mean_likeness_by_amed_crop_label": by_crop.to_dict(orient="index"),
            "top20_candidates": top20[["field_id", "crop_label", "likeness_mahalanobis", "likeness_isolation_forest", "likeness_knn", "likeness_combined_mean"]].to_dict(orient="records"),
            "bottom20": bottom20[["field_id", "crop_label", "likeness_combined_mean"]].to_dict(orient="records"),
            "full_ranking": india_out.sort_values("likeness_combined_mean", ascending=False).to_dict(orient="records"),
        }

    out_path = PILOT_DIR / "pilot_india_transfer_pu.json"
    out_path.write_text(json.dumps(all_results, indent=2, default=str), encoding="utf-8")
    print(f"\n[pilot_india_transfer_pu] wrote {out_path.relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    main()
