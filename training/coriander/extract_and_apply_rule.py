"""
Coriander candidate pass, same discipline as training/safflower/: take real ALU fields from the
Hadoti (Baran-Kota, Rajasthan) pool where AMED has NO confident crop, pull real Sentinel-2
NDVI/NDYI for the 2025-26 rabi season (CDSE Statistical API), and apply the frozen rule v0.

RULE v0 (weak, hypothesis-derived -- NOT ground truth). Fitted on 50 real AgriFieldNet fields
(14 coriander, 36 wheat/mustard/gram; rabi 2021-22, UP/Rajasthan/Bihar/Odisha), see
training/coriander/README.md:
    yellow_ndyi  = median NDYI over Dec 15 - Feb 15   -> must be < 0.15   (white umbels, no yellow bloom)
    feb_ndvi     = median NDVI over Feb 1 - Mar 10     -> must be in [0.45, 0.75] (mid canopy, below wheat/mustard/gram peak)
Fit-set result: 11/14 coriander kept, 3/36 others wrongly kept (2 mustard, 1 wheat); optimistic
because the thresholds were chosen on this same data.

Run: training/esa/.venv/bin/python training/coriander/extract_and_apply_rule.py
"""
import json, random, sys, time
from datetime import date
from pathlib import Path
import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[0] / "sunflower"))
from cdse_client import SPECTRAL_INDICES_EVALSCRIPT, request_polygon_statistics  # noqa: E402

SEASON = (date(2025, 10, 15), date(2026, 4, 15))
PER_CELL = 4
SEED = 42
RULE = {"yellow_max": 0.15, "feb_lo": 0.45, "feb_hi": 0.75}


def win(series, a, b, ix):
    def inside(md):
        return (a <= md <= b) if a <= b else (md >= a or md <= b)
    v = [s[ix] for s in series if isinstance(s[ix], (int, float)) and inside(s["date"][5:])]
    return float(np.median(v)) if v else None


def series_for(geom):
    r = request_polygon_statistics(geom, SEASON[0], SEASON[1], SPECTRAL_INDICES_EVALSCRIPT)
    out = []
    for it in r.response.get("data", []):
        o = it["outputs"]; row = {"date": it["interval"]["from"][:10]}
        ok = True
        for k in ("ndvi", "ndyi"):
            st = o[k]["bands"]["B0"]["stats"]
            if st.get("sampleCount", 0) - st.get("noDataCount", 0) < 1 or not isinstance(st.get("mean"), (int, float)):
                ok = False; break
            row[k] = st["mean"]
        if ok: out.append(row)
    return out, r.processing_units_spent


def passes(f):
    if f["yellow_ndyi"] is None or f["feb_ndvi"] is None: return None
    return f["yellow_ndyi"] < RULE["yellow_max"] and RULE["feb_lo"] <= f["feb_ndvi"] <= RULE["feb_hi"]


if __name__ == "__main__":
    pool = json.loads((HERE / "hadoti_pool.json").read_text())
    cand = [f for f in pool["fields"] if f.get("amedCropSeen") is None]
    random.seed(SEED)
    by_cell = {}
    for f in cand: by_cell.setdefault(f["sourceCellToken"], []).append(f)
    sample = []
    for cell, fs in by_cell.items(): sample += random.sample(fs, min(PER_CELL, len(fs)))
    print(f"candidate pool {len(cand)}; sampled {len(sample)}", flush=True)
    out_path = HERE / "hadoti_rule_results.json"
    results = json.loads(out_path.read_text()) if out_path.exists() else {}
    for i, f in enumerate(sample):
        fid = f["id"]
        if fid in results: continue
        try:
            s, pu = series_for(f["geometry"])
            feats = {"yellow_ndyi": win(s, "12-15", "02-15", "ndyi"), "feb_ndvi": win(s, "02-01", "03-10", "ndvi"),
                     "dec_ndvi": win(s, "12-01", "12-31", "ndvi"), "mar_ndvi": win(s, "03-01", "03-31", "ndvi")}
            results[fid] = {**feats, "n_scenes": len(s), "pu": pu, "passes": passes(feats),
                            "centroid": f["geometry"]["coordinates"][0][0][0]}
        except Exception as e:
            results[fid] = {"error": str(e)[:120]}
        out_path.write_text(json.dumps(results))
        if i % 10 == 0: print(f"[{i+1}/{len(sample)}]", flush=True)
        time.sleep(2)
    ok = [r for r in results.values() if "error" not in r]
    print("evaluated", len(ok), "errors", len(results) - len(ok), "total PU", round(sum(r["pu"] or 0 for r in ok), 1))
    print("pass", sum(1 for r in ok if r["passes"] is True), "fail", sum(1 for r in ok if r["passes"] is False), "no-data", sum(1 for r in ok if r["passes"] is None))
