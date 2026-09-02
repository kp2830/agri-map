"""
Domain-normalization experiments, zero-PU only. Tests whether removing each field's OWN absolute
spectral baseline (using only that field's own real observed values -- nothing else, nothing
unavailable at real inference time) still leaves crop-discriminative signal, and whether it
reduces the Slovakia-vs-India source-separability problem documented in
pilot_leakage_diagnosis.py.

Four per-field, per-index transforms of the RAW daily value series (days are never touched --
only chooses what "value" means before phenology features are computed from it):

  raw            : v                                        (representation A, unchanged)
  zscore         : (v - field_own_mean) / field_own_std      (removes level AND scale)
  median_subtract: v - field_own_median                      (removes level only, keeps scale)
  rank           : percentile rank of v within the field's own real series, in [0, 1]
                   (removes level AND scale, keeps only relative ordering -- the strictest test)

Every transform uses ONLY that single field's own real observed values across its own real
season -- no cross-field statistic, no population mean/std, nothing that would require knowing
other fields (or the label) at inference time.

Reuses build_observations() (pilot_features.py) and compute_phenology_features()
(temporal_features.py) -- not duplicated. Reuses the diagnose() probe from
pilot_leakage_diagnosis.py and within_india_crop_signal() from
pilot_within_source_crop_signal_check.py for evaluation -- not duplicated.

Zero new CDSE requests -- reads only the already-extracted local raw per-day series.

Run: training/.venv/bin/python3 training/sunflower/pilot_normalization_experiments.py
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

from pilot_features import INDEX_NAMES, build_observations
from pilot_leakage_diagnosis import FULL_S2 as LEAKAGE_FULL_S2
from pilot_leakage_diagnosis import diagnose
from pilot_within_source_crop_signal_check import within_india_crop_signal
from temporal_features import Observation, compute_phenology_features

REPO_ROOT = Path(__file__).resolve().parents[2]
PILOT_DIR = REPO_ROOT / "training" / "data" / "pilot"

TRANSFORMS = ["raw", "zscore", "median_subtract", "rank"]


def transform_values(values: list[float], kind: str) -> list[float] | None:
    """Applies one transform to a single field's own real value series. Returns None if the
    transform cannot be legitimately computed (e.g. z-score needs >=2 distinct real values to
    have a non-zero std) -- never fabricates a value to force a transform through."""
    n = len(values)
    if kind == "raw":
        return values
    if kind == "median_subtract":
        med = float(np.median(values))
        return [v - med for v in values]
    if kind == "zscore":
        std = float(np.std(values, ddof=1)) if n >= 2 else 0.0
        if std == 0.0:
            return None
        mean = float(np.mean(values))
        return [(v - mean) / std for v in values]
    if kind == "rank":
        if n < 2:
            return None
        order = np.argsort(np.argsort(values))  # rank 0..n-1, ties broken by position (real, not fabricated)
        return [r / (n - 1) for r in order]
    raise ValueError(kind)


def field_features_transformed(field_result: dict, kind: str) -> dict:
    feats: dict[str, float | None] = {}
    suffixes = ["mean", "slope", "peak_value", "pre_peak_slope", "post_peak_slope", "growth_acceleration", "variability", "n_obs"]
    for index_name in INDEX_NAMES:
        obs = build_observations(field_result["indices"].get(index_name, []))
        if not obs:
            for suffix in suffixes:
                feats[f"{index_name}_{suffix}"] = None
            continue

        raw_values = [o.value for o in obs]
        new_values = transform_values(raw_values, kind)
        if new_values is None:
            for suffix in suffixes:
                feats[f"{index_name}_{suffix}"] = None
            continue

        transformed_obs = [Observation(days_since_start=o.days_since_start, value=v) for o, v in zip(obs, new_values)]
        as_of = max(o.days_since_start for o in transformed_obs)
        pf = compute_phenology_features(transformed_obs, as_of_day=as_of)
        feats[f"{index_name}_mean"] = pf.mean
        feats[f"{index_name}_slope"] = pf.slope
        feats[f"{index_name}_peak_value"] = pf.peak_value
        feats[f"{index_name}_pre_peak_slope"] = pf.pre_peak_slope
        feats[f"{index_name}_post_peak_slope"] = pf.post_peak_slope
        feats[f"{index_name}_growth_acceleration"] = pf.growth_acceleration
        feats[f"{index_name}_variability"] = pf.variability
        feats[f"{index_name}_n_obs"] = pf.observation_count

    if feats.get("ndvi_peak_value") and feats.get("ndre_peak_value") and feats["ndvi_peak_value"] not in (0, None):
        feats["ndre_ndvi_peak_ratio"] = feats["ndre_peak_value"] / feats["ndvi_peak_value"]
    else:
        feats["ndre_ndvi_peak_ratio"] = None
    return feats


def _disambiguate_field_ids(rows: list[dict]) -> None:
    seen: dict[str, int] = {}
    for row in rows:
        fid = row["field_id"]
        seen[fid] = seen.get(fid, 0) + 1
        if seen[fid] > 1:
            row["field_id"] = f"{fid}__dup{seen[fid]}"


def build_matrix(kind: str) -> pd.DataFrame:
    pos_rows = [json.loads(l) for l in (PILOT_DIR / "eurocrops_sentinel2_features.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]
    neg_rows = [json.loads(l) for l in (PILOT_DIR / "amed_sentinel2_features.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]
    _disambiguate_field_ids(pos_rows)

    records = []
    for row in pos_rows:
        rec = field_features_transformed(row, kind)
        rec.update({"field_id": row["field_id"], "source": row["source"], "country": row["country"], "crop_label": row["crop_label"], "label": 1})
        records.append(rec)
    for row in neg_rows:
        rec = field_features_transformed(row, kind)
        rec.update({"field_id": row["field_id"], "source": row["source"], "country": row["country"], "crop_label": row["crop_label"], "label": 0})
        records.append(rec)
    return pd.DataFrame(records)


def main() -> None:
    all_results = {}
    print(f"{'transform':18s} {'src_acc':>8s} {'src_auc':>8s} {'india_acc':>10s} {'india_lift':>11s} {'india_f1':>9s} {'india_auc':>10s}")
    for kind in TRANSFORMS:
        df = build_matrix(kind)
        out_path = PILOT_DIR / f"pilot_feature_matrix_{kind}.jsonl"
        df.to_json(out_path, orient="records", lines=True)

        source_result = diagnose(df, LEAKAGE_FULL_S2, f"normalization={kind}")
        india_result = within_india_crop_signal(df, LEAKAGE_FULL_S2)

        india_auc = f"{india_result['roc_auc_macro_ovr']:.4f}" if india_result["roc_auc_macro_ovr"] is not None else "n/a"
        print(f"{kind:18s} {source_result['accuracy']:8.4f} {source_result['roc_auc']:8.4f} {india_result['cv_accuracy']:10.4f} {india_result['lift_over_baseline']:+11.4f} {india_result['f1_macro']:9.4f} {india_auc:>10s}")

        all_results[kind] = {
            "feature_matrix_path": str(out_path.relative_to(REPO_ROOT)),
            "source_classification": {
                "accuracy": source_result["accuracy"],
                "roc_auc": source_result["roc_auc"],
                "top5_leaking_features": [f["feature"] for f in source_result["top20_feature_importance"][:5]],
            },
            "within_india_crop_signal": {
                "accuracy": india_result["cv_accuracy"],
                "majority_baseline": india_result["majority_class_baseline_accuracy"],
                "lift": india_result["lift_over_baseline"],
                "f1_macro": india_result["f1_macro"],
                "roc_auc_macro_ovr": india_result["roc_auc_macro_ovr"],
            },
        }

    out_path = PILOT_DIR / "pilot_normalization_experiments.json"
    out_path.write_text(json.dumps(all_results, indent=2), encoding="utf-8")
    print(f"\n[pilot_normalization_experiments] wrote {out_path.relative_to(REPO_ROOT)}")

    raw_src = all_results["raw"]["source_classification"]["accuracy"]
    best_kind = min(TRANSFORMS, key=lambda k: all_results[k]["source_classification"]["accuracy"])
    best_src = all_results[best_kind]["source_classification"]["accuracy"]
    print(f"\n[pilot_normalization_experiments] lowest source-separability transform: '{best_kind}' ({best_src:.4f} vs raw {raw_src:.4f})")
    if best_src > 0.9:
        print("[pilot_normalization_experiments] STILL above the 90% leakage threshold under every tested transform -- normalization does not resolve the Slovakia-vs-India domain shift.")


if __name__ == "__main__":
    main()
