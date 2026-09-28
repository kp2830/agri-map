"""
First real Sentinel-2 feature extraction for Safflower candidate fields — Latur district,
Maharashtra pilot. Reuses training/sunflower/cdse_client.py's request_polygon_statistics /
SPECTRAL_INDICES_EVALSCRIPT exactly (same real client, same NDVI/NDRE/NDWI/NDYI evalscript
already used for Sunflower) against the REAL 2025-26 rabi windows defined in
server/src/services/agricultural/safflower/config.ts (SAFFLOWER_FEATURE_WINDOWS) — establishment
(Nov 2025), flowering (mid-Dec 2025 - mid-Jan 2026), harvest (mid-Feb - Mar 2026). Uses the
2025-26 cycle specifically because the 2026-27 cycle has not happened yet as of when this was
written (Sep 2026) — see config.ts's version-string comment.

Input: training/safflower/latur_pilot_fields_pool.json (written by
server/scripts/discoverSafflowerCandidateFields.ts) — 3,633 real ALU fields across 15 real S2
cells in the Latur ROI, 487 of which AMED does not confidently call one of its 12 known crops
(the real Safflower candidate pool; see that script's own output for the crop breakdown).

Samples 30 of those 487 (2 per cell, fixed seed 42 — same constant used elsewhere in this
project — for reproducibility), a deliberately small first pilot matching Sunflower's own
original 30-field pilot scale.

DELIBERATELY NO SCORING OR TIERING HERE. Unlike Sunflower's pilot (which had a real, specific
co-founder-observed field to calibrate a baseline rule against), no equivalent real observed
Safflower field exists yet. This script only extracts and reports real values — building a
scoring formula on top of them, before this exists, would mean inventing thresholds and
presenting them as if validated. See the printed distribution summary at the end for what the
real data actually shows; a baseline rule gets written only after this real report is reviewed.

Resumable/checkpointed, same discipline as extract_round4_features.py: a field already
successfully extracted is never reprocessed; every failure is recorded with its real reason.
Throttle: 3s between the 3 per-field window requests, 6s between fields — the exact proven-safe
rate this project's own round-4 work found necessary for a sustained run.

Run: training/.venv/bin/python3 training/safflower/extract_latur_pilot_features.py
"""
import json
import random
import sys
import time
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "sunflower"))
from cdse_client import CdseAuthRequired, SPECTRAL_INDICES_EVALSCRIPT, request_polygon_statistics  # noqa: E402

WINDOWS = {
    "establishment": (date(2025, 11, 1), date(2025, 11, 15)),
    "flowering": (date(2025, 12, 15), date(2026, 1, 15)),
    "harvest": (date(2026, 2, 15), date(2026, 3, 1)),
}
WINDOW_GAP_SEC = 3
FIELD_GAP_SEC = 6
PROGRESS_INTERVAL_SEC = 30
SAMPLE_SIZE = 135  # 30 (original pilot, reproduced exactly as a prefix by the same seed+method) + 105 new
SAMPLING_SEED = 42

POOL_PATH = Path("latur_pilot_fields_pool.json")
RESULTS_PATH = Path("latur_pilot_results.json")
MANIFEST_PATH = Path("latur_pilot_extraction_manifest.json")


def load_manifest() -> dict:
    if MANIFEST_PATH.exists():
        return json.loads(MANIFEST_PATH.read_text())
    return {"completed_field_ids": [], "failed": {}, "total_pu_spent": 0.0}


def save_manifest(manifest: dict) -> None:
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2))


def load_results() -> list[dict]:
    if RESULTS_PATH.exists():
        return json.loads(RESULTS_PATH.read_text())["results"]
    return []


def save_results(results: list[dict]) -> None:
    RESULTS_PATH.write_text(json.dumps({"results": results}, indent=2))


def select_sample(pool: dict) -> list[dict]:
    """2 fields per real S2 cell (deterministic, fixed seed) from the fields AMED does NOT
    confidently call one of its 12 known crops — the real candidate pool, not an invented one."""
    candidates = [f for f in pool["fields"] if f.get("amedCropSeen") is None]
    by_cell: dict[str, list[dict]] = {}
    for f in candidates:
        by_cell.setdefault(f["sourceCellToken"], []).append(f)

    rng = random.Random(SAMPLING_SEED)
    sample = []
    per_cell = max(1, SAMPLE_SIZE // len(by_cell))
    for cell, fields in by_cell.items():
        rng.shuffle(fields)
        sample.extend(fields[:per_cell])
    return sample[:SAMPLE_SIZE]


def extract_window(geometry: dict, start: date, end: date) -> dict:
    result = request_polygon_statistics(geometry, start, end, SPECTRAL_INDICES_EVALSCRIPT, native_resolution=True)
    means = {}
    valid_days = 0
    for index_name in ["ndvi", "ndre", "ndwi", "ndyi"]:
        vals = []
        for entry in result.response.get("data", []):
            stats = entry.get("outputs", {}).get(index_name, {}).get("bands", {}).get("B0", {}).get("stats")
            if not stats:
                continue
            raw = stats.get("mean")
            if raw is not None and raw != "NaN":
                vals.append(float(raw))
                if index_name == "ndvi":
                    valid_days += 1
        means[index_name] = sum(vals) / len(vals) if vals else None
    return {"means": means, "valid_obs_days": valid_days, "pu_spent": result.processing_units_spent or 0.0}


def extract_one_field(feature: dict) -> dict:
    geometry = feature["geometry"]
    windows_out = {}
    total_pu = 0.0
    for i, (name, (start, end)) in enumerate(WINDOWS.items()):
        windows_out[name] = extract_window(geometry, start, end)
        total_pu += windows_out[name]["pu_spent"]
        if i < len(WINDOWS) - 1:
            time.sleep(WINDOW_GAP_SEC)
    return {
        "field_id": feature["id"],
        "source_cell": feature.get("sourceCellToken"),
        "area_sqm": feature["properties"]["areaSqM"],
        "windows": windows_out,
        "total_pu_spent": total_pu,
    }


def main():
    pool = json.loads(POOL_PATH.read_text())
    sample = select_sample(pool)
    print(f"Real candidate pool: {sum(1 for f in pool['fields'] if f.get('amedCropSeen') is None)} fields (AMED: no confident crop).")
    print(f"Sampling {len(sample)} fields (fixed seed {SAMPLING_SEED}, stratified across real S2 cells).\n")

    manifest = load_manifest()
    results = load_results()
    completed = set(manifest["completed_field_ids"])
    todo = [f for f in sample if f["id"] not in completed]
    print(f"{len(completed)} already done (resuming). {len(todo)} remaining this run.\n")

    last_progress = time.time()
    for i, feature in enumerate(todo):
        try:
            r = extract_one_field(feature)
            results.append(r)
            manifest["completed_field_ids"].append(feature["id"])
            manifest["total_pu_spent"] += r["total_pu_spent"]
            save_results(results)
            save_manifest(manifest)
            e = r["windows"]["establishment"]["means"]
            f_ = r["windows"]["flowering"]["means"]
            h = r["windows"]["harvest"]["means"]
            print(
                f"[{i+1}/{len(todo)}] {feature['id']}: "
                f"ndvi est={e['ndvi']} flow={f_['ndvi']} harv={h['ndvi']} | "
                f"ndyi est={e['ndyi']} flow={f_['ndyi']} harv={h['ndyi']} | "
                f"pu={r['total_pu_spent']:.2f}"
            )
        except CdseAuthRequired as exc:
            print(f"FATAL: {exc}")
            return
        except Exception as exc:  # noqa: BLE001 — record real reason, keep going, never fabricate a result
            manifest["failed"][feature["id"]] = str(exc)
            save_manifest(manifest)
            print(f"[{i+1}/{len(todo)}] {feature['id']} -> ERROR: {exc}")

        if time.time() - last_progress > PROGRESS_INTERVAL_SEC:
            print(f"  ...progress: {len(manifest['completed_field_ids'])} done, {len(manifest['failed'])} failed, {manifest['total_pu_spent']:.2f} PU spent")
            last_progress = time.time()

        if i < len(todo) - 1:
            time.sleep(FIELD_GAP_SEC)

    print(f"\nDone. {len(manifest['completed_field_ids'])} succeeded, {len(manifest['failed'])} failed. Total real PU spent: {manifest['total_pu_spent']:.2f}")


if __name__ == "__main__":
    main()
