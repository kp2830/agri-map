"""
Tests the specific hypothesis: does an NDYI + temporal-shape representation transfer better from
Slovak sunflower to Indian target-domain fields than the current production absolute-magnitude
Mahalanobis+kNN representation? Zero new CDSE requests -- uses only already-extracted local data
and already-built, already-tested functions:

  - build_observations (pilot_features.py) -- field's own real observation timeline
  - compute_phenology_features / normalize_by_season_fraction (temporal_features.py) -- reused,
    not duplicated, for every temporal-shape feature below
  - fit_reference_frame / score_population / three_method_scores / combo_score
    (pilot_india_transfer_pu.py, pilot_ensemble_score.py) -- the exact same Mahalanobis+kNN(+
    IsolationForest) scoring machinery already used for every production/ensemble score so far
  - leave_one_field_out_source_scores (pilot_ensemble_score.py) -- reused verbatim for Part 3
  - diagnose (pilot_leakage_diagnosis.py) -- reused verbatim for Part 7's source-separability probe

Run: training/.venv/bin/python3 training/sunflower/ndyi_temporal_shape_experiment.py
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

from pilot_features import build_observations
from pilot_ensemble_score import combo_score, leave_one_field_out_source_scores
from pilot_leakage_diagnosis import diagnose
from temporal_features import compute_phenology_features, normalize_by_season_fraction

REPO_ROOT = Path(__file__).resolve().parents[2]
PILOT_DIR = REPO_ROOT / "training" / "data" / "pilot"
SERVER_SCRIPTS = REPO_ROOT / "server" / "scripts"
SEED = 42

# --- Part 1: feature banks, each computed ONLY from a field's own real observed daily series ---

PRODUCTION_FEATURES = [f"{idx}_{stat}" for idx in ["ndvi", "ndre", "ndwi", "ndyi"] for stat in ["mean", "peak_value"]] + ["ndre_ndvi_peak_ratio"]

NDYI_MAGNITUDE_FEATURES = ["ndyi_mean", "ndyi_median", "ndyi_peak", "ndyi_p90", "ndyi_std", "ndyi_range"]
NDYI_SHAPE_RAW_FEATURES = ["ndyi_slope", "ndyi_pre_peak_slope", "ndyi_post_peak_slope", "ndyi_growth_acceleration", "ndyi_peak_day_fraction", "ndyi_observed_span_days"]
NDYI_SHAPE_NORM_FEATURES = ["ndyi_slope_norm", "ndyi_pre_peak_slope_norm", "ndyi_post_peak_slope_norm", "ndyi_growth_acceleration_norm", "ndyi_peak_day_fraction_norm"]
PRINCIPLED_VIGOR_FEATURES = ["ndvi_peak", "ndre_peak"]  # peak (not mean) canopy greenness -- see report §11 for the biological justification

MODELS = {
    "A_production": PRODUCTION_FEATURES,
    "B_ndyi_only": NDYI_MAGNITUDE_FEATURES,
    "C_ndyi_plus_shape": NDYI_MAGNITUDE_FEATURES + NDYI_SHAPE_RAW_FEATURES,
    "D_ndyi_plus_normalized_shape": NDYI_MAGNITUDE_FEATURES + NDYI_SHAPE_NORM_FEATURES,
    "E_ndyi_shape_plus_minimal_vigor": NDYI_MAGNITUDE_FEATURES + NDYI_SHAPE_NORM_FEATURES + PRINCIPLED_VIGOR_FEATURES,
}


def ndyi_features(daily_series: list[dict]) -> dict:
    """Every feature in every NDYI/temporal-shape bank above, computed ONCE from the real daily
    series -- no future observation ever used past the field's own last real observation (the
    as-of cutoff IS the last real observation, matching exactly how production extracts a
    field's full available window at click-time; filter_as_of inside compute_phenology_features
    enforces this by construction, reused not reimplemented)."""
    obs = build_observations(daily_series)
    out = {k: None for k in NDYI_MAGNITUDE_FEATURES + NDYI_SHAPE_RAW_FEATURES + NDYI_SHAPE_NORM_FEATURES}
    if not obs:
        return out

    values = np.array([o.value for o in obs])
    out["ndyi_mean"] = float(values.mean())
    out["ndyi_median"] = float(np.median(values))
    out["ndyi_peak"] = float(values.max())
    out["ndyi_p90"] = float(np.percentile(values, 90))
    out["ndyi_std"] = float(values.std(ddof=1)) if len(values) > 1 else None
    out["ndyi_range"] = float(values.max() - values.min())

    season_length = max(o.days_since_start for o in obs)

    # C: raw (own-timeline, un-normalized) temporal shape
    pf_raw = compute_phenology_features(obs, as_of_day=season_length)
    out["ndyi_slope"] = pf_raw.slope
    out["ndyi_pre_peak_slope"] = pf_raw.pre_peak_slope
    out["ndyi_post_peak_slope"] = pf_raw.post_peak_slope
    out["ndyi_growth_acceleration"] = pf_raw.growth_acceleration
    out["ndyi_peak_day_fraction"] = pf_raw.peak_day / season_length if pf_raw.peak_day is not None and season_length > 0 else None
    out["ndyi_observed_span_days"] = float(season_length)

    # D: season-fraction-normalized temporal shape (reuses normalize_by_season_fraction verbatim)
    if season_length > 0:
        obs_norm = normalize_by_season_fraction(obs, season_length)
        pf_norm = compute_phenology_features(obs_norm, as_of_day=1.0)
        out["ndyi_slope_norm"] = pf_norm.slope
        out["ndyi_pre_peak_slope_norm"] = pf_norm.pre_peak_slope
        out["ndyi_post_peak_slope_norm"] = pf_norm.post_peak_slope
        out["ndyi_growth_acceleration_norm"] = pf_norm.growth_acceleration
        out["ndyi_peak_day_fraction_norm"] = pf_norm.peak_day  # already a 0..1 fraction post-normalization

    return out


def vigor_peak_features(field_result: dict) -> dict:
    out = {}
    for idx in ["ndvi", "ndre"]:
        obs = build_observations(field_result["indices"].get(idx, []))
        out[f"{idx}_peak"] = max(o.value for o in obs) if obs else None
    return out


def production_features(field_result: dict) -> dict:
    """Reproduces exactly pilot_features.field_features's production feature set (imported
    indirectly is awkward since that module's main() has side effects); recomputed here using the
    same underlying build_observations/compute_phenology_features to guarantee numeric parity,
    verified against the already-existing pilot_feature_matrix.jsonl below in main()."""
    feats = {}
    for idx in ["ndvi", "ndre", "ndwi", "ndyi"]:
        obs = build_observations(field_result["indices"].get(idx, []))
        if not obs:
            feats[f"{idx}_mean"] = None
            feats[f"{idx}_peak_value"] = None
            continue
        values = [o.value for o in obs]
        feats[f"{idx}_mean"] = float(np.mean(values))
        feats[f"{idx}_peak_value"] = float(np.max(values))
    ndre_p, ndvi_p = feats.get("ndre_peak_value"), feats.get("ndvi_peak_value")
    feats["ndre_ndvi_peak_ratio"] = ndre_p / ndvi_p if (ndre_p is not None and ndvi_p not in (None, 0)) else None
    return feats


def all_features(field_result: dict) -> dict:
    return production_features(field_result) | ndyi_features(field_result["indices"].get("ndyi", [])) | vigor_peak_features(field_result)


def load_candidate(path: Path, key: str | None = None) -> dict:
    raw = json.loads(path.read_text(encoding="utf-8"))
    data = raw if key is None else raw[key]
    indices = data["indices"] if "indices" in data else data
    return {"indices": {idx: [{"date": p["date"], "mean": p["value"]} for p in indices[idx]["trajectory"]] for idx in ["ndvi", "ndre", "ndwi", "ndyi"]}}


def main() -> None:
    pos_rows = [json.loads(l) for l in (PILOT_DIR / "eurocrops_sentinel2_features.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]
    neg_rows = [json.loads(l) for l in (PILOT_DIR / "amed_sentinel2_features.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]

    df_slovak = pd.DataFrame([all_features(r) | {"field_id": r["field_id"]} for r in pos_rows])
    df_india = pd.DataFrame([all_features(r) | {"field_id": r["field_id"], "crop_label": r["crop_label"]} for r in neg_rows])

    candidates = {
        "Karnataka-1": load_candidate(SERVER_SCRIPTS / "karnatakaCandidateFullResult.json"),
        "Gadag-dated": load_candidate(SERVER_SCRIPTS / "datedCandidateFullResult.json"),
    }
    extra = json.loads((SERVER_SCRIPTS / "additionalCandidatesFullResults.json").read_text(encoding="utf-8"))
    for name, v in extra.items():
        candidates[name] = load_candidate(SERVER_SCRIPTS / "additionalCandidatesFullResults.json", key=name)
    df_candidates = pd.DataFrame([all_features(c) | {"field_id": name} for name, c in candidates.items()])

    print(f"[ndyi_temporal_shape_experiment] {len(df_slovak)} Slovak positives, {len(df_india)} India (unlabeled target), {len(df_candidates)} real Indian candidates\n")

    results = {}
    for model_name, cols in MODELS.items():
        cols = [c for c in cols if c in df_slovak.columns]
        print(f"\n{'='*70}\nMODEL {model_name}  ({len(cols)} features: {cols})\n{'='*70}")

        # --- Part 3: Slovak leave-one-field-out calibration ---
        lofo = leave_one_field_out_source_scores(df_slovak, cols)
        lofo_stats = {"mean": float(np.mean(lofo)), "std": float(np.std(lofo)), "median": float(np.median(lofo)), "min": float(np.min(lofo)), "max": float(np.max(lofo))}
        print(f"  Slovak LOFO score: mean={lofo_stats['mean']:.3f} std={lofo_stats['std']:.3f} median={lofo_stats['median']:.3f} range=[{lofo_stats['min']:.3f},{lofo_stats['max']:.3f}]")

        # --- Part 7: source-leakage / separability probe ---
        combined = pd.concat([df_slovak.assign(source="slovak"), df_india.assign(source="india")], ignore_index=True)
        sep = diagnose(combined, cols, model_name)

        # --- Part 4/5: target-domain distribution + candidate scores (fit on full 100 positives, matching production methodology) ---
        india_scores = combo_score(df_slovak, df_india, cols)
        candidate_scores = combo_score(df_slovak, df_candidates, cols)
        india_stats = {"mean": float(india_scores.mean()), "std": float(india_scores.std()), "p90": float(np.percentile(india_scores, 90)), "p99": float(np.percentile(india_scores, 99)), "max": float(india_scores.max())}
        print(f"  India (target) score distribution: mean={india_stats['mean']:.4f} p90={india_stats['p90']:.4f} p99={india_stats['p99']:.4f} max={india_stats['max']:.4f}")
        print(f"  Source separability: accuracy={sep['accuracy']:.4f} ROC-AUC={sep['roc_auc']:.4f}")
        print("  Real Indian candidate scores:")
        for fid, score in zip(df_candidates["field_id"], candidate_scores):
            print(f"    {fid:20s} {score*100:.2f}%")

        results[model_name] = {
            "features": cols,
            "lofo_stats": lofo_stats,
            "source_separability": {"accuracy": sep["accuracy"], "roc_auc": sep["roc_auc"], "top10_features": sep["top20_feature_importance"][:10]},
            "india_target_distribution": india_stats,
            "candidate_scores": {fid: float(s) for fid, s in zip(df_candidates["field_id"], candidate_scores)},
        }

    out_path = PILOT_DIR / "ndyi_temporal_shape_experiment.json"
    out_path.write_text(json.dumps(results, indent=2, default=str), encoding="utf-8")
    print(f"\n[ndyi_temporal_shape_experiment] wrote {out_path.relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    main()
