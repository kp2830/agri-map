"""Same-year, same-region false-positive check for rule v0: AMED-labelled wheat/mustard/gram fields in the Hadoti pool."""
import json, random, time
from extract_and_apply_rule import series_for, win, passes, HERE
pool = json.loads((HERE / "hadoti_pool.json").read_text())
random.seed(7); out = {}
for crop in ("WHEAT", "MUSTARD", "GRAM"):
    fs = [f for f in pool["fields"] if f.get("amedCropSeen") == crop]
    for f in random.sample(fs, 10):
        s, pu = series_for(f["geometry"])
        feats = {"yellow_ndyi": win(s, "12-15", "02-15", "ndyi"), "feb_ndvi": win(s, "02-01", "03-10", "ndvi")}
        out.setdefault(crop, []).append({**feats, "passes": passes(feats)}); time.sleep(2)
for crop, rs in out.items():
    print(crop, "passes", sum(r["passes"] is True for r in rs), "of", len(rs), "no-data", sum(r["passes"] is None for r in rs))
json.dump(out, open(HERE / "hadoti_fp_check.json", "w"))
