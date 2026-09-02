"""
Deep leakage diagnosis, Step 2-4 of the methodology-fix task: compares feature representation A
(calendar-time temporal features, from pilot_features.py / pilot_feature_matrix.jsonl) against
representation B (own-observed-window-fraction temporal features, from
pilot_features_relative.py / pilot_feature_matrix_relative.jsonl) on the exact same 350 real
extracted fields, using the exact same source-leakage probe design as train.py's
assert_no_source_leakage (not duplicated logic — reimplemented here only to additionally expose
ROC-AUC/confusion-matrix/top-20, which assert_no_source_leakage deliberately keeps minimal).

Zero new CDSE requests — reads only the two already-materialized local feature matrices.

Run: training/.venv/bin/python3 training/sunflower/pilot_leakage_diagnosis.py
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import confusion_matrix, roc_auc_score
from sklearn.model_selection import StratifiedKFold, cross_val_predict

REPO_ROOT = Path(__file__).resolve().parents[2]
PILOT_DIR = REPO_ROOT / "training" / "data" / "pilot"
PROBE_SEED = 0  # matches train.py's assert_no_source_leakage probe seed exactly

AGGREGATE = [f"{idx}_{stat}" for idx in ["ndvi", "ndre", "ndwi", "ndyi"] for stat in ["mean", "peak_value"]] + ["ndre_ndvi_peak_ratio"]
TEMPORAL = [f"{idx}_{stat}" for idx in ["ndvi", "ndre", "ndwi", "ndyi"] for stat in ["slope", "pre_peak_slope", "post_peak_slope", "growth_acceleration", "variability"]]
FULL_S2 = AGGREGATE + TEMPORAL

FEATURE_EXPLANATIONS = {
    "n_obs": "Count of real cloud-free Sentinel-2 observations in the window -- driven by real regional cloud-cover/revisit patterns (EuroCrops mean 32.0 vs AMED mean 15.1 in this pilot), not by crop identity. A pure geography/atmosphere proxy.",
    "growth_acceleration": "Second-derivative shape feature computed over the SAME fixed Apr-Sep calendar window for both sources. Sign/magnitude reflects which portion of each region's real growing season that fixed window happens to overlap -- a season-window artifact, not crop identity, unless normalized to each field's own observed timeline (representation B).",
    "pre_peak_slope": "Growth-rate before the observed peak, in calendar-day units under representation A. Confounded with how much of the pre-peak ramp the fixed window actually captured for each region.",
    "post_peak_slope": "Decline/senescence rate after the observed peak, calendar-day units under A. Same window-overlap confound as pre_peak_slope.",
    "peak_day": "Absolute day-since-window-start of the observed peak -- by definition encodes calendar timing, which differs systematically by region's real sowing calendar. Excluded from the model feature set entirely (never passed to the leakage probe or any classifier) for exactly this reason.",
    "days_since_peak": "Same calendar-timing confound as peak_day. Also excluded from the feature set.",
    "slope": "Whole-window linear trend, calendar-day units under A -- inherits the same window-overlap confound as growth_acceleration, at first order instead of second.",
    "variability": "Std. dev. of the real index values across the window -- a real quality/heterogeneity signal, but can still correlate with source if one region's real sample has more diverse real crop/field conditions than the other (as AMED's 12-crop multi-crop negative sample does vs. EuroCrops' single-crop positive sample).",
    "mean": "Whole-window average index value -- NOT a calendar-time feature (unaffected by the A/B rescaling), but can still separate sources if the two real crop populations have genuinely different real absolute reflectance/vegetation levels.",
    "peak_value": "Same as mean: not time-axis-dependent, reflects real absolute index magnitude at the observed peak.",
}


def explain(feature_name: str) -> str:
    for key, text in FEATURE_EXPLANATIONS.items():
        if feature_name.endswith(key):
            return text
    return "(no specific explanation registered for this feature name)"


def diagnose(df: pd.DataFrame, feature_cols: list[str], label: str) -> dict:
    X = df[feature_cols].copy()
    # Median-impute for the probe only (same missingness as the real modeling pipeline) --
    # never written back to the feature file, never treated as a real observed value.
    X = X.fillna(X.median(numeric_only=True))
    y_source = df["source"].astype("category").cat.codes
    source_names = dict(enumerate(df["source"].astype("category").cat.categories))

    probe = RandomForestClassifier(n_estimators=100, random_state=PROBE_SEED)
    skf = StratifiedKFold(n_splits=3, shuffle=True, random_state=PROBE_SEED)
    y_pred = cross_val_predict(probe, X, y_source, cv=skf)
    y_proba = cross_val_predict(probe, X, y_source, cv=skf, method="predict_proba")[:, 1]

    accuracy = float((y_pred == y_source).mean())
    roc_auc = float(roc_auc_score(y_source, y_proba))
    cm = confusion_matrix(y_source, y_pred).tolist()

    probe_full = RandomForestClassifier(n_estimators=200, random_state=PROBE_SEED)
    probe_full.fit(X, y_source)
    importances = sorted(zip(feature_cols, probe_full.feature_importances_), key=lambda t: -t[1])
    top20 = importances[:20]

    print(f"\n[pilot_leakage_diagnosis] === Representation {label} ({len(feature_cols)} features) ===")
    print(f"  source_names: {source_names}")
    print(f"  source-classification accuracy (3-fold CV): {accuracy:.4f}")
    print(f"  source-classification ROC-AUC (3-fold CV): {roc_auc:.4f}")
    print(f"  confusion matrix (rows=true, cols=pred): {cm}")
    print(f"  top 20 source-predictive features:")
    for rank, (feat, imp) in enumerate(top20, 1):
        print(f"    {rank:2d}. {feat:35s} importance={imp:.4f}  -- {explain(feat)}")

    return {
        "representation": label,
        "n_features": len(feature_cols),
        "features": feature_cols,
        "source_names": source_names,
        "accuracy": accuracy,
        "roc_auc": roc_auc,
        "confusion_matrix": cm,
        "top20_feature_importance": [{"feature": f, "importance": float(i), "explanation": explain(f)} for f, i in top20],
    }


def main() -> None:
    df_a = pd.read_json(PILOT_DIR / "pilot_feature_matrix.jsonl", orient="records", lines=True)
    df_b = pd.read_json(PILOT_DIR / "pilot_feature_matrix_relative.jsonl", orient="records", lines=True)

    result_a = diagnose(df_a, FULL_S2, "A (calendar-time)")
    result_b = diagnose(df_b, FULL_S2, "B (field-relative fraction)")

    print("\n[pilot_leakage_diagnosis] === A vs B summary ===")
    print(f"  A: accuracy={result_a['accuracy']:.4f}  ROC-AUC={result_a['roc_auc']:.4f}")
    print(f"  B: accuracy={result_b['accuracy']:.4f}  ROC-AUC={result_b['roc_auc']:.4f}")
    delta = result_a["accuracy"] - result_b["accuracy"]
    print(f"  accuracy reduction from A to B: {delta:+.4f}")
    if result_b["accuracy"] > 0.9:
        print("  B STILL EXCEEDS the 90% leakage threshold -- field-relative normalization alone does NOT resolve the source artifact.")
    else:
        print("  B falls under the 90% leakage threshold -- field-relative normalization materially helps, though this does not by itself prove a crop-specific (vs. residual-geography) signal.")

    out = {"A": result_a, "B": result_b, "accuracy_delta_a_minus_b": delta}
    out_path = PILOT_DIR / "pilot_leakage_diagnosis.json"
    out_path.write_text(json.dumps(out, indent=2), encoding="utf-8")
    print(f"\n[pilot_leakage_diagnosis] wrote {out_path.relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    main()
