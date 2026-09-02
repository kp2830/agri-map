"""
Zero-cost: build the real WorldCereal CROPTYPE process graph client-side (no job creation, no
job start, no network call to CDSE for processing) and dump it to JSON. This lets us inspect the
exact process graph the Python SDK sends, so a lightweight TypeScript client can submit the same
process graph directly via openEO's REST API (POST /jobs) without needing Python in production.

Run: .venv/bin/python3 experiments/dump_process_graph.py
"""
import json
import os

from dotenv import load_dotenv
load_dotenv("../.env")

import openeo
from openeo_gfmap import BoundingBoxExtent
from worldcereal.job import create_inference_process_graph, WorldCerealProductType, DEFAULT_INFERENCE_JOB_OPTIONS
from worldcereal.job_params import build_config_from_params
from worldcereal.seasons import get_season_dates_for_extent

con = openeo.connect("openeo.dataspace.copernicus.eu")
con.authenticate_oidc_client_credentials(
    client_id=os.environ["CDSE_CLIENT_ID"], client_secret=os.environ["CDSE_CLIENT_SECRET"], provider_id="CDSE"
)

# Reuse the already-tested Gadag point purely to build a representative graph -- no job is
# created or started, so this costs nothing.
lat, lng = 15.6744383, 75.3440033
BUF = 0.003
extent = BoundingBoxExtent(west=lng - BUF, south=lat - BUF, east=lng + BUF, north=lat + BUF, epsg=4326)
season_temporal = get_season_dates_for_extent(extent, year=2025, season="tc-annual")
workflow_config = build_config_from_params(
    season_ids=["tc-annual"],
    season_windows={"tc-annual": (season_temporal.start_date, season_temporal.end_date)},
    export_class_probabilities=True,
)
results = create_inference_process_graph(
    spatial_extent=extent, temporal_extent=season_temporal,
    product_type=WorldCerealProductType.CROPTYPE, connection=con, workflow_config=workflow_config,
)
cube = results[0] if isinstance(results, list) else results

graph = cube.flat_graph()
print(f"Process graph node count: {len(graph)}")

out = {
    "process_graph": graph,
    "job_options": DEFAULT_INFERENCE_JOB_OPTIONS,
    "example_spatial_extent": {"west": extent.west, "south": extent.south, "east": extent.east, "north": extent.north, "epsg": extent.epsg},
    "example_temporal_extent": [season_temporal.start_date, season_temporal.end_date],
}
with open("experiments/worldcereal_process_graph.json", "w") as f:
    json.dump(out, f, indent=2, default=str)
print("Saved experiments/worldcereal_process_graph.json -- zero credits spent (no job created or started).")

# Also show which node(s) actually encode the spatial/temporal extent, so the TS client knows
# exactly what to parameterize per field.
for node_id, node in graph.items():
    args = node.get("arguments", {})
    if any(k in args for k in ("spatial_extent", "temporal_extent")):
        print(f"\nNode '{node_id}' (process_id={node.get('process_id')}) carries extent args:")
        if "spatial_extent" in args:
            print("  spatial_extent:", args["spatial_extent"])
        if "temporal_extent" in args:
            print("  temporal_extent:", args["temporal_extent"])
