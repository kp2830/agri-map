"""
Resumable, quota-aware Sentinel-2 feature extraction for EuroCrops Sunflower fields — real
Statistical API calls only, real PU cost tracked from the API's own response header (never
estimated or fabricated), checkpointed so a field already successfully extracted is never
reprocessed, and every failure is recorded with its real reason rather than silently retried
forever or silently dropped.

Same script serves both today's small benchmark (pass --limit / --field-ids) and the eventual
full 4,893-field run (no flags) — nothing about the resumability/provenance/PU-tracking design
changes between the two; only how many fields are selected does.

Run examples:
  training/.venv/bin/python3 training/sunflower/extract_features.py --limit 15 --stratified
  training/.venv/bin/python3 training/sunflower/extract_features.py   # full dataset (do not run yet)
"""

from __future__ import annotations

import argparse
import json
import re
import time
from datetime import date, datetime, timezone
from pathlib import Path

from cdse_client import CdseAuthRequired, SPECTRAL_INDICES_EVALSCRIPT, request_polygon_statistics

REPO_ROOT = Path(__file__).resolve().parents[2]
POSITIVES_PATH = REPO_ROOT / "training" / "data" / "sunflower-positives-eurocrops-slovakia.jsonl"
OUTPUT_DIR = REPO_ROOT / "training" / "data" / "sentinel2_features"
MANIFEST_PATH = OUTPUT_DIR / "extraction_manifest.json"

SEASON_START = date(2021, 4, 1)
SEASON_END = date(2021, 9, 30)
FEATURE_SCHEMA_VERSION = "sentinel2-native-res-v1"


def load_manifest() -> dict:
    """The resumability ledger: which field_ids are done/failed, and the real, running total of
    PU actually spent by this extraction (summed from real per-request headers, never
    estimated). A fresh manifest is created only if none exists — an existing one is always
    resumed from, never overwritten."""
    if MANIFEST_PATH.exists():
        return json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    return {"completed_field_ids": [], "failed": {}, "total_pu_spent": 0.0, "started_at": datetime.now(timezone.utc).isoformat()}


def save_manifest(manifest: dict) -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2), encoding="utf-8")


def load_all_positives() -> list[dict]:
    if not POSITIVES_PATH.exists():
        raise FileNotFoundError(f"{POSITIVES_PATH} missing — run ingest_eurocrops.py first")
    return [json.loads(line) for line in POSITIVES_PATH.read_text(encoding="utf-8").splitlines() if line.strip()]


def field_area_ha(row: dict) -> float | None:
    match = re.search(r"area_ha=([\d.]+)", row.get("label_quality", ""))
    return float(match.group(1)) if match else None


def select_stratified_sample(rows: list[dict], n: int) -> list[dict]:
    """Real field-size-stratified sampling — not a first-N or arbitrary subset. This project's
    own real EuroCrops data spans 0.02ha to 222.82ha (median 6.38ha, mean 15.02ha skewed by
    large parcels); since Statistical API PU cost scales with polygon area, a sample clustered
    at one end of that range would give a biased, unusable cost estimate. This sorts by real
    area and takes evenly-spaced percentile points so small, medium, and large real fields are
    all represented."""
    with_area = [(r, field_area_ha(r)) for r in rows]
    with_area = [(r, a) for r, a in with_area if a is not None]
    with_area.sort(key=lambda x: x[1])
    if len(with_area) <= n:
        return [r for r, _ in with_area]
    step = len(with_area) / n
    return [with_area[int(i * step)][0] for i in range(n)]


def extract_daily_series(stats_response: dict, output_id: str) -> list[dict]:
    """See smoke_test_sentinel2.py's identical function for the full explanation of the real
    "NaN"-string API quirk this normalizes."""
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


def extract_one_field(row: dict) -> dict:
    """Real, single-field extraction — raises on real errors (auth, network, API) rather than
    returning a partial/fake result; the caller decides how to record the failure."""
    result = request_polygon_statistics(row["polygon"], SEASON_START, SEASON_END, SPECTRAL_INDICES_EVALSCRIPT, native_resolution=True)

    indices = {}
    for index_name in ["ndvi", "ndre", "ndwi", "ndyi"]:
        series = extract_daily_series(result.response, index_name)
        accepted = [o for o in series if o["mean"] is not None]
        indices[index_name] = accepted

    return {
        "field_id": row["field_id"],
        "label_source": row["label_source"],
        "country": row["country"],
        "crop_label": row["crop_label"],
        "area_ha": field_area_ha(row),
        "season_start": SEASON_START.isoformat(),
        "season_end": SEASON_END.isoformat(),
        "feature_schema_version": FEATURE_SCHEMA_VERSION,
        "extracted_at_utc": datetime.now(timezone.utc).isoformat(),
        "real_pu_spent": result.processing_units_spent,
        "indices": indices,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=None, help="process at most this many fields (for benchmarking)")
    parser.add_argument("--stratified", action="store_true", help="select the --limit sample stratified by real field area rather than in file order")
    parser.add_argument("--max-pu-budget", type=float, default=None, help="stop before spending more than this many real PU in this run")
    args = parser.parse_args()

    all_rows = load_all_positives()
    if args.limit:
        sample = select_stratified_sample(all_rows, args.limit) if args.stratified else all_rows[: args.limit]
    else:
        sample = all_rows

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    manifest = load_manifest()
    completed = set(manifest["completed_field_ids"])
    to_process = [r for r in sample if r["field_id"] not in completed]

    print(f"[extract] {len(sample)} fields selected, {len(sample) - len(to_process)} already completed (resuming), {len(to_process)} to process")
    print(f"[extract] PU already spent by this extraction (all prior runs): {manifest['total_pu_spent']:.3f}")

    for row in to_process:
        field_id = row["field_id"]

        if args.max_pu_budget is not None and manifest["total_pu_spent"] >= args.max_pu_budget:
            print(f"[extract] STOPPING: real PU budget ({args.max_pu_budget}) reached — {manifest['total_pu_spent']:.3f} spent so far. Resumable — re-run to continue.")
            break

        started = time.monotonic()
        try:
            result = extract_one_field(row)
        except CdseAuthRequired as e:
            print(f"[extract] FATAL: {e}")
            return
        except Exception as e:  # real network/API errors — recorded, never silently retried forever
            elapsed = time.monotonic() - started
            manifest["failed"][field_id] = {"reason": f"{type(e).__name__}: {e}", "at_utc": datetime.now(timezone.utc).isoformat()}
            save_manifest(manifest)
            print(f"[extract] FAILED {field_id} after {elapsed:.1f}s: {type(e).__name__}: {e}")
            continue

        elapsed = time.monotonic() - started
        pu = result["real_pu_spent"] or 0.0
        n_obs = sum(len(v) for v in result["indices"].values())

        out_path = OUTPUT_DIR / f"{field_id.replace('/', '_')}.json"
        out_path.write_text(json.dumps(result, indent=2), encoding="utf-8")

        manifest["completed_field_ids"].append(field_id)
        manifest["total_pu_spent"] = manifest["total_pu_spent"] + pu
        manifest["failed"].pop(field_id, None)
        save_manifest(manifest)

        print(f"[extract] OK {field_id} ({result['area_ha']}ha) — {n_obs} real observations, {pu:.3f} real PU, {elapsed:.1f}s")

    total_pu = manifest["total_pu_spent"]
    n_done = len(manifest["completed_field_ids"])
    n_failed = len(manifest["failed"])
    print(f"\n[extract] run summary: {n_done} fields completed total, {n_failed} failed, {total_pu:.3f} real PU spent total")
    if n_done > 0:
        print(f"[extract] average real PU per completed field: {total_pu / n_done:.4f}")


if __name__ == "__main__":
    main()
