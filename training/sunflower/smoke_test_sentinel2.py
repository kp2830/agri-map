"""
End-to-end smoke test: real Sentinel-2 observations for a small sample (5-10) of the actual
4,893 real EuroCrops Sunflower polygons, before scaling to the full dataset. Per the explicit
instruction this responds to: if credentials are missing, this FAILS EXPLICITLY with a clear
message — it never falls back to a mock/placeholder response, and it never proceeds partway
while pretending success.

Run: training/.venv/bin/python3 training/sunflower/smoke_test_sentinel2.py
"""

from __future__ import annotations

import json
import sys
from datetime import date
from pathlib import Path

from cdse_client import CdseAuthRequired, SPECTRAL_INDICES_EVALSCRIPT, request_polygon_statistics

REPO_ROOT = Path(__file__).resolve().parents[2]
POSITIVES_PATH = REPO_ROOT / "training" / "data" / "sunflower-positives-eurocrops-slovakia.jsonl"
OUTPUT_PATH = REPO_ROOT / "training" / "data" / "smoke_test_sentinel2_features.jsonl"

SAMPLE_SIZE = 8
# Slovak sunflower's real agronomic growing window (public agronomic fact, used only to bound
# the search — not a per-field claim): sown ~April-May, harvested ~September. EuroCrops
# provides only the calendar year (2021), not real per-field sowing/harvest dates — see the
# pre-bloom section of the final report for why bloom-relative windows aren't possible yet.
SEASON_START = date(2021, 4, 1)
SEASON_END = date(2021, 9, 30)

# Real, documented sanity thresholds — rejecting observations that can't be trusted rather than
# silently keeping or replacing them.
MIN_VALID_PIXEL_FRACTION = 0.2  # at least 20% of the polygon's pixels must be cloud-free
MAX_PLAUSIBLE_INDEX = 1.05  # NDVI/NDRE/NDWI/NDYI are mathematically bounded to [-1, 1]; a
MIN_PLAUSIBLE_INDEX = -1.05  # small margin allows for float rounding, nothing more


def load_sample_polygons(n: int) -> list[dict]:
    if not POSITIVES_PATH.exists():
        print(f"[smoke_test] FAIL: {POSITIVES_PATH} does not exist — run ingest_eurocrops.py first.")
        sys.exit(1)

    rows = [json.loads(line) for line in POSITIVES_PATH.read_text(encoding="utf-8").splitlines() if line.strip()]
    if len(rows) < n:
        print(f"[smoke_test] FAIL: only {len(rows)} real positive rows available, need {n}.")
        sys.exit(1)

    # Spread the sample across the file rather than taking the first N (which cluster
    # geographically, since EuroCrops rows are written in the shapefile's original spatial
    # order) — a stride gives a more representative sample of real fields.
    stride = max(1, len(rows) // n)
    return rows[::stride][:n]


def extract_daily_series(stats_response: dict, output_id: str) -> list[dict]:
    """Parses the real Sentinel Hub Statistical API response shape for one output band —
    documented structure: data[].interval.from + data[].outputs[output_id].bands.B0.stats.
    Returns only entries that actually have a real (non-null) mean; never fills a missing day
    with a guessed value.

    Real, verified response quirk (discovered running this against the live API): the
    Statistical API returns the JSON STRING "NaN" (not a JSON null, not a numeric NaN) for
    min/max/mean/stDev whenever every sample in the aggregation region was masked out (by our
    evalscript's dataMask, i.e. fully cloud-covered for that day) — converted to Python `None`
    here, once, so every downstream consumer sees a single consistent "no real value" signal
    rather than needing to know about this API-specific string encoding.

    `sampleCount`/`noDataCount` are NOT "valid vs cloud-masked" as originally assumed — they
    reflect the fixed statistical sampling grid (always 65536 = 256x256 samples per request)
    versus samples the dataMask excluded. A day can have a large noDataCount (partial cloud)
    and STILL yield a real mean (computed from the remaining unmasked samples) — verified
    directly: 2021-06-21 had noDataCount=17303 yet a real NDVI mean of 0.636. So `mean` being
    real-or-NaN is the authoritative per-day validity signal; noDataCount/sampleCount is kept
    as an informational "how much of the sampling grid was cloud-affected" quality metric, not
    the primary rejection rule."""
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
                "min": None if stats.get("min") == "NaN" else stats.get("min"),
                "max": None if stats.get("max") == "NaN" else stats.get("max"),
                "stDev": None if stats.get("stDev") == "NaN" else stats.get("stDev"),
                "sample_count": stats.get("sampleCount"),
                "no_data_count": stats.get("noDataCount", 0),
            }
        )
    return series


def sanity_check(observation: dict) -> tuple[bool, str]:
    """Real rejection rules — returns (is_valid, reason). Never silently accepted with a
    fabricated substitute value. See extract_daily_series() for why `mean is None` (the API's
    "NaN" response, already normalized) is the primary cloud/no-data rejection signal, not the
    sampleCount/noDataCount ratio."""
    mean = observation["mean"]
    if mean is None:
        return False, "no_valid_data (fully cloud-masked for this day)"
    if not (MIN_PLAUSIBLE_INDEX <= mean <= MAX_PLAUSIBLE_INDEX):
        return False, f"implausible_index_value ({mean})"

    sample_count = observation["sample_count"] or 0
    no_data_count = observation["no_data_count"] or 0
    total = sample_count + no_data_count
    if total == 0:
        return False, "empty_geometry_or_no_pixels"
    cloud_affected_fraction = no_data_count / total
    if cloud_affected_fraction > (1 - MIN_VALID_PIXEL_FRACTION):
        return False, f"too_much_of_grid_cloud_affected ({cloud_affected_fraction:.1%})"
    return True, "ok"


def main() -> None:
    print(f"[smoke_test] loading {SAMPLE_SIZE} real EuroCrops Sunflower polygons...")
    sample = load_sample_polygons(SAMPLE_SIZE)
    print(f"[smoke_test] sample field_ids: {[row['field_id'] for row in sample]}")

    results = []
    auth_failed = False

    for row in sample:
        field_id = row["field_id"]
        polygon = row["polygon"]
        print(f"\n[smoke_test] field {field_id} — querying real Sentinel-2 statistics ({SEASON_START} to {SEASON_END})...")

        try:
            result = request_polygon_statistics(polygon, SEASON_START, SEASON_END, SPECTRAL_INDICES_EVALSCRIPT)
            response = result.response
            print(f"[smoke_test]   real PU spent on this request: {result.processing_units_spent}")
        except CdseAuthRequired as e:
            print(f"[smoke_test] FAIL (explicit, not a fallback): {e}")
            auth_failed = True
            break
        except Exception as e:  # real network/API errors — reported, never swallowed
            print(f"[smoke_test] FAIL for {field_id}: real API error — {type(e).__name__}: {e}")
            continue

        field_result = {"field_id": field_id, "observations": []}
        for index_name in ["ndvi", "ndre", "ndwi", "ndyi"]:
            series = extract_daily_series(response, index_name)
            for obs in series:
                is_valid, reason = sanity_check(obs)
                status = "ACCEPTED" if is_valid else f"REJECTED ({reason})"
                print(
                    f"    {index_name.upper():5s} {obs['date'][:10]}  mean={obs['mean']:.4f}  "
                    f"valid_px={obs['sample_count']}  cloud_excluded_px={obs['no_data_count']}  {status}"
                    if obs["mean"] is not None
                    else f"    {index_name.upper():5s} {obs['date'][:10]}  mean=NaN  {status}"
                )
                if is_valid:
                    field_result["observations"].append({"index": index_name, **obs})

        results.append(field_result)

    if auth_failed:
        print(
            "\n[smoke_test] STOPPED: no CDSE credentials configured. This is not a code bug — "
            "see training/CDSE_SETUP.md for the exact account/OAuth-client setup steps, then "
            "set CDSE_CLIENT_ID/CDSE_CLIENT_SECRET in training/.env and re-run this script."
        )
        sys.exit(1)

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT_PATH.open("w", encoding="utf-8") as f:
        for r in results:
            f.write(json.dumps(r) + "\n")

    total_accepted = sum(len(r["observations"]) for r in results)
    print(f"\n[smoke_test] wrote {OUTPUT_PATH.relative_to(REPO_ROOT)} — {total_accepted} real, accepted observations across {len(results)} fields.")


if __name__ == "__main__":
    main()
