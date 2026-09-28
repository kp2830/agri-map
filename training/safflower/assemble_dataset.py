"""
Assembles the first Safflower training table:
    Latur pilot weak positives (HIGH + MEDIUM tier, n=16 -- see score_and_tier.py)
        +
    The SAME 250 real AMED-confirmed negative fields used for Sunflower
    (training/data/pilot/amed_negative_manifest.jsonl), but re-extracted on SAFFLOWER'S OWN
    real 2025-26 rabi windows (extract_negative_features.py) rather than reused from Sunflower's
    original April/May/June feature values -- see that script's docstring for why. Unlike
    Sunflower's own original negative-reuse (which had a real, stated 2021-vs-2026 season
    mismatch it had to work around), positives and negatives here are both measured on the
    exact same real calendar, so no such mismatch exists in this dataset.

Reports exact counts and any missing data honestly before training anything.

Run: ../.venv/bin/python3 assemble_dataset.py
"""
import json
import sys

sys.path.insert(0, ".")
from score_and_tier import tier  # noqa: E402

WINDOWS = ["establishment", "flowering", "harvest"]
INDICES = ["ndvi", "ndre", "ndwi", "ndyi"]


def load_positives():
    results = json.load(open("latur_pilot_results.json"))["results"]
    out = []
    for r in results:
        t, s = tier(r)
        if t not in ("HIGH", "MEDIUM"):
            continue
        row = {
            "field_id": r["field_id"],
            "label": 1,
            "label_class": f"SAFFLOWER_WEAK_POSITIVE_{t}",
            "score": s,
            "source": "latur_pilot",
            "area_sqm": r["area_sqm"],
            "region": "Maharashtra (Latur)",
            "season_year": "2025-26 rabi",
        }
        for w in WINDOWS:
            for idx in INDICES:
                row[f"{idx}_{w}"] = r["windows"][w]["means"][idx]
        out.append(row)
    return out


def load_negatives():
    path = "negative_results.json"
    try:
        results = json.load(open(path))["results"]
    except FileNotFoundError:
        print(f"WARNING: {path} not found -- run extract_negative_features.py first.")
        return []
    out = []
    for r in results:
        row = {
            "field_id": r["field_id"],
            "label": 0,
            "label_class": f"AMED_CONFIRMED_{r['crop_label']}",
            "source": "amed_confirmed_negative",
            "region": r["region"],
            "district": r["district"],
            "original_amed_season_year": f"{r['original_season']} {r['original_year']}",
            "season_year": "2025-26 rabi (re-extracted)",
        }
        for w in WINDOWS:
            for idx in INDICES:
                row[f"{idx}_{w}"] = r["windows"][w]["means"][idx]
        out.append(row)
    return out


def main():
    positives = load_positives()
    negatives = load_negatives()

    print(f"Positives (HIGH + MEDIUM): {len(positives)}")
    print(f"  HIGH:   {sum(1 for p in positives if 'HIGH' in p['label_class'])}")
    print(f"  MEDIUM: {sum(1 for p in positives if 'MEDIUM' in p['label_class'])}")
    print(f"Negatives (AMED-confirmed, re-extracted on Safflower's own windows): {len(negatives)}")

    # Honest completeness check -- never silently drop a row with missing features.
    def complete(row):
        return all(row.get(f"{idx}_{w}") is not None for w in WINDOWS for idx in INDICES)

    incomplete_pos = [p for p in positives if not complete(p)]
    incomplete_neg = [n for n in negatives if not complete(n)]
    if incomplete_pos or incomplete_neg:
        print(f"\nWARNING: {len(incomplete_pos)} positive(s) and {len(incomplete_neg)} negative(s) have a missing index value (cloud cover / no valid pixel in a window) -- excluded from the table below, not silently kept with a gap.")

    rows = [p for p in positives if complete(p)] + [n for n in negatives if complete(n)]
    print(f"\nFinal table: {len(rows)} rows ({sum(1 for r in rows if r['label']==1)} positive, {sum(1 for r in rows if r['label']==0)} negative)")

    json.dump({"rows": rows}, open("safflower_training_table.json", "w"), indent=2)
    print("Wrote safflower_training_table.json")


if __name__ == "__main__":
    main()
