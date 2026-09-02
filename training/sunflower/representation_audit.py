"""
Zero-PU audit: does a domain-robust representation of the SAME already-extracted Sentinel-2 data
preserve a sunflower-specific signal better than the current production (raw mean/peak)
representation? Tests representations B-F against the current A (raw), on:

  1. Slovak-positive internal consistency (does the representation still describe "sunflower"
     tightly across the 100 real positives, or does it just add noise?)
  2. Source separability (Slovak vs. India) -- reusing the same probe design from
     pilot_leakage_diagnosis.py -- to check whether a representation reduces "detects country"
     vs. raw.
  3. The real Karnataka candidate's (field 7J3RQJCW+F4WP) distance from the Slovak centroid
     under each representation -- one real field, already live-extracted (see
     server/scripts/karnatakaCandidateFullResult.json), NOT re-extracted here.
  4. The 250 real India AMED fields used ONLY as an unlabeled target/reference population for
     ranking/diagnostic context -- never as negative training labels.

Every representation is computable from a single field's own real observed daily series with NO
cross-field information needed at inference time (only reference-population statistics computed
ONCE offline, exactly matching how the shipped production model already works) -- so nothing
found "good" here would require redesigning the real-time production path.

Zero new CDSE requests -- reads only already-extracted local data.

Run: training/.venv/bin/python3 training/sunflower/representation_audit.py
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import StratifiedKFold, cross_val_predict
from sklearn.metrics import roc_auc_score

from pilot_features import build_observations
from temporal_features import Observation, compute_phenology_features, normalize_by_season_fraction

REPO_ROOT = Path(__file__).resolve().parents[2]
PILOT_DIR = REPO_ROOT / "training" / "data" / "pilot"
KARNATAKA_RESULT_PATH = REPO_ROOT / "server" / "scripts" / "karnatakaCandidateFullResult.json"
INDEX_NAMES = ["ndvi", "ndre", "ndwi", "ndyi"]
PROBE_SEED = 0


def field_index_stats(daily_series: list[dict]) -> dict:
    """All representation-B-F derived stats for ONE field's ONE real index series, computed
    entirely from that field's own real observed values -- nothing here needs another field's
    data, matching the real-time production constraint."""
    obs = build_observations(daily_series)
    if not obs or len(obs) < 3:
        return {k: None for k in ["mean", "peak", "median", "std", "zscore_peak", "shape_peak", "baseline_fraction", "min_fraction", "peak_day_fraction", "pre_peak_slope_frac", "post_peak_slope_frac"]}

    values = np.array([o.value for o in obs])
    mean = float(values.mean())
    peak = float(values.max())
    median = float(np.median(values))
    std = float(values.std(ddof=1)) if len(values) > 1 else None

    zscore_peak = (peak - mean) / std if std and std > 0 else None
    shape_peak = peak - median
    baseline_fraction = mean / peak if peak != 0 else None
    min_fraction = float(values.min()) / peak if peak != 0 else None

    # F: phenological shape, using the field's OWN observed-window fraction (already-written,
    # already-used normalize_by_season_fraction) -- never an assumed calendar date.
    season_length = max(o.days_since_start for o in obs)
    peak_day_fraction = None
    pre_peak_slope_frac = None
    post_peak_slope_frac = None
    if season_length > 0:
        obs_frac = normalize_by_season_fraction(obs, season_length)
        pf = compute_phenology_features(obs_frac, as_of_day=1.0)
        peak_day_fraction = pf.peak_day
        pre_peak_slope_frac = pf.pre_peak_slope
        post_peak_slope_frac = pf.post_peak_slope

    return {
        "mean": mean, "peak": peak, "median": median, "std": std,
        "zscore_peak": zscore_peak, "shape_peak": shape_peak,
        "baseline_fraction": baseline_fraction, "min_fraction": min_fraction,
        "peak_day_fraction": peak_day_fraction,
        "pre_peak_slope_frac": pre_peak_slope_frac, "post_peak_slope_frac": post_peak_slope_frac,
    }


def field_features(field_result: dict) -> dict:
    feats = {}
    per_index = {}
    for idx in INDEX_NAMES:
        stats = field_index_stats(field_result["indices"].get(idx, []))
        per_index[idx] = stats
        for k, v in stats.items():
            feats[f"{idx}_{k}"] = v

    # E: index-ratio features -- NDYI relative to each vigor index, at both mean and peak.
    for vigor in ["ndvi", "ndre", "ndwi"]:
        ndyi_mean, vigor_mean = per_index["ndyi"]["mean"], per_index[vigor]["mean"]
        ndyi_peak, vigor_peak = per_index["ndyi"]["peak"], per_index[vigor]["peak"]
        feats[f"ndyi_{vigor}_mean_ratio"] = ndyi_mean / vigor_mean if vigor_mean not in (None, 0) and ndyi_mean is not None else None
        feats[f"ndyi_{vigor}_peak_ratio"] = ndyi_peak / vigor_peak if vigor_peak not in (None, 0) and ndyi_peak is not None else None
    return feats


def load_karnataka_features() -> dict:
    raw = json.loads(KARNATAKA_RESULT_PATH.read_text(encoding="utf-8"))
    # Reconstruct the same {date, mean} shape build_observations expects, from the saved trajectory.
    field_result = {"indices": {idx: [{"date": p["date"], "mean": p["value"]} for p in raw["indices"][idx]["trajectory"]] for idx in INDEX_NAMES}}
    return field_features(field_result)


def build_matrix(rows: list[dict], label: str) -> pd.DataFrame:
    records = [field_features(row) | {"field_id": row["field_id"], "label_source": label} for row in rows]
    return pd.DataFrame(records)


def main() -> None:
    pos_rows = [json.loads(l) for l in (PILOT_DIR / "eurocrops_sentinel2_features.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]
    neg_rows = [json.loads(l) for l in (PILOT_DIR / "amed_sentinel2_features.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]

    df_slovak = build_matrix(pos_rows, "slovak")
    df_india = build_matrix(neg_rows, "india")
    karnataka = load_karnataka_features()

    feature_cols = [c for c in df_slovak.columns if c not in ("field_id", "label_source")]

    print(f"[representation_audit] {len(df_slovak)} Slovak positives, {len(df_india)} India (unlabeled target) fields, {len(feature_cols)} derived features per field\n")

    # --- 1. Slovak internal consistency: coefficient of variation per derived feature ---
    print("=== 1. Slovak-positive internal consistency (lower CV = tighter, more consistent 'sunflower signature') ===")
    cv_report = {}
    for col in feature_cols:
        vals = df_slovak[col].dropna()
        if len(vals) < 10:
            continue
        cv = float(vals.std() / abs(vals.mean())) if vals.mean() != 0 else None
        cv_report[col] = cv
    for col, cv in sorted(cv_report.items(), key=lambda kv: (kv[1] is None, kv[1] if kv[1] is not None else 0))[:15]:
        print(f"  {col:32s} CV={cv:.3f}" if cv is not None else f"  {col:32s} CV=n/a")

    # --- 2. Source separability probe per representation group ---
    print("\n=== 2. Source (Slovak vs. India) separability, by representation group ===")
    groups = {
        "A_raw": [c for c in feature_cols if c.endswith(("_mean", "_peak"))],
        "B_zscore_peak": [c for c in feature_cols if c.endswith("_zscore_peak")],
        "C_median_shape": [c for c in feature_cols if c.endswith("_shape_peak")],
        "D_peak_relative": [c for c in feature_cols if c.endswith(("_baseline_fraction", "_min_fraction"))],
        "E_index_ratio": [c for c in feature_cols if "ratio" in c],
        "F_phenology_shape": [c for c in feature_cols if c.endswith(("_peak_day_fraction", "_pre_peak_slope_frac", "_post_peak_slope_frac"))],
    }
    combined = pd.concat([df_slovak, df_india], ignore_index=True)
    y = (combined["label_source"] == "slovak").astype(int)
    separability = {}
    for group_name, cols in groups.items():
        cols = [c for c in cols if c in combined.columns]
        if not cols:
            continue
        X = combined[cols].copy()
        X = X.fillna(X.median(numeric_only=True))
        skf = StratifiedKFold(n_splits=3, shuffle=True, random_state=PROBE_SEED)
        probe = RandomForestClassifier(n_estimators=150, random_state=PROBE_SEED)
        proba = cross_val_predict(probe, X, y, cv=skf, method="predict_proba")[:, 1]
        auc = roc_auc_score(y, proba)
        separability[group_name] = {"n_features": len(cols), "source_roc_auc": float(auc)}
        print(f"  {group_name:20s} ({len(cols):2d} feats)  source ROC-AUC={auc:.4f}  {'<-- still near-perfect source separability' if auc > 0.9 else '<-- meaningfully reduced from raw'}")

    # --- 3. Karnataka candidate's standardized distance from the Slovak centroid, per representation ---
    print("\n=== 3. Karnataka candidate (7J3RQJCW+F4WP) distance from Slovak centroid, per representation ===")
    karnataka_report = {}
    for group_name, cols in groups.items():
        cols = [c for c in cols if c in df_slovak.columns]
        if not cols:
            continue
        slovak_vals = df_slovak[cols].apply(pd.to_numeric, errors="coerce")
        means = slovak_vals.mean()
        stds = slovak_vals.std()
        z_scores = {}
        for c in cols:
            kv = karnataka.get(c)
            if kv is None or pd.isna(means[c]) or not stds[c] or stds[c] == 0:
                continue
            z_scores[c] = (kv - means[c]) / stds[c]
        if not z_scores:
            continue
        mean_abs_z = float(np.mean([abs(v) for v in z_scores.values()]))
        karnataka_report[group_name] = {"mean_abs_z": mean_abs_z, "per_feature_z": {k: round(v, 2) for k, v in z_scores.items()}}
        print(f"  {group_name:20s} mean |z| = {mean_abs_z:.2f}")
        for k, v in sorted(z_scores.items(), key=lambda kv: -abs(kv[1])):
            print(f"      {k:32s} z={v:+.2f}")

    # --- NDYI-specific deep dive (explicitly requested) ---
    print("\n=== NDYI-specific deep dive: Karnataka candidate vs. Slovak reference ===")
    for col in ["ndyi_mean", "ndyi_peak", "ndyi_zscore_peak", "ndyi_baseline_fraction", "ndyi_ndvi_mean_ratio", "ndyi_ndvi_peak_ratio", "ndyi_ndre_mean_ratio", "ndyi_ndwi_mean_ratio"]:
        if col not in df_slovak.columns:
            continue
        slovak_vals = pd.to_numeric(df_slovak[col], errors="coerce").dropna()
        kv = karnataka.get(col)
        if kv is None or len(slovak_vals) == 0:
            continue
        z = (kv - slovak_vals.mean()) / slovak_vals.std() if slovak_vals.std() else None
        print(f"  {col:26s} karnataka={kv:.4f}  slovak_mean={slovak_vals.mean():.4f}±{slovak_vals.std():.4f}  z={z:+.2f}" if z is not None else f"  {col:26s} karnataka={kv:.4f}  slovak std=0")

    # --- 4. India population diagnostic (unlabeled target, ranking sensibility only) ---
    print("\n=== 4. India (unlabeled target population) ranking sensibility, by ndyi_ndvi_peak_ratio ===")
    india_ratio = pd.to_numeric(df_india["ndyi_ndvi_peak_ratio"], errors="coerce")
    df_india_ranked = df_india.assign(ndyi_ndvi_peak_ratio_numeric=india_ratio).dropna(subset=["ndyi_ndvi_peak_ratio_numeric"])
    print(f"  n={len(df_india_ranked)} real India fields with a computable ratio (out of {len(df_india)})")
    print(f"  distribution: mean={india_ratio.mean():.4f} std={india_ratio.std():.4f} min={india_ratio.min():.4f} max={india_ratio.max():.4f}")
    slovak_ratio = pd.to_numeric(df_slovak["ndyi_ndvi_peak_ratio"], errors="coerce").dropna()
    print(f"  Slovak reference: mean={slovak_ratio.mean():.4f} std={slovak_ratio.std():.4f}")
    print(f"  Karnataka candidate: {karnataka.get('ndyi_ndvi_peak_ratio')}")

    out = {
        "cv_report": cv_report,
        "source_separability_by_group": separability,
        "karnataka_report": karnataka_report,
        "karnataka_features": karnataka,
    }
    out_path = PILOT_DIR / "representation_audit.json"
    out_path.write_text(json.dumps(out, indent=2, default=str), encoding="utf-8")
    print(f"\n[representation_audit] wrote {out_path.relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    main()
