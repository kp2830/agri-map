"""
Assembles the first experimental training table:
    Kurukshetra-Karnal weak positives (Tier A + Tier B, n=26)
        +
    Existing 250 Indian AMED negatives (training/data/pilot/amed_negative_manifest.jsonl +
    amed_sentinel2_features.jsonl, from the earlier EuroCrops-based sunflower pilot)

Reports exact counts and feature compatibility BEFORE training anything.

Feature-compatibility note (real, reported honestly, not silently patched over): the existing
250 negatives' raw Sentinel-2 features are a DAILY time series over 2021-04-01..2021-09-30 (a
DIFFERENT year, and a different, wider window structure) than the Kurukshetra-Karnal positives'
pre-aggregated April 15-30 / May 1-20 / June 1-15 2026 windows. To get a comparable feature
vector, this script derives the SAME April/May/June-equivalent aggregates from the negatives'
own real daily series (same day-of-month windows, but naturally falling in 2021 since that's the
real data available for them) -- this is a real recomputation from real per-day satellite means
already on file, not fabricated data. The year mismatch (2021 vs 2026) and the geographic
mismatch (250 negatives are Karnataka/Andhra Pradesh/Maharashtra/Telangana; 26 positives are
Haryana) are real, standing limitations of this first experiment -- stated plainly in the run
report, not hidden.

Run: ../.venv/bin/python3 assemble_rf_dataset.py
"""
import json
import statistics

WINDOWS = {
    "apr": ("04-15", "04-30"),
    "may": ("05-01", "05-20"),
    "june": ("06-01", "06-15"),
}


def in_window(date_str, window):
    md = date_str[5:10]  # "MM-DD"
    return window[0] <= md <= window[1]


def window_mean(daily_obs, window):
    vals = [o["mean"] for o in daily_obs if o["mean"] is not None and in_window(o["date"], window)]
    vals = [v for v in vals if isinstance(v, (int, float))]
    if not vals:
        return None, 0, 0
    total_days = sum(1 for o in daily_obs if in_window(o["date"], window))
    return statistics.mean(vals), len(vals), total_days


def load_positives():
    d = json.load(open("kurukshetra_karnal_sunflower_weak_labels.json"))
    positives = [r for r in d["records"] if r["candidate_tier"] in ("A", "B")]
    out = []
    for r in positives:
        out.append({
            "field_id": r["field_id"], "label": 1, "label_class": r["training_label"],
            "source": "kurukshetra_karnal_weak_positive",
            "ndvi_apr": r["ndvi_apr"], "ndvi_may": r["ndvi_may"], "ndvi_june": r["ndvi_june"],
            "ndvi_apr_june_change": r["ndvi_apr_june_change"],
            "ndre_apr": r["ndre_apr"], "ndre_may": r["ndre_may"], "ndre_june": r["ndre_june"],
            "ndwi_apr": r["ndwi_apr"], "ndwi_may": r["ndwi_may"], "ndwi_june": r["ndwi_june"],
            "ndyi_apr": r["ndyi_apr"], "ndyi_may": r["ndyi_may"], "ndyi_june": r["ndyi_june"],
            "valid_pixel_fraction": r["valid_pixel_fraction"],
            "area_sqm": r["area_sqm"], "region": "Haryana (Kurukshetra-Karnal)", "season_year": 2026,
        })
    return out


def load_negatives():
    manifest = {}
    with open("../data/pilot/amed_negative_manifest.jsonl") as f:
        for line in f:
            d = json.loads(line)
            manifest[d["field_id"]] = d

    out = []
    n_missing_windows = 0
    with open("../data/pilot/amed_sentinel2_features.jsonl") as f:
        for line in f:
            feat = json.loads(line)
            fid = feat["field_id"]
            meta = manifest.get(fid)
            if not meta:
                continue
            idx = feat["indices"]
            row = {"field_id": fid, "label": 0, "label_class": "AMED_EXISTING_NEGATIVE_EUROCROPS_PILOT",
                   "source": "amed_negative_pilot", "region": meta["region"], "season_year": meta["year"]}
            any_missing = False
            for band in ["ndvi", "ndre", "ndwi", "ndyi"]:
                for wname, window in WINDOWS.items():
                    mean_val, n_valid, n_total = window_mean(idx.get(band, []), window)
                    row[f"{band}_{wname}"] = mean_val
                    if mean_val is None:
                        any_missing = True
            row["ndvi_apr_june_change"] = (row["ndvi_apr"] - row["ndvi_june"]) if (row["ndvi_apr"] is not None and row["ndvi_june"] is not None) else None
            # Coverage: mean, across the 3 windows, of (real valid-observation-days / real
            # total-observation-days in that window) -- SAME definition as the positives' coverage
            # (see build_weak_label_dataset.py). A prior version of this used a coarse "did any
            # window have >=1 valid obs" boolean-per-window average, which trivially evaluated to
            # 1.0 for every negative (since only negatives with complete Apr/May/June data reach
            # this point) while positives kept their real continuous CDSE coverage fraction --
            # a real, caught data-leakage bug (the RF was learning "which pipeline extracted this
            # row", not any vegetation signal; see the training run report for the ROC-AUC=1.0
            # result this produced and why it was discarded).
            window_fractions = []
            for wname, window in WINDOWS.items():
                daily = idx.get("ndvi", [])
                total_days = sum(1 for o in daily if in_window(o["date"], window))
                valid_days = sum(1 for o in daily if in_window(o["date"], window) and o["mean"] is not None and isinstance(o["mean"], (int, float)))
                window_fractions.append(valid_days / total_days if total_days > 0 else 0)
            row["valid_pixel_fraction"] = statistics.mean(window_fractions)
            if any_missing:
                n_missing_windows += 1
            out.append(row)
    return out, n_missing_windows


def main():
    positives = load_positives()
    negatives, n_missing = load_negatives()

    print(f"Positives (Tier A + B): {len(positives)}")
    print(f"  Tier A (SUNFLOWER_WEAK_POSITIVE_HIGH): {sum(1 for p in positives if p['label_class']=='SUNFLOWER_WEAK_POSITIVE_HIGH')}")
    print(f"  Tier B (SUNFLOWER_WEAK_POSITIVE_MEDIUM): {sum(1 for p in positives if p['label_class']=='SUNFLOWER_WEAK_POSITIVE_MEDIUM')}")
    print(f"Negatives (existing AMED pilot pool): {len(negatives)}")
    print(f"  Negatives with at least one missing April/May/June window value (real gaps in the raw daily series): {n_missing}")

    # drop rows with any missing core feature (ndvi_apr/may/june) -- can't fabricate a value
    complete_negatives = [n for n in negatives if n["ndvi_apr"] is not None and n["ndvi_may"] is not None and n["ndvi_june"] is not None]
    print(f"  Negatives with complete Apr/May/June NDVI (usable for training): {len(complete_negatives)}")

    dataset = positives + complete_negatives
    with open("kurukshetra_rf_training_dataset.json", "w") as f:
        json.dump({"n_positive": len(positives), "n_negative": len(complete_negatives), "records": dataset}, f, indent=2)

    print(f"\nFinal assembled dataset: {len(dataset)} rows ({len(positives)} positive, {len(complete_negatives)} negative)")
    print(f"Class balance: {len(positives)}/{len(dataset)} = {len(positives)/len(dataset)*100:.1f}% positive")
    print("Saved kurukshetra_rf_training_dataset.json")


if __name__ == "__main__":
    main()
