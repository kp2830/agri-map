"""
Real Sentinel-2 feature extraction, on Safflower's own windows, for the SAME 250 real
AMED-confirmed negative fields used in the Sunflower project
(training/data/pilot/amed_negative_manifest.jsonl) — real Indian fields AMED itself confidently
labels as one of its 12 known crops (Sugarcane, Sorghum, Rice, Cotton, Corn, Groundnut,
Soybeans, Gram, Chilli, Mustard, Wheat, Bajra), spanning Karnataka/Andhra Pradesh/
Maharashtra/Telangana — the same broader Deccan region as the Latur positives.

WHY RE-EXTRACT RATHER THAN REUSE THEIR EXISTING FEATURE VALUES: that manifest's fields were
originally labeled across many different real seasons/years (kharif and rabi, 2020-2026) for
Sunflower's own April/May/June windows. Reusing those old feature values as-is would compare our
Safflower positives (real Nov 2025-Mar 2026 values) against negatives measured on a DIFFERENT
real calendar -- the model would partly just learn "which time-of-year window was this measured
in" rather than "safflower vs not". Instead: same real field locations and real crop_label
ground truth (AMED already confirmed these), fresh real Sentinel-2 values pulled on the EXACT
SAME 2025-26 rabi windows as the positives (server/.../safflower/config.ts's
SAFFLOWER_FEATURE_WINDOWS) -- this is the honest way to compare like with like. A field labeled
Cotton in kharif 2025 may simply be bare/fallow in our Nov-Mar window; that is itself real,
useful negative-class information (what does "not safflower" actually look like on safflower's
own calendar), not a flaw.

Reuses cdse_client.py exactly, same throttle discipline, same resumable manifest pattern as
extract_latur_pilot_features.py.

Run: training/.venv/bin/python3 training/safflower/extract_negative_features.py
"""
import json
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

NEGATIVES_PATH = Path(__file__).resolve().parents[1] / "data" / "pilot" / "amed_negative_manifest.jsonl"
RESULTS_PATH = Path("negative_results.json")
MANIFEST_PATH = Path("negative_extraction_manifest.json")


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


def extract_one_field(row: dict) -> dict:
    geometry = row["polygon"]
    windows_out = {}
    total_pu = 0.0
    for i, (name, (start, end)) in enumerate(WINDOWS.items()):
        windows_out[name] = extract_window(geometry, start, end)
        total_pu += windows_out[name]["pu_spent"]
        if i < len(WINDOWS) - 1:
            time.sleep(WINDOW_GAP_SEC)
    return {
        "field_id": row["field_id"],
        "region": row["region"],
        "district": row["district"],
        "crop_label": row["crop_label"],
        "original_season": row["season"],
        "original_year": row["year"],
        "windows": windows_out,
        "total_pu_spent": total_pu,
    }


def main():
    rows = [json.loads(l) for l in open(NEGATIVES_PATH)]
    print(f"Real negative pool: {len(rows)} fields (AMED-confirmed, {', '.join(sorted({r['crop_label'] for r in rows}))}).\n")

    manifest = load_manifest()
    results = load_results()
    completed = set(manifest["completed_field_ids"])
    todo = [r for r in rows if r["field_id"] not in completed]
    print(f"{len(completed)} already done (resuming). {len(todo)} remaining this run.\n")

    last_progress = time.time()
    for i, row in enumerate(todo):
        try:
            r = extract_one_field(row)
            results.append(r)
            manifest["completed_field_ids"].append(row["field_id"])
            manifest["total_pu_spent"] += r["total_pu_spent"]
            save_results(results)
            save_manifest(manifest)
            e = r["windows"]["establishment"]["means"]
            f_ = r["windows"]["flowering"]["means"]
            h = r["windows"]["harvest"]["means"]
            print(
                f"[{i+1}/{len(todo)}] {row['field_id']} ({row['crop_label']}, {row['district']}): "
                f"ndvi {e['ndvi']}->{f_['ndvi']}->{h['ndvi']} | ndyi {e['ndyi']}->{f_['ndyi']}->{h['ndyi']} | "
                f"pu={r['total_pu_spent']:.2f}"
            )
        except CdseAuthRequired as exc:
            print(f"FATAL: {exc}")
            return
        except Exception as exc:  # noqa: BLE001
            manifest["failed"][row["field_id"]] = str(exc)
            save_manifest(manifest)
            print(f"[{i+1}/{len(todo)}] {row['field_id']} -> ERROR: {exc}")

        if time.time() - last_progress > PROGRESS_INTERVAL_SEC:
            print(f"  ...progress: {len(manifest['completed_field_ids'])} done, {len(manifest['failed'])} failed, {manifest['total_pu_spent']:.2f} PU spent")
            last_progress = time.time()

        if i < len(todo) - 1:
            time.sleep(FIELD_GAP_SEC)

    print(f"\nDone. {len(manifest['completed_field_ids'])} succeeded, {len(manifest['failed'])} failed. Total real PU spent: {manifest['total_pu_spent']:.2f}")


if __name__ == "__main__":
    main()
