"""
Feature-set ablation A-F for the strongest VALID within-source crop test available in the
current 350-field pilot: the within-India 7-real-crop classification (see
pilot_within_source_crop_signal_check.py's module docstring for why this is the only valid
within-source crop test -- India AMED has 0 Sunflower rows and Slovakia EuroCrops has 0
non-Sunflower rows in this pilot, so neither a real sunflower-vs-other-India nor a real
sunflower-vs-other-Slovakia test can be run without a new extraction).

Reuses within_india_crop_signal() (not duplicated) for every configuration, so every row below
comes from the exact same probe design (RandomForest, 3-fold stratified CV, seed=0) -- only the
feature columns change.

No latitude/longitude/country/source/field_id/administrative-region/calendar-month feature is
ever included -- every configuration below is built exclusively from spectral index statistics.

Zero new CDSE requests -- reads only the already-extracted local feature matrix.

Run: training/.venv/bin/python3 training/sunflower/pilot_feature_ablation.py
"""

from __future__ import annotations

import json
from pathlib import Path

import pandas as pd

from pilot_within_source_crop_signal_check import feature_importance_for, within_india_crop_signal

REPO_ROOT = Path(__file__).resolve().parents[2]
PILOT_DIR = REPO_ROOT / "training" / "data" / "pilot"

TEMPORAL = [f"{idx}_{stat}" for idx in ["ndvi", "ndre", "ndwi", "ndyi"] for stat in ["slope", "pre_peak_slope", "post_peak_slope", "growth_acceleration", "variability"]]

CONFIGS = {
    "A_ndvi_only": ["ndvi_mean", "ndvi_peak_value"],
    "B_ndvi_ndre": ["ndvi_mean", "ndvi_peak_value", "ndre_mean", "ndre_peak_value"],
    "C_ndvi_ndre_ndwi": ["ndvi_mean", "ndvi_peak_value", "ndre_mean", "ndre_peak_value", "ndwi_mean", "ndwi_peak_value"],
    "D_ndvi_ndre_ndwi_ndyi": ["ndvi_mean", "ndvi_peak_value", "ndre_mean", "ndre_peak_value", "ndwi_mean", "ndwi_peak_value", "ndyi_mean", "ndyi_peak_value"],
    "E_all_aggregate_plus_cross_index": ["ndvi_mean", "ndvi_peak_value", "ndre_mean", "ndre_peak_value", "ndwi_mean", "ndwi_peak_value", "ndyi_mean", "ndyi_peak_value", "ndre_ndvi_peak_ratio"],
    "F_temporal_only": TEMPORAL,
    "G_full_s2_aggregate_plus_temporal": ["ndvi_mean", "ndvi_peak_value", "ndre_mean", "ndre_peak_value", "ndwi_mean", "ndwi_peak_value", "ndyi_mean", "ndyi_peak_value", "ndre_ndvi_peak_ratio"] + TEMPORAL,
}


def main() -> None:
    df = pd.read_json(PILOT_DIR / "pilot_feature_matrix.jsonl", orient="records", lines=True)

    results = {}
    print("[pilot_feature_ablation] within-India 7-crop classification, feature ablation A-G:\n")
    print(f"{'config':32s} {'n_feat':>6s} {'accuracy':>9s} {'baseline':>9s} {'lift':>8s} {'f1_macro':>9s} {'roc_auc_ovr':>12s}")
    for name, cols in CONFIGS.items():
        r = within_india_crop_signal(df, cols)
        results[name] = r
        roc = f"{r['roc_auc_macro_ovr']:.4f}" if r["roc_auc_macro_ovr"] is not None else "n/a"
        print(f"{name:32s} {len(cols):6d} {r['cv_accuracy']:9.4f} {r['majority_class_baseline_accuracy']:9.4f} {r['lift_over_baseline']:+8.4f} {r['f1_macro']:9.4f} {roc:>12s}")

    print("\n[pilot_feature_ablation] top 20 feature importances for the best-performing config (G, full_s2):")
    importances = feature_importance_for(df, CONFIGS["G_full_s2_aggregate_plus_temporal"])
    for rank, (feat, imp) in enumerate(importances[:20], 1):
        print(f"  {rank:2d}. {feat:30s} {imp:.4f}")

    out = {
        "configs": {name: cols for name, cols in CONFIGS.items()},
        "results": results,
        "top20_feature_importance_full_s2": [{"feature": f, "importance": float(i)} for f, i in importances[:20]],
        "note": "All configurations evaluated on the exact same within-India 7-crop task (see pilot_within_source_crop_signal_check.py) -- this is a crop-vs-crop test within a single geography, NOT the cross-source Slovakia-vs-India leakage probe.",
    }
    out_path = PILOT_DIR / "pilot_feature_ablation.json"
    out_path.write_text(json.dumps(out, indent=2), encoding="utf-8")
    print(f"\n[pilot_feature_ablation] wrote {out_path.relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    main()
