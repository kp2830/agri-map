"""
Zero-cost: construct the representative 100-field evaluation set from the real 250-field AMED
pool (training/data/pilot/amed_negative_manifest.jsonl), stratified by crop class and AMED
confidence. Deterministic, non-cherry-picked rule: per crop class, sort all real fields by
amed_confidence ascending and take an evenly-spaced (linspace) subset -- this guarantees each
crop's selected fields span its full real confidence range (low to high) without hand-picking
any individual field, and is frozen BEFORE any WorldCereal job is run against these fields.

Run: python3 experiments/select_100_fields.py
"""
import json

TARGET_PER_CROP = {
    "SUGARCANE": 21, "SORGHUM": 18, "RICE": 17, "COTTON": 15, "CORN": 9,
    "GROUNDNUT": 7, "SOYBEANS": 5, "GRAM": 3, "CHILLI": 2,
    "MUSTARD": 1, "WHEAT": 1, "BAJRA": 1,
}

with open("experiments/amed_pool_with_centroids.json") as f:
    pool = json.load(f)

by_crop = {}
for f in pool:
    by_crop.setdefault(f["crop_label"], []).append(f)

selected = []
for crop, n_target in TARGET_PER_CROP.items():
    fields = sorted(by_crop[crop], key=lambda x: (x["amed_confidence"], x["field_id"]))
    n_avail = len(fields)
    if n_target >= n_avail:
        idxs = list(range(n_avail))
    else:
        idxs = sorted({round(i * (n_avail - 1) / (n_target - 1)) for i in range(n_target)})
        # dedup can shrink the set by 1-2; fill by adding nearest unused indices
        i = 0
        all_idxs = set(idxs)
        while len(all_idxs) < n_target:
            candidate = idxs[i % len(idxs)] + 1
            while candidate in all_idxs and candidate < n_avail:
                candidate += 1
            if candidate < n_avail:
                all_idxs.add(candidate)
            i += 1
        idxs = sorted(all_idxs)
    for i in idxs:
        f = fields[i]
        selected.append({
            "field_id": f["field_id"], "region": f["region"], "district": f["district"],
            "crop_label": f["crop_label"], "amed_confidence": f["amed_confidence"],
            "season": f["season"], "year": f["year"], "lat": f["lat"], "lng": f["lng"],
        })

print(f"Selected {len(selected)} fields across {len(TARGET_PER_CROP)} crop classes")
by_crop_count = {}
for s in selected:
    by_crop_count[s["crop_label"]] = by_crop_count.get(s["crop_label"], 0) + 1
for crop, n in sorted(by_crop_count.items(), key=lambda x: -x[1]):
    confs = sorted(s["amed_confidence"] for s in selected if s["crop_label"] == crop)
    print(f"  {crop:12s} n={n:3d}  conf range {confs[0]:.3f}-{confs[-1]:.3f}")

region_count = {}
for s in selected:
    region_count[s["region"]] = region_count.get(s["region"], 0) + 1
print("Region distribution:", region_count)

conf_buckets = {"<0.30": 0, "0.30-0.49": 0, "0.50-0.69": 0, "0.70-0.84": 0, ">=0.85": 0}
for s in selected:
    c = s["amed_confidence"]
    if c < 0.3: conf_buckets["<0.30"] += 1
    elif c < 0.5: conf_buckets["0.30-0.49"] += 1
    elif c < 0.7: conf_buckets["0.50-0.69"] += 1
    elif c < 0.85: conf_buckets["0.70-0.84"] += 1
    else: conf_buckets[">=0.85"] += 1
print("Confidence bucket distribution:", conf_buckets)

with open("experiments/selected_100_fields.json", "w") as f:
    json.dump(selected, f, indent=2)
print(f"\nSaved experiments/selected_100_fields.json -- {len(selected)} fields, frozen before any WorldCereal run.")
