"""
Sentinel-2 extraction for the 100-positive / 250-negative pilot. Uses the EXACT SAME
request_polygon_statistics() call (same evalscript, same native-resolution optimization, same
"NaN"-string parsing) for both EuroCrops positives and AMED negatives — this is enforced by
routing both through the same extract_one() function, not two similar-but-separate code paths.

Resumable via a shared manifest; hard-stops at PILOT_PU_BUDGET (2,500 PU) regardless of which
dataset is being processed, since the budget is shared across the whole pilot, not per-dataset.

Run: training/.venv/bin/python3 training/sunflower/pilot_extract.py
"""

from __future__ import annotations

import json
import time
from datetime import date, datetime, timezone
from pathlib import Path

from cdse_client import CdseAuthRequired, SPECTRAL_INDICES_EVALSCRIPT, request_polygon_statistics

REPO_ROOT = Path(__file__).resolve().parents[2]
PILOT_DIR = REPO_ROOT / "training" / "data" / "pilot"
MANIFEST_PATH = PILOT_DIR / "extraction_manifest.json"

SEASON_START = date(2021, 4, 1)  # unchanged from the earlier 15-field benchmark — same window for both datasets
SEASON_END = date(2021, 9, 30)
PILOT_PU_BUDGET = 2500.0
PU_WARN_THRESHOLD = 2000.0
FEATURE_SCHEMA_VERSION = "sentinel2-native-res-v1"
MAX_RETRIES = 2  # bounded retry for transient errors (timeouts) — never unbounded


def load_manifest() -> dict:
    if MANIFEST_PATH.exists():
        return json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    return {"completed_field_ids": [], "failed": {}, "total_pu_spent": 0.0, "started_at_utc": datetime.now(timezone.utc).isoformat()}


def save_manifest(m: dict) -> None:
    MANIFEST_PATH.write_text(json.dumps(m, indent=2), encoding="utf-8")


def extract_daily_series(stats_response: dict, output_id: str) -> list[dict]:
    """Identical parsing logic used in extract_features.py/smoke_test_sentinel2.py — the real
    "NaN"-string quirk normalized to None, sampleCount/noDataCount kept as informational
    quality metadata, not the primary validity signal (see those files for the full
    explanation, verified against the live API)."""
    series = []
    for entry in stats_response.get("data", []):
        stats = entry.get("outputs", {}).get(output_id, {}).get("bands", {}).get("B0", {}).get("stats")
        if not stats:
            continue
        raw_mean = stats.get("mean")
        mean = None if raw_mean == "NaN" or raw_mean is None else float(raw_mean)
        series.append(
            {
                "date": entry["interval"]["from"],
                "mean": mean,
                "sample_count": stats.get("sampleCount"),
                "no_data_count": stats.get("noDataCount", 0),
            }
        )
    return series


def extract_one(field_id: str, polygon: dict, source: str, country: str, crop_label: str) -> dict:
    """The single, shared extraction path for BOTH positives and negatives — identical
    evalscript, resolution, date range, and parsing regardless of which manifest called it, per
    the explicit requirement that the two feature-extraction paths must not diverge."""
    result = request_polygon_statistics(polygon, SEASON_START, SEASON_END, SPECTRAL_INDICES_EVALSCRIPT, native_resolution=True)

    indices = {}
    rejected_count = 0
    for index_name in ["ndvi", "ndre", "ndwi", "ndyi"]:
        series = extract_daily_series(result.response, index_name)
        accepted = [o for o in series if o["mean"] is not None]
        rejected_count += len(series) - len(accepted)
        indices[index_name] = accepted

    return {
        "field_id": field_id,
        "source": source,
        "country": country,
        "crop_label": crop_label,
        "season_start": SEASON_START.isoformat(),
        "season_end": SEASON_END.isoformat(),
        "feature_schema_version": FEATURE_SCHEMA_VERSION,
        "extracted_at_utc": datetime.now(timezone.utc).isoformat(),
        "real_pu_spent": result.processing_units_spent,
        "rejected_observations": rejected_count,
        "indices": indices,
    }


def process_manifest(manifest_path: Path, output_path: Path, run_manifest: dict) -> bool:
    """Returns False if the pilot budget was hit and processing should stop entirely."""
    rows = [json.loads(l) for l in manifest_path.read_text(encoding="utf-8").splitlines() if l.strip()]
    completed = set(run_manifest["completed_field_ids"])
    to_process = [r for r in rows if r["field_id"] not in completed]
    print(f"[pilot_extract] {manifest_path.name}: {len(rows)} total, {len(rows) - len(to_process)} already done, {len(to_process)} to process")

    results = []
    if output_path.exists():
        results = [json.loads(l) for l in output_path.read_text(encoding="utf-8").splitlines() if l.strip()]

    for row in to_process:
        if run_manifest["total_pu_spent"] >= PILOT_PU_BUDGET:
            print(f"[pilot_extract] STOPPING: pilot PU budget ({PILOT_PU_BUDGET}) reached — {run_manifest['total_pu_spent']:.2f} spent.")
            return False
        if run_manifest["total_pu_spent"] >= PU_WARN_THRESHOLD and "warned" not in run_manifest:
            print(f"[pilot_extract] WARNING: approaching budget — {run_manifest['total_pu_spent']:.2f} / {PILOT_PU_BUDGET} PU spent.")
            run_manifest["warned"] = True

        field_id = row["field_id"]
        attempt = 0
        while True:
            attempt += 1
            started = time.monotonic()
            try:
                result = extract_one(field_id, row["polygon"], row["source"], row["country"], row["crop_label"])
                break
            except CdseAuthRequired as e:
                print(f"[pilot_extract] FATAL: {e}")
                save_manifest(run_manifest)
                return False
            except Exception as e:
                if attempt <= MAX_RETRIES:
                    print(f"[pilot_extract] transient error on {field_id} (attempt {attempt}/{MAX_RETRIES}): {type(e).__name__}: {e} — retrying")
                    time.sleep(2)
                    continue
                elapsed = time.monotonic() - started
                run_manifest["failed"][field_id] = {"reason": f"{type(e).__name__}: {e}", "attempts": attempt, "at_utc": datetime.now(timezone.utc).isoformat()}
                save_manifest(run_manifest)
                print(f"[pilot_extract] FAILED {field_id} after {attempt} attempts, {elapsed:.1f}s: {type(e).__name__}: {e}")
                result = None
                break

        if result is None:
            continue

        elapsed = time.monotonic() - started
        pu = result["real_pu_spent"] or 0.0
        n_obs = sum(len(v) for v in result["indices"].values())
        results.append(result)
        output_path.write_text("\n".join(json.dumps(r) for r in results) + "\n", encoding="utf-8")

        run_manifest["completed_field_ids"].append(field_id)
        run_manifest["total_pu_spent"] += pu
        run_manifest["failed"].pop(field_id, None)
        save_manifest(run_manifest)

        print(f"[pilot_extract] OK {field_id} ({row['country']}, {row['crop_label']}) — {n_obs} obs, {result['rejected_observations']} rejected, {pu:.3f} PU, {elapsed:.1f}s, cum={run_manifest['total_pu_spent']:.1f}")

    return True


def main() -> None:
    PILOT_DIR.mkdir(parents=True, exist_ok=True)
    run_manifest = load_manifest()
    print(f"[pilot_extract] resuming: {len(run_manifest['completed_field_ids'])} already completed, {run_manifest['total_pu_spent']:.2f} PU already spent")

    pos_manifest = PILOT_DIR / "eurocrops_100_manifest.jsonl"
    pos_output = PILOT_DIR / "eurocrops_sentinel2_features.jsonl"
    neg_manifest = PILOT_DIR / "amed_negative_manifest.jsonl"
    neg_output = PILOT_DIR / "amed_sentinel2_features.jsonl"

    ok = process_manifest(pos_manifest, pos_output, run_manifest)
    if ok:
        ok = process_manifest(neg_manifest, neg_output, run_manifest)

    print(f"\n[pilot_extract] FINAL: {len(run_manifest['completed_field_ids'])} completed, {len(run_manifest['failed'])} failed, {run_manifest['total_pu_spent']:.2f} real PU spent")
    if not ok:
        print("[pilot_extract] Did not complete — budget limit or fatal error. Re-run to resume.")


if __name__ == "__main__":
    main()
