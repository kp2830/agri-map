"""Scores every extracted Hadoti AMED-null field with BOTH the frozen rule v0 and Coriander RF v0.
Writes hadoti_candidates.json (field ids + features + both verdicts). Run after extract_hadoti_more.py."""
import json, pickle
from pathlib import Path
import numpy as np
HERE = Path(__file__).resolve().parent
d = pickle.load(open(HERE / "coriander_rf_v0_model.pkl", "rb")); model, feats = d["model"], d["features"]
src = {"ndvi_dec": "dec_ndvi", "ndyi_decfeb": "yellow_ndyi", "ndvi_feb": "feb_ndvi", "ndvi_mar": "mar_ndvi"}
res = json.loads((HERE / "hadoti_rule_results.json").read_text())
rows = []
for fid, r in res.items():
    if "error" in r or any(not isinstance(r.get(src[f]), (int, float)) for f in feats): continue
    p = float(model.predict_proba(np.array([[r[src[f]] for f in feats]]))[:, 1][0])
    rows.append({"field_id": fid, "rule_pass": bool(r["passes"]), "rf_probability": round(p, 3), "rf_pass": p >= 0.5,
                 "lon": r["centroid"][0], "lat": r["centroid"][1], **{f: round(r[src[f]], 3) for f in feats}})
rows.sort(key=lambda x: -x["rf_probability"])
both = [r for r in rows if r["rule_pass"] and r["rf_pass"]]
print(f"scored {len(rows)} fields | rule pass {sum(r['rule_pass'] for r in rows)} | RF>=0.5 {sum(r['rf_pass'] for r in rows)} | BOTH {len(both)}")
json.dump({"rows": rows, "both": both}, open(HERE / "hadoti_candidates.json", "w"), indent=1)
print("field ids passing BOTH (rule v0 and RF >= 0.5):")
for r in both: print(f"  {r['field_id']}  p={r['rf_probability']}  ({r['lat']:.4f}, {r['lon']:.4f})")
