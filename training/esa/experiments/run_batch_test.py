"""
Small, representative real test: 5 real Indian AMED fields, one per major crop class already
present in our real AMED background (RICE, CORN, SUGARCANE, GROUNDNUT, SOYBEANS -- selected by
highest real AMED confidence per class, a principled, non-cherry-picked rule). Submits all 5
WorldCereal CROPTYPE jobs concurrently to minimize wall-clock time; each job's real cost is
logged individually.

Run: .venv/bin/python3 experiments/run_batch_test.py
"""
import json
import os
import time

from dotenv import load_dotenv
load_dotenv("../.env")

import openeo
from openeo_gfmap import BoundingBoxExtent
from worldcereal.job import create_inference_process_graph, WorldCerealProductType, DEFAULT_INFERENCE_JOB_OPTIONS
from worldcereal.job_params import build_config_from_params
from worldcereal.seasons import get_season_dates_for_extent

FIELDS = [
    {"crop": "RICE", "field_id": "7J8VPXW7+V2PG", "amed_confidence": 0.6516, "lat": 16.747195383333334, "lng": 77.96256572499998},
    {"crop": "CORN", "field_id": "7J6VPJ6J+JQ2C", "amed_confidence": 0.8009, "lat": 14.711459785714284, "lng": 77.63187197142857},
    {"crop": "SUGARCANE", "field_id": "7J9VWG6W+78G9", "amed_confidence": 0.7416, "lat": 17.910652100000004, "lng": 77.54582085000001},
    {"crop": "GROUNDNUT", "field_id": "7J6VMMX2+PMRC", "amed_confidence": 0.9242, "lat": 14.699291990476192, "lng": 77.65170628571428},
    {"crop": "SOYBEANS", "field_id": "7J9QJVWG+V9F7", "amed_confidence": 0.9109, "lat": 17.6471769375, "lng": 75.87599008749999},
]
BUF = 0.003

con = openeo.connect("openeo.dataspace.copernicus.eu")
con.authenticate_oidc_client_credentials(
    client_id=os.environ["CDSE_CLIENT_ID"], client_secret=os.environ["CDSE_CLIENT_SECRET"], provider_id="CDSE"
)
print("Authenticated.")

jobs = []
for f in FIELDS:
    extent = BoundingBoxExtent(west=f["lng"] - BUF, south=f["lat"] - BUF, east=f["lng"] + BUF, north=f["lat"] + BUF, epsg=4326)
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
    job = cube.create_job(title=f"agrimap-esa-batch-{f['crop']}", job_options=DEFAULT_INFERENCE_JOB_OPTIONS)
    job.start()
    print(f"Submitted {f['crop']} ({f['field_id']}): job_id={job.job_id}, season={season_temporal.start_date}..{season_temporal.end_date}")
    jobs.append({**f, "job_id": job.job_id, "season_start": season_temporal.start_date, "season_end": season_temporal.end_date})

with open("experiments/batch_jobs.json", "w") as fh:
    json.dump(jobs, fh, indent=2)
print(f"\nSubmitted {len(jobs)} real jobs. Job IDs saved to experiments/batch_jobs.json")
