"""
Visual verification helper (not part of the scoring pipeline) — fetches a REAL true-color
Sentinel-2 image for each HIGH-tier field, for its own real flowering window (mid-Dec 2025 -
mid-Jan 2026), using the same real CDSE/Sentinel Hub credentials as cdse_client.py's
Statistical API calls, but the sibling Process API (image output, not aggregated stats) so we
can actually look at what was growing there during the real bloom window, not just infer it from
index means. `mosaickingOrder: leastCC` picks the least-cloudy real scene in the window - a
standard real Sentinel Hub Process API parameter, not invented.

Run: training/.venv/bin/python3 training/safflower/fetch_flowering_truecolor.py
"""
import sys
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "sunflower"))
from cdse_client import get_access_token  # noqa: E402

PROCESS_API_URL = "https://sh.dataspace.copernicus.eu/api/v1/process"

TRUE_COLOR_EVALSCRIPT = """
//VERSION=3
function setup() {
  return { input: ["B02", "B03", "B04"], output: { bands: 3 } }
}
function evaluatePixel(s) {
  return [2.5 * s.B04, 2.5 * s.B03, 2.5 * s.B02]
}
"""

OUT_DIR = Path(__file__).resolve().parent / "verification_images"
OUT_DIR.mkdir(exist_ok=True)


def fetch_image(lat: float, lng: float, field_id: str, half_width_deg: float = 0.0015) -> Path:
    bbox = [lng - half_width_deg, lat - half_width_deg, lng + half_width_deg, lat + half_width_deg]
    payload = {
        "input": {
            "bounds": {"bbox": bbox, "properties": {"crs": "http://www.opengis.net/def/crs/OGC/1.3/CRS84"}},
            "data": [{
                "type": "sentinel-2-l2a",
                "dataFilter": {
                    "timeRange": {"from": "2025-12-15T00:00:00Z", "to": "2026-01-15T23:59:59Z"},
                    "mosaickingOrder": "leastCC",
                    "maxCloudCoverage": 40,
                },
            }],
        },
        "output": {"width": 512, "height": 512, "responses": [{"identifier": "default", "format": {"type": "image/png"}}]},
        "evalscript": TRUE_COLOR_EVALSCRIPT,
    }
    token = get_access_token()
    resp = requests.post(PROCESS_API_URL, json=payload, headers={"Authorization": f"Bearer {token}"}, timeout=60)
    resp.raise_for_status()
    out_path = OUT_DIR / f"{field_id.replace('+', '_')}.png"
    out_path.write_bytes(resp.content)
    return out_path


if __name__ == "__main__":
    import json

    coords = json.load(open(Path(__file__).resolve().parent / "latur_pilot_high_medium_coords.json"))
    high_only = [c for c in coords if c["tier"] == "HIGH"]
    for c in high_only:
        try:
            path = fetch_image(c["lat"], c["lng"], c["field_id"])
            print(f"{c['field_id']} (score={c['score']:.3f}) -> {path}")
        except Exception as exc:  # noqa: BLE001
            print(f"{c['field_id']} -> ERROR: {exc}")
