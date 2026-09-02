"""
Assembles the final Kurukshetra-Karnal sunflower weak-label dataset from batch 1 (30 fields,
already scored) + batch 2 (245 new fields), applies the frozen score_and_tier.py logic
uniformly to all of them, and writes the 4 deliverables:
  training/sunflower/kurukshetra_karnal_sunflower_weak_labels.{csv,json,geojson}
  training/sunflower/kurukshetra_karnal_sunflower_weak_label_report.md

Run: python3 build_weak_label_dataset.py
"""
import json
import csv
import statistics
from collections import Counter, defaultdict
from score_and_tier import score_and_tier_all

LABEL_PROVENANCE = (
    "Weak label derived from the co-founder's Google Earth field observation (Delhi->Chandigarh "
    "drive, 2026-05-09, large sunflower areas in full bloom near Kurukshetra-Karnal) and her "
    "resulting Sentinel-2 temporal hypothesis (April green -> May flowering-period green -> June "
    "harvested/brown/ploughed). NOT independently confirmed sunflower ground truth. NOT derived "
    "from or cross-checked against AMED crop labels."
)
LABEL_METHOD = "cofounder_green_to_brown_temporal_heuristic"


def centroid_and_area(geometry):
    coords = geometry["coordinates"][0][0]
    lats = [c[1] for c in coords]
    lngs = [c[0] for c in coords]
    return sum(lats) / len(lats), sum(lngs) / len(lngs)


def main():
    batch1 = json.load(open("kurukshetra_karnal_april_june_heuristic_test.json"))["results"]
    batch2_raw = json.load(open("kurukshetra_karnal_batch2_results.json"))
    batch2 = batch2_raw["results"]

    # batch1 records don't carry geometry/source_cell -- attach them from the discovery pool
    pool = {f["id"]: f for f in json.load(open("kurukshetra_karnal_alu_discovery_pass1.json"))["fields"]}
    for r in batch1:
        p = pool.get(r["field_id"])
        if p:
            r["geometry"] = p["geometry"]
            r["source_cell"] = p["sourceCellTokens"][0]

    all_raw = batch1 + batch2
    ok_raw = [r for r in all_raw if r.get("status") == "ok"]
    error_raw = [r for r in all_raw if r.get("status") != "ok"]

    scored = score_and_tier_all(ok_raw)

    total_pu = sum(r.get("real_pu_spent") or 0 for r in ok_raw)

    # ---- build final records ----
    records = []
    for r in scored:
        lat, lng = centroid_and_area(r["geometry"])
        obs = r["valid_obs_days"]
        tot = r["total_obs_days"]
        coverage = statistics.mean([obs[k] / tot[k] if tot.get(k, 0) > 0 else 0 for k in ["april", "may", "june"]])
        records.append({
            "field_id": r["field_id"],
            "polygon": r["geometry"],
            "centroid_lat": round(lat, 6),
            "centroid_lon": round(lng, 6),
            "area_sqm": r["area_sqm"],
            "source_cell": r.get("source_cell"),
            "ndvi_apr": r["ndvi_apr"], "ndvi_may": r["ndvi_may"], "ndvi_june": r["ndvi_june"],
            "ndvi_apr_june_change": r["ndvi_apr_minus_june"],
            "ndre_apr": r.get("ndre_apr"), "ndre_may": r.get("ndre_may"), "ndre_june": r.get("ndre_june"),
            "ndwi_apr": r.get("ndwi_apr"), "ndwi_may": r.get("ndwi_may"), "ndwi_june": r.get("ndwi_june"),
            "ndyi_apr": r.get("ndyi_apr"), "ndyi_may": r.get("ndyi_may"), "ndyi_june": r.get("ndyi_june"),
            "valid_pixel_fraction": round(coverage, 3),
            "baseline_rule_pass": r["baseline_rule_pass"],
            "sunflower_candidate_score": r["sunflower_candidate_score"],
            "candidate_tier": r["candidate_tier"],
            "training_label": r["training_label"],
            "label_method": LABEL_METHOD,
            "label_provenance": LABEL_PROVENANCE,
            "real_pu_spent": r.get("real_pu_spent"),
        })

    # ---- CSV (no polygon column -- too wide; centroid only) ----
    csv_fields = [k for k in records[0].keys() if k != "polygon"]
    with open("kurukshetra_karnal_sunflower_weak_labels.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=csv_fields)
        w.writeheader()
        for r in records:
            w.writerow({k: v for k, v in r.items() if k != "polygon"})

    # ---- JSON ----
    with open("kurukshetra_karnal_sunflower_weak_labels.json", "w") as f:
        json.dump({"label_method": LABEL_METHOD, "label_provenance": LABEL_PROVENANCE, "total_fields": len(records), "records": records}, f, indent=2)

    # ---- GeoJSON ----
    geojson = {
        "type": "FeatureCollection",
        "properties": {"label_method": LABEL_METHOD, "label_provenance": LABEL_PROVENANCE},
        "features": [
            {"type": "Feature", "id": r["field_id"], "geometry": r["polygon"],
             "properties": {k: v for k, v in r.items() if k != "polygon"}}
            for r in records
        ],
    }
    with open("kurukshetra_karnal_sunflower_fields.geojson", "w") as f:
        json.dump(geojson, f)

    # ---- stats for the report ----
    tier_counts = Counter(r["candidate_tier"] for r in records)
    label_counts = Counter(r["training_label"] for r in records)
    rule_pass_count = sum(1 for r in records if r["baseline_rule_pass"])

    def dist(key):
        vals = [r[key] for r in records if r[key] is not None]
        return {"min": round(min(vals), 3), "max": round(max(vals), 3), "mean": round(statistics.mean(vals), 3), "median": round(statistics.median(vals), 3)}

    per_cell = defaultdict(lambda: Counter())
    for r in records:
        per_cell[r["source_cell"]][r["candidate_tier"]] += 1

    area_dist = dist("area_sqm")
    coverage_dist = dist("valid_pixel_fraction")
    score_dist = dist("sunflower_candidate_score")

    stats = {
        "total_evaluated": len(all_raw), "total_ok": len(records), "total_errors": len(error_raw),
        "tier_counts": dict(tier_counts), "label_counts": dict(label_counts),
        "rule_pass_count": rule_pass_count, "rule_pass_pct": round(rule_pass_count / len(records) * 100, 2),
        "score_dist": score_dist, "area_dist": area_dist, "coverage_dist": coverage_dist,
        "ndvi_apr_dist": dist("ndvi_apr"), "ndvi_may_dist": dist("ndvi_may"), "ndvi_june_dist": dist("ndvi_june"),
        "ndvi_change_dist": dist("ndvi_apr_june_change"),
        "total_real_pu_spent": round(total_pu, 2),
        "cells_represented": len(per_cell),
        "candidates_per_cell": {c: dict(t) for c, t in per_cell.items()},
    }
    json.dump(stats, open("kurukshetra_karnal_weak_label_stats.json", "w"), indent=2)

    print(json.dumps(stats, indent=2))
    print(f"\nWrote {len(records)} records to CSV/JSON/GeoJSON.")


if __name__ == "__main__":
    main()
