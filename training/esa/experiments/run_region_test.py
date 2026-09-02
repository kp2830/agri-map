"""
Two-region WorldCereal sunflower sanity test: Siddipet (Telangana) and Kurukshetra (Haryana).
Locations frozen BEFORE this run (from sunflower_region_sanity_check.md, written before any
result was seen). Same exact methodology as the Gadag test: ~640m box, WorldCereal's own real
crop-calendar season lookup, DEFAULT_INFERENCE_JOB_OPTIONS.
"""
import json, os
from dotenv import load_dotenv
load_dotenv("../.env")

import openeo
from openeo_gfmap import BoundingBoxExtent
from worldcereal.job import create_inference_process_graph, WorldCerealProductType, DEFAULT_INFERENCE_JOB_OPTIONS
from worldcereal.job_params import build_config_from_params
from worldcereal.seasons import get_season_dates_for_extent

REGIONS = [
    {"name": "Siddipet-Telangana", "lat": 18.0055851, "lng": 78.8961130},
    {"name": "Kurukshetra-Haryana", "lat": 29.9693747, "lng": 76.8482787},
]
BUF = 0.003

con = openeo.connect("openeo.dataspace.copernicus.eu")
con.authenticate_oidc_client_credentials(
    client_id=os.environ["CDSE_CLIENT_ID"], client_secret=os.environ["CDSE_CLIENT_SECRET"], provider_id="CDSE"
)
print("Authenticated.")

jobs = []
for r in REGIONS:
    extent = BoundingBoxExtent(west=r["lng"] - BUF, south=r["lat"] - BUF, east=r["lng"] + BUF, north=r["lat"] + BUF, epsg=4326)
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
    job = cube.create_job(title=f"agrimap-esa-region-{r['name']}", job_options=DEFAULT_INFERENCE_JOB_OPTIONS)
    job.start()
    print(f"Submitted {r['name']}: job_id={job.job_id}, season={season_temporal.start_date}..{season_temporal.end_date}")
    jobs.append({**r, "job_id": job.job_id, "season_start": season_temporal.start_date, "season_end": season_temporal.end_date})

json.dump(jobs, open("experiments/region_jobs.json", "w"), indent=2)
print(f"\nSubmitted {len(jobs)} real jobs.")
