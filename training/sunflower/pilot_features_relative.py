"""
Feature representation B for the leakage investigation: every field's temporal features
recomputed on ITS OWN observed-window fraction instead of absolute days-since-window-start.

t_normalized = (observation_date - first_observation_date) / (last_observation_date - first_observation_date)

Uses ONLY the field's own real observed valid Sentinel-2 dates for first/last — never an
assumed/fabricated sowing, flowering, or harvest date. This is explicitly NOT "bloom-relative":
it is "relative to this field's own observed satellite-observation window," nothing more.

Reuses build_observations() from pilot_features.py (not duplicated) and
normalize_by_season_fraction() from temporal_features.py (already written, previously unused).
Operates entirely on the already-extracted 350-field pilot Sentinel-2 data
(eurocrops_sentinel2_features.jsonl / amed_sentinel2_features.jsonl) — zero new CDSE requests,
zero additional PU.

Run: training/.venv/bin/python3 training/sunflower/pilot_features_relative.py
"""

from __future__ import annotations

import json
from pathlib import Path

import pandas as pd

from pilot_features import INDEX_NAMES, build_observations
from temporal_features import compute_phenology_features, normalize_by_season_fraction

REPO_ROOT = Path(__file__).resolve().parents[2]
PILOT_DIR = REPO_ROOT / "training" / "data" / "pilot"


def field_features_relative(field_result: dict) -> dict:
    """Same 8 phenology stats per index as pilot_features.field_features(), but computed on the
    field's own [0, 1] observed-window fraction rather than absolute days. mean/peak_value are
    unaffected by a monotonic rescaling of the time axis (kept for completeness/parity with
    representation A); slope/peak-timing/acceleration features are the ones this representation
    actually changes."""
    feats: dict[str, float | None] = {}
    for index_name in INDEX_NAMES:
        obs = build_observations(field_result["indices"].get(index_name, []))
        suffixes = ["mean", "slope", "peak_value", "pre_peak_slope", "post_peak_slope", "growth_acceleration", "variability", "n_obs"]
        if not obs:
            for suffix in suffixes:
                feats[f"{index_name}_{suffix}"] = None
            continue

        season_length_days = max(o.days_since_start for o in obs)
        if season_length_days <= 0:
            # Only one distinct real observation day for this field/index — a real season
            # fraction cannot be constructed (division by zero), not enough data, not a
            # fabricated fallback.
            for suffix in suffixes:
                feats[f"{index_name}_{suffix}"] = None
            continue

        obs_frac = normalize_by_season_fraction(obs, season_length_days)
        pf = compute_phenology_features(obs_frac, as_of_day=1.0)
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
    """The 100-field EuroCrops pilot sample contains 2 field_ids that each cover 2 genuinely
    distinct real geometries (a data-ingestion collision, fixed going forward in
    ingest_eurocrops.py for future extractions — see pilot_report.md). This pilot's already
    extracted Sentinel-2 rows were never re-extracted with the fixed IDs (no new CDSE requests
    this round, per instruction), so for local grouping/analysis only, disambiguate in place by
    appending the row's position among same-id rows. This changes no extracted values — only
    the field_id label used for field-level split grouping."""
    seen: dict[str, int] = {}
    for row in rows:
        fid = row["field_id"]
        seen[fid] = seen.get(fid, 0) + 1
        if seen[fid] > 1:
            row["field_id"] = f"{fid}__dup{seen[fid]}"


def main() -> pd.DataFrame:
    pos_rows = [json.loads(l) for l in (PILOT_DIR / "eurocrops_sentinel2_features.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]
    neg_rows = [json.loads(l) for l in (PILOT_DIR / "amed_sentinel2_features.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]
    _disambiguate_field_ids(pos_rows)  # neg_rows (AMED) has no known collisions — confirmed unique in pilot_sampling QC

    records = []
    for row in pos_rows:
        rec = field_features_relative(row)
        rec.update({"field_id": row["field_id"], "source": row["source"], "country": row["country"], "crop_label": row["crop_label"], "label": 1})
        records.append(rec)
    for row in neg_rows:
        rec = field_features_relative(row)
        rec.update({"field_id": row["field_id"], "source": row["source"], "country": row["country"], "crop_label": row["crop_label"], "label": 0})
        records.append(rec)

    df = pd.DataFrame(records)
    out_path = PILOT_DIR / "pilot_feature_matrix_relative.jsonl"
    df.to_json(out_path, orient="records", lines=True)
    print(f"[pilot_features_relative] {len(df)} rows ({df['label'].sum()} positive, {(df['label']==0).sum()} negative)")
    print(f"[pilot_features_relative] wrote {out_path.relative_to(REPO_ROOT)}")
    return df


if __name__ == "__main__":
    main()
