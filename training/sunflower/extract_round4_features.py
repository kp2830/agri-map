"""
Real Sentinel-2 satellite feature extraction for the 250 NEW Kurukshetra/Haryana round-4
candidates (sunflower_kurukshetra_250_new_candidates.json) -- reuses cdse_client.py's
request_polygon_statistics/SPECTRAL_INDICES_EVALSCRIPT exactly (the same client already used
for rounds 1-3), the exact same fixed windows as the production model
(server/src/services/agricultural/sunflowerRf/config.ts's FEATURE_WINDOWS: April 15-30 2026,
May 1-20 2026, June 1-15 2026), and the exact same founder rule
(baseline_rule_pass = ndvi_apr > 0.50 AND ndvi_june < 0.25, per
kurukshetra_karnal_sunflower_weak_label_report.md) -- no new methodology.

Resumable/checkpointed (same discipline as extract_features.py): a field already successfully
extracted is never reprocessed; every failure is recorded with its real reason.

Throttle: 3s between the 3 per-field window requests, 6s between fields -- the exact
proven-safe rate documented in this project's own prior extraction work (a faster 1.2s/2s
throttle hit sustained CDSE 429s around field ~180; 3s/6s fully resolved it).

Prints a progress summary (fields done, running Tier A/B counts via score_and_tier.py, the
same frozen scoring logic) at least every 30s.

Run: training/.venv/bin/python3 training/sunflower/extract_round4_features.py
"""
import json
import time
from datetime import date
from pathlib import Path

from cdse_client import CdseAuthRequired, SPECTRAL_INDICES_EVALSCRIPT, request_polygon_statistics
from score_and_tier import score_field, tier_and_label

WINDOWS = {
    "april": (date(2026, 4, 15), date(2026, 4, 30)),
    "may": (date(2026, 5, 1), date(2026, 5, 20)),
    "june": (date(2026, 6, 1), date(2026, 6, 15)),
}
WINDOW_GAP_SEC = 3
FIELD_GAP_SEC = 6
PROGRESS_INTERVAL_SEC = 30

CANDIDATES_PATH = Path("sunflower_kurukshetra_250_new_candidates.json")
RESULTS_PATH = Path("haryana_round4_results.json")
MANIFEST_PATH = Path("haryana_round4_extraction_manifest.json")


def load_manifest() -> dict:
    if MANIFEST_PATH.exists():
        return json.loads(MANIFEST_PATH.read_text())
    return {"completed_field_ids": [], "failed": {}, "total_pu_spent": 0.0}


def save_manifest(m: dict) -> None:
    MANIFEST_PATH.write_text(json.dumps(m, indent=2))


def load_results() -> list[dict]:
    if RESULTS_PATH.exists():
        return json.loads(RESULTS_PATH.read_text())["results"]
    return []


def save_results(results: list[dict]) -> None:
    RESULTS_PATH.write_text(json.dumps({"results": results}, indent=2))


def extract_window(geometry: dict, start: date, end: date) -> dict:
    result = request_polygon_statistics(geometry, start, end, SPECTRAL_INDICES_EVALSCRIPT, native_resolution=True)
    means = {}
    valid_days = {}
    total_days = 0
    for index_name in ["ndvi", "ndre", "ndwi", "ndyi"]:
        vals = []
        for entry in result.response.get("data", []):
            stats = entry.get("outputs", {}).get(index_name, {}).get("bands", {}).get("B0", {}).get("stats")
            if not stats:
                continue
            if index_name == "ndvi":
                total_days += 1
            raw = stats.get("mean")
            if raw is not None and raw != "NaN":
                vals.append(float(raw))
                if index_name == "ndvi":
                    valid_days["ndvi"] = valid_days.get("ndvi", 0) + 1
        means[index_name] = sum(vals) / len(vals) if vals else None
    return {
        "means": means,
        "valid_obs_days": valid_days.get("ndvi", 0),
        "total_obs_days": total_days,
        "pu_spent": result.processing_units_spent or 0.0,
    }


def extract_one_field(feature: dict) -> dict:
    geometry = feature["geometry"]
    windows_out = {}
    total_pu = 0.0
    for i, (name, (start, end)) in enumerate(WINDOWS.items()):
        windows_out[name] = extract_window(geometry, start, end)
        total_pu += windows_out[name]["pu_spent"]
        if i < len(WINDOWS) - 1:
            time.sleep(WINDOW_GAP_SEC)

    ndvi_apr = windows_out["april"]["means"]["ndvi"]
    ndvi_may = windows_out["may"]["means"]["ndvi"]
    ndvi_june = windows_out["june"]["means"]["ndvi"]

    result = {
        "field_id": feature["id"],
        "source_cell": feature.get("sourceCellToken"),
        "area_sqm": feature["properties"]["areaSqM"],
        "class_confidence": feature["properties"]["classConfidence"],
        "geometry": geometry,
        "ndvi_apr": ndvi_apr, "ndvi_may": ndvi_may, "ndvi_june": ndvi_june,
        "ndvi_apr_minus_june": (ndvi_apr - ndvi_june) if (ndvi_apr is not None and ndvi_june is not None) else None,
        "ndvi_may_minus_apr": (ndvi_may - ndvi_apr) if (ndvi_may is not None and ndvi_apr is not None) else None,
        "ndvi_may_minus_june": (ndvi_may - ndvi_june) if (ndvi_may is not None and ndvi_june is not None) else None,
        "ndre_apr": windows_out["april"]["means"]["ndre"], "ndre_may": windows_out["may"]["means"]["ndre"], "ndre_june": windows_out["june"]["means"]["ndre"],
        "ndwi_apr": windows_out["april"]["means"]["ndwi"], "ndwi_may": windows_out["may"]["means"]["ndwi"], "ndwi_june": windows_out["june"]["means"]["ndwi"],
        "ndyi_apr": windows_out["april"]["means"]["ndyi"], "ndyi_may": windows_out["may"]["means"]["ndyi"], "ndyi_june": windows_out["june"]["means"]["ndyi"],
        "valid_obs_days": {"april": windows_out["april"]["valid_obs_days"], "may": windows_out["may"]["valid_obs_days"], "june": windows_out["june"]["valid_obs_days"]},
        "total_obs_days": {"april": windows_out["april"]["total_obs_days"], "may": windows_out["may"]["total_obs_days"], "june": windows_out["june"]["total_obs_days"]},
        "baseline_rule_pass": bool(ndvi_apr is not None and ndvi_june is not None and ndvi_apr > 0.50 and ndvi_june < 0.25),
        "real_pu_spent": total_pu,
        "status": "ok",
    }
    return result


def main() -> None:
    candidates = json.loads(CANDIDATES_PATH.read_text())
    manifest = load_manifest()
    results = load_results()
    completed = set(manifest["completed_field_ids"])
    to_process = [f for f in candidates if f["id"] not in completed]

    print(f"[round4] {len(candidates)} candidates, {len(candidates) - len(to_process)} already done (resuming), {len(to_process)} to process", flush=True)

    last_progress = time.monotonic()

    def print_progress(force=False):
        nonlocal last_progress
        now = time.monotonic()
        if not force and now - last_progress < PROGRESS_INTERVAL_SEC:
            return
        last_progress = now
        ok_results = [r for r in results if r.get("status") == "ok"]
        tier_a = tier_b = tier_c = tier_d = 0
        for r in ok_results:
            score, _ = score_field(r)
            tier, _ = tier_and_label(r, score) if score is not None else ("D", None)
            if tier == "A":
                tier_a += 1
            elif tier == "B":
                tier_b += 1
            elif tier == "C":
                tier_c += 1
            else:
                tier_d += 1
        print(f"[round4] PROGRESS: {len(results)}/{len(candidates)} fields done | Tier A: {tier_a} | Tier B: {tier_b} | Tier C: {tier_c} | Tier D: {tier_d} | PU spent: {manifest['total_pu_spent']:.2f}", flush=True)

    for idx, feature in enumerate(to_process):
        field_id = feature["id"]
        try:
            result = extract_one_field(feature)
        except CdseAuthRequired as e:
            print(f"[round4] FATAL: {e}", flush=True)
            return
        except Exception as e:
            manifest["failed"][field_id] = {"reason": f"{type(e).__name__}: {e}"}
            save_manifest(manifest)
            print(f"[round4] FAILED {field_id}: {type(e).__name__}: {e}", flush=True)
            time.sleep(FIELD_GAP_SEC)
            continue

        results.append(result)
        save_results(results)
        manifest["completed_field_ids"].append(field_id)
        manifest["total_pu_spent"] += result["real_pu_spent"]
        manifest["failed"].pop(field_id, None)
        save_manifest(manifest)

        print_progress()
        time.sleep(FIELD_GAP_SEC)

    print_progress(force=True)
    print(f"[round4] DONE. {len(results)} fields extracted, {len(manifest['failed'])} failed, {manifest['total_pu_spent']:.2f} PU spent.", flush=True)


if __name__ == "__main__":
    main()
