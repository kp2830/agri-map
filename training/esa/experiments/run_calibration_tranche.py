"""
Submits the real, deterministic 20-field calibration tranche (every 5th field of the already-
frozen, stratified 100-field selection -- see select_100_fields.py / calibration_tranche_20.json)
as real WorldCereal CROPTYPE jobs. User-approved: "Run a smaller calibration tranche first" in
response to the ~900-1700 credit estimate for the full 100-field batch.

Run: .venv/bin/python3 experiments/run_calibration_tranche.py
"""
import json
import os

from dotenv import load_dotenv
load_dotenv("../.env")

import openeo
from openeo_gfmap import BoundingBoxExtent, TemporalContext
from worldcereal.job import create_inference_process_graph, WorldCerealProductType, DEFAULT_INFERENCE_JOB_OPTIONS
from worldcereal.job_params import build_config_from_params

BUF = 0.003
SEASON_START, SEASON_END = "2024-12-01", "2025-11-30"  # same fixed India default used every prior real test

with open("experiments/calibration_tranche_20.json") as f:
    fields = json.load(f)

con = openeo.connect("openeo.dataspace.copernicus.eu")
con.authenticate_oidc_client_credentials(
    client_id=os.environ["CDSE_CLIENT_ID"], client_secret=os.environ["CDSE_CLIENT_SECRET"], provider_id="CDSE"
)
print("Authenticated.")

workflow_config = build_config_from_params(
    season_ids=["tc-annual"], season_windows={"tc-annual": (SEASON_START, SEASON_END)}, export_class_probabilities=True,
)

jobs = []
for i, f in enumerate(fields):
    extent = BoundingBoxExtent(west=f["lng"] - BUF, south=f["lat"] - BUF, east=f["lng"] + BUF, north=f["lat"] + BUF, epsg=4326)
    results = create_inference_process_graph(
        spatial_extent=extent, temporal_extent=TemporalContext(SEASON_START, SEASON_END),
        product_type=WorldCerealProductType.CROPTYPE, connection=con, workflow_config=workflow_config,
    )
    cube = results[0] if isinstance(results, list) else results
    job = cube.create_job(title=f"agrimap-esa-calib-{i:02d}-{f['crop_label']}-{f['field_id']}", job_options=DEFAULT_INFERENCE_JOB_OPTIONS)
    job.start()
    print(f"[{i+1}/{len(fields)}] Submitted {f['crop_label']} ({f['field_id']}, conf={f['amed_confidence']:.3f}): job_id={job.job_id}")
    jobs.append({**f, "job_id": job.job_id, "season_start": SEASON_START, "season_end": SEASON_END})

with open("experiments/calibration_jobs.json", "w") as fh:
    json.dump(jobs, fh, indent=2)
print(f"\nSubmitted {len(jobs)} real jobs. Job IDs saved to experiments/calibration_jobs.json")
