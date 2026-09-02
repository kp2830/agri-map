"""
Builds the pilot feature matrix from real extracted Sentinel-2 observations, using
temporal_features.py (no duplicate logic). Every temporal feature is relative to each field's
OWN observation timeline (days since its own first real observation) — never a calendar date,
never a "days since flowering" feature, since no real flowering dates exist for EuroCrops.

Run: training/.venv/bin/python3 training/sunflower/pilot_features.py
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

import pandas as pd

from temporal_features import Observation, compute_phenology_features

REPO_ROOT = Path(__file__).resolve().parents[2]
PILOT_DIR = REPO_ROOT / "training" / "data" / "pilot"

INDEX_NAMES = ["ndvi", "ndre", "ndwi", "ndyi"]


def parse_date(iso: str) -> datetime:
    return datetime.fromisoformat(iso.replace("Z", "+00:00"))


def build_observations(index_series: list[dict]) -> list[Observation]:
    """Converts a real per-index daily series (real dates, real means) into relative-time
    Observation objects — day 0 is this field's own first real observation, never a calendar
    date or an assumed sowing/flowering reference."""
    if not index_series:
        return []
    dates = [parse_date(o["date"]) for o in index_series]
    first = min(dates)
    return [Observation(days_since_start=(d - first).days, value=o["mean"]) for d, o in zip(dates, index_series)]


def field_features(field_result: dict) -> dict:
    """Real feature vector for one field — ONLY transferable satellite-derived statistics.
    Provenance fields (field_id/source/country/crop_label) are attached separately by the
    caller and must never be included in the returned dict, which is exactly what enters the
    ML feature matrix."""
    feats: dict[str, float | None] = {}
    for index_name in INDEX_NAMES:
        obs = build_observations(field_result["indices"].get(index_name, []))
        if not obs:
            for suffix in ["mean", "slope", "peak_value", "pre_peak_slope", "post_peak_slope", "growth_acceleration", "variability", "n_obs"]:
                feats[f"{index_name}_{suffix}"] = None
            continue
        as_of = max(o.days_since_start for o in obs)
        pf = compute_phenology_features(obs, as_of_day=as_of)
        feats[f"{index_name}_mean"] = pf.mean
        feats[f"{index_name}_slope"] = pf.slope
        feats[f"{index_name}_peak_value"] = pf.peak_value
        feats[f"{index_name}_pre_peak_slope"] = pf.pre_peak_slope
        feats[f"{index_name}_post_peak_slope"] = pf.post_peak_slope
        feats[f"{index_name}_growth_acceleration"] = pf.growth_acceleration
        feats[f"{index_name}_variability"] = pf.variability
        feats[f"{index_name}_n_obs"] = pf.observation_count

    # A real, physically-meaningful cross-index feature: NDRE/NDVI ratio at peak — captures
    # canopy structure independent of the two indices' individual absolute scales.
    if feats.get("ndvi_peak_value") and feats.get("ndre_peak_value") and feats["ndvi_peak_value"] not in (0, None):
        feats["ndre_ndvi_peak_ratio"] = feats["ndre_peak_value"] / feats["ndvi_peak_value"]
    else:
        feats["ndre_ndvi_peak_ratio"] = None

    return feats


def main() -> pd.DataFrame:
    pos_rows = [json.loads(l) for l in (PILOT_DIR / "eurocrops_sentinel2_features.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]
    neg_rows = [json.loads(l) for l in (PILOT_DIR / "amed_sentinel2_features.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]

    records = []
    for row in pos_rows:
        rec = field_features(row)
        rec.update({"field_id": row["field_id"], "source": row["source"], "country": row["country"], "crop_label": row["crop_label"], "label": 1})
        records.append(rec)
    for row in neg_rows:
        rec = field_features(row)
        rec.update({"field_id": row["field_id"], "source": row["source"], "country": row["country"], "crop_label": row["crop_label"], "label": 0})
        records.append(rec)

    df = pd.DataFrame(records)
    out_path = PILOT_DIR / "pilot_feature_matrix.jsonl"
    df.to_json(out_path, orient="records", lines=True)
    print(f"[pilot_features] {len(df)} rows ({df['label'].sum()} positive, {(df['label']==0).sum()} negative)")
    print(f"[pilot_features] wrote {out_path.relative_to(REPO_ROOT)}")
    feature_cols = [c for c in df.columns if c not in ("field_id", "source", "country", "crop_label", "label")]
    print(f"[pilot_features] {len(feature_cols)} feature columns: {feature_cols}")
    return df


if __name__ == "__main__":
    main()
