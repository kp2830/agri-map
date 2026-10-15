"""Hadoti extraction for training/scoring: (1) 30 AMED-confirmed wheat/mustard/gram negatives with the
4 model features; (2) extend the AMED-null candidate sample to ~13 fields per cell (resumable)."""
import json, random, time
import extract_and_apply_rule as ex
from extract_and_apply_rule import series_for, win, passes, HERE

def feats(s):
    return {"yellow_ndyi": win(s, "12-15", "02-15", "ndyi"), "feb_ndvi": win(s, "02-01", "03-10", "ndvi"),
            "dec_ndvi": win(s, "12-01", "12-31", "ndvi"), "mar_ndvi": win(s, "03-01", "03-31", "ndvi")}

pool = json.loads((HERE / "hadoti_pool.json").read_text())
# (1) negatives
neg_path = HERE / "hadoti_amed_negatives.json"
neg = json.loads(neg_path.read_text()) if neg_path.exists() else {}
random.seed(7)
for crop in ("WHEAT", "MUSTARD", "GRAM"):
    fs = [f for f in pool["fields"] if f.get("amedCropSeen") == crop]
    for f in random.sample(fs, 10):
        if f["id"] in neg: continue
        try:
            s, pu = series_for(f["geometry"]); neg[f["id"]] = {"crop": crop, **feats(s), "pu": pu}
        except Exception as e: neg[f["id"]] = {"crop": crop, "error": str(e)[:100]}
        neg_path.write_text(json.dumps(neg)); time.sleep(2)
print("negatives done", len(neg), flush=True)
# (2) extend candidate sample
ex.PER_CELL = 13
cand = [f for f in pool["fields"] if f.get("amedCropSeen") is None]
random.seed(ex.SEED); by = {}
for f in cand: by.setdefault(f["sourceCellToken"], []).append(f)
sample = []
for cell, fs in by.items(): sample += random.sample(fs, min(13, len(fs)))
out_path = HERE / "hadoti_rule_results.json"
res = json.loads(out_path.read_text())
todo = [f for f in sample if f["id"] not in res]
print("candidate sample", len(sample), "to do", len(todo), flush=True)
for i, f in enumerate(todo):
    try:
        s, pu = series_for(f["geometry"]); ft = feats(s)
        res[f["id"]] = {**ft, "n_scenes": len(s), "pu": pu, "passes": passes(ft), "centroid": f["geometry"]["coordinates"][0][0][0]}
    except Exception as e: res[f["id"]] = {"error": str(e)[:120]}
    out_path.write_text(json.dumps(res))
    if i % 20 == 0: print(f"[{i+1}/{len(todo)}]", flush=True)
    time.sleep(2)
print("EXTRACT DONE", flush=True)
