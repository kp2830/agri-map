"""
Robust ensemble sunflower-likeness score for the 250 real Indian AMED target fields, per the
product-goal reframe: the 100 real Slovak EuroCrops positives are the confirmed source-domain
reference population; the 250 Indian fields are UNLABELED TARGET-domain data, never labeled
"negative." Zero new CDSE requests -- reuses every already-extracted/already-computed local
artifact from prior rounds:

  - pilot_feature_matrix.jsonl                (raw / calendar-time representation)
  - pilot_feature_matrix_relative.jsonl        (field-relative season-fraction representation)
  - pilot_feature_matrix_zscore.jsonl          (per-field z-scored representation)
  - pilot_feature_matrix_median_subtract.jsonl (per-field median-subtracted representation)
  - pilot_feature_matrix_rank.jsonl            (per-field rank/quantile representation)

For each of these 5 representations x 2 feature sets (indices_only, indices_plus_temporal) = 10
"views", scores every Indian field with the same 3-method positive-only pipeline from
pilot_india_transfer_pu.py (Mahalanobis / IsolationForest / kNN, reused not duplicated). A
field's final ensemble score is the mean across all 10 views; its dispersion (std across views)
is the honest uncertainty/agreement signal the product spec asked for -- a field that scores high
under only one view is flagged as fragile, not presented as a strong candidate.

ALSO runs source-domain leave-one-field-out (LOFO) calibration: for each of the 100 real Slovak
positives, refits the reference frame on the other 99 and scores the held-out field with the
exact same pipeline. This produces a real distribution of "how would a genuine held-out sunflower
field score under this pipeline" -- the only honest basis available for choosing a production
threshold, since no Indian ground truth exists to calibrate against directly.

Run: training/.venv/bin/python3 training/sunflower/pilot_ensemble_score.py
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

from pilot_india_transfer_pu import fit_reference_frame, score_population, three_method_scores

REPO_ROOT = Path(__file__).resolve().parents[2]
PILOT_DIR = REPO_ROOT / "training" / "data" / "pilot"
SERVER_TRAINING_DATA = REPO_ROOT / "server" / "data" / "training" / "sunflower-belt-competing-crops.jsonl"
SEED = 42

AGGREGATE = [f"{idx}_{stat}" for idx in ["ndvi", "ndre", "ndwi", "ndyi"] for stat in ["mean", "peak_value"]] + ["ndre_ndvi_peak_ratio"]
TEMPORAL = [f"{idx}_{stat}" for idx in ["ndvi", "ndre", "ndwi", "ndyi"] for stat in ["slope", "pre_peak_slope", "post_peak_slope", "growth_acceleration", "variability"]]
FEATURE_SETS = {"indices_only": AGGREGATE, "indices_plus_temporal": AGGREGATE + TEMPORAL}

REPRESENTATIONS = {
    "raw": PILOT_DIR / "pilot_feature_matrix.jsonl",
    "field_relative": PILOT_DIR / "pilot_feature_matrix_relative.jsonl",
    "zscore": PILOT_DIR / "pilot_feature_matrix_zscore.jsonl",
    "median_subtract": PILOT_DIR / "pilot_feature_matrix_median_subtract.jsonl",
    "rank": PILOT_DIR / "pilot_feature_matrix_rank.jsonl",
}


def combo_score(positives: pd.DataFrame, target: pd.DataFrame, feature_cols: list[str]) -> np.ndarray:
    """One (representation, feature_set) 'view': fits the reference frame on `positives` only,
    scores `target`, and returns the mean of the 3 method-likeness scores -- i.e. exactly the
    combo-level score this module ensembles across views."""
    scaler, medians, X_pos = fit_reference_frame(positives, feature_cols)
    X_target = score_population(target, feature_cols, scaler, medians)
    scores = three_method_scores(X_pos, X_target)
    stacked = np.vstack([scores[m]["likeness"] for m in scores])
    return stacked.mean(axis=0)


def build_all_views(positives: pd.DataFrame, target_by_rep: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Returns a DataFrame, one row per target field, one column per (representation,
    feature_set) view score -- the raw material for the ensemble mean/dispersion."""
    view_scores = {}
    for rep_name, target_df in target_by_rep.items():
        pos_rep = positives  # positives are matched by row order to target's own df's positives subset below
        for set_name, cols in FEATURE_SETS.items():
            key = f"{rep_name}__{set_name}"
            view_scores[key] = combo_score(pos_rep, target_df, cols)
    return pd.DataFrame(view_scores)


def leave_one_field_out_source_scores(positives: pd.DataFrame, feature_cols: list[str]) -> np.ndarray:
    """For each of the 100 real Slovak positives, refit on the other 99 and score the held-out
    field with the exact same 3-method pipeline used for India -- the real, honest basis for a
    production threshold (no Indian ground truth exists to calibrate against directly)."""
    n = len(positives)
    out = np.zeros(n)
    idx_array = positives.index.to_numpy()
    for i in range(n):
        held_out_idx = idx_array[i]
        train_idx = np.delete(idx_array, i)
        train_df = positives.loc[train_idx]
        held_out_df = positives.loc[[held_out_idx]]
        out[i] = combo_score(train_df, held_out_df, feature_cols)[0]
    return out


def main() -> None:
    df_raw = pd.read_json(REPRESENTATIONS["raw"], orient="records", lines=True)
    positives = df_raw[df_raw["label"] == 1].reset_index(drop=True)
    india_raw = df_raw[df_raw["country"] == "India"].reset_index(drop=True)
    assert len(positives) == 100 and len(india_raw) == 250

    target_by_rep = {}
    positives_by_rep = {}
    for rep_name, path in REPRESENTATIONS.items():
        d = pd.read_json(path, orient="records", lines=True)
        positives_by_rep[rep_name] = d[d["label"] == 1].reset_index(drop=True)
        target_by_rep[rep_name] = d[d["country"] == "India"].reset_index(drop=True)
        assert len(target_by_rep[rep_name]) == 250, f"{rep_name}: expected 250 India rows, got {len(target_by_rep[rep_name])}"

    print("[pilot_ensemble_score] building 10 views (5 representations x 2 feature sets) for 250 India target fields...")
    view_scores = {}
    for rep_name in REPRESENTATIONS:
        for set_name, cols in FEATURE_SETS.items():
            key = f"{rep_name}__{set_name}"
            view_scores[key] = combo_score(positives_by_rep[rep_name], target_by_rep[rep_name], cols)
            print(f"  computed view: {key}")
    views_df = pd.DataFrame(view_scores)

    ensemble_mean = views_df.mean(axis=1)
    ensemble_std = views_df.std(axis=1)
    ensemble_min = views_df.min(axis=1)
    ensemble_max = views_df.max(axis=1)

    result = india_raw[["field_id", "crop_label"]].copy()
    for col in views_df.columns:
        result[f"view__{col}"] = views_df[col]
    result["ensemble_mean"] = ensemble_mean
    result["ensemble_std"] = ensemble_std
    result["ensemble_min"] = ensemble_min
    result["ensemble_max"] = ensemble_max
    # A field's real "top-K stability": in how many of the 10 views does it place in that view's own top 20 (of 250)?
    top20_flags = views_df.rank(ascending=False, axis=0) <= 20
    result["n_views_in_top20_of_10"] = top20_flags.sum(axis=1)

    # Join real region/district from the original AMED source collection (server-side, already
    # real/local) for a geographic-clustering check, if the field_id is present there.
    if SERVER_TRAINING_DATA.exists():
        src_rows = [json.loads(l) for l in SERVER_TRAINING_DATA.read_text(encoding="utf-8").splitlines() if l.strip()]
        src_by_id = {r["fieldId"]: r for r in src_rows}
        result["region"] = result["field_id"].map(lambda fid: src_by_id.get(fid, {}).get("region"))
        result["district"] = result["field_id"].map(lambda fid: src_by_id.get(fid, {}).get("district"))
    else:
        result["region"] = None
        result["district"] = None

    result = result.sort_values("ensemble_mean", ascending=False).reset_index(drop=True)
    result["rank"] = result.index + 1

    print(f"\n[pilot_ensemble_score] === ensemble score distribution (250 India fields, 10-view mean) ===")
    print(result["ensemble_mean"].describe())

    print(f"\n[pilot_ensemble_score] top 20 India candidates by ensemble score:")
    print(result.head(20)[["rank", "field_id", "crop_label", "region", "ensemble_mean", "ensemble_std", "n_views_in_top20_of_10"]].to_string(index=False))

    print(f"\n[pilot_ensemble_score] mean ensemble score by real AMED crop label (weak diagnostic, NOT ground truth):")
    print(result.groupby("crop_label")["ensemble_mean"].agg(["mean", "std", "count"]).sort_values("mean", ascending=False).to_string())

    print(f"\n[pilot_ensemble_score] geographic distribution of top 20 candidates (real AMED region field):")
    print(result.head(20)["region"].value_counts().to_string())
    print(f"[pilot_ensemble_score] geographic distribution of full 250-field population (for base-rate comparison):")
    print(result["region"].value_counts().to_string())

    print("\n[pilot_ensemble_score] === source-domain leave-one-field-out calibration ===")
    # Using the single most cross-method-consistent view identified last round (raw, indices_only)
    # as the primary calibration reference -- documented, not silently chosen.
    lofo_scores = leave_one_field_out_source_scores(positives_by_rep["raw"], FEATURE_SETS["indices_only"])
    print(f"  LOFO score distribution across the 100 real held-out Slovak positives (raw, indices_only view):")
    lofo_series = pd.Series(lofo_scores)
    print(lofo_series.describe())

    thresholds = {}
    for label, acceptance_rate in [("conservative", 0.90), ("balanced", 0.75), ("exploratory", 0.50)]:
        # threshold = the score below which (1 - acceptance_rate) of real held-out positives fall
        # i.e. accepting >= this threshold would have correctly flagged `acceptance_rate` of them.
        threshold = float(np.percentile(lofo_scores, (1 - acceptance_rate) * 100))
        thresholds[label] = {"acceptance_rate_on_held_out_real_positives": acceptance_rate, "threshold_raw_indices_only_view": threshold}
        print(f"  {label:14s} threshold={threshold:.4f}  (would have accepted {acceptance_rate:.0%} of real held-out Slovak sunflower fields under this exact single-view pipeline)")

    # Apply these thresholds to the MATCHING single view (raw, indices_only) of the India target
    # population, not the 10-view ensemble mean -- comparing a threshold calibrated on one view
    # against a different (ensembled) score would not be a valid comparison.
    raw_indices_only_india = views_df["raw__indices_only"]
    for label, t in thresholds.items():
        n_above = int((raw_indices_only_india >= t["threshold_raw_indices_only_view"]).sum())
        thresholds[label]["n_india_fields_above_threshold_raw_indices_only_view"] = n_above
        thresholds[label]["fraction_of_250"] = round(n_above / 250, 4)
        print(f"  {label:14s}: {n_above}/250 real India fields clear this threshold on the matching (raw, indices_only) view ({n_above/250:.1%})")

    out = {
        "n_positive_reference": 100,
        "n_india_target": 250,
        "views": list(views_df.columns),
        "lofo_score_distribution_raw_indices_only": {
            "mean": float(lofo_series.mean()), "std": float(lofo_series.std()), "min": float(lofo_series.min()),
            "p10": float(np.percentile(lofo_scores, 10)), "p25": float(np.percentile(lofo_scores, 25)),
            "median": float(lofo_series.median()), "p75": float(np.percentile(lofo_scores, 75)), "max": float(lofo_series.max()),
        },
        "thresholds": thresholds,
        "full_ranking": result.to_dict(orient="records"),
    }
    out_path = PILOT_DIR / "pilot_ensemble_score.json"
    out_path.write_text(json.dumps(out, indent=2, default=str), encoding="utf-8")
    print(f"\n[pilot_ensemble_score] wrote {out_path.relative_to(REPO_ROOT)}")

    result.to_json(PILOT_DIR / "pilot_india_ranking.jsonl", orient="records", lines=True)
    print(f"[pilot_ensemble_score] wrote {(PILOT_DIR / 'pilot_india_ranking.jsonl').relative_to(REPO_ROOT)} (machine-readable full ranking, 1 row per India field)")


if __name__ == "__main__":
    main()
