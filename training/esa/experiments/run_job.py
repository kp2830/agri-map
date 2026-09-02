import os
from dotenv import load_dotenv
load_dotenv("../.env")

import openeo
from openeo_gfmap import BoundingBoxExtent
from worldcereal.job import create_inference_process_graph, WorldCerealProductType, DEFAULT_INFERENCE_JOB_OPTIONS
from worldcereal.job_params import build_config_from_params
from worldcereal.seasons import get_season_dates_for_extent

LAT, LNG = 15.6744383, 75.3440033
BUF = 0.003
extent = BoundingBoxExtent(west=LNG - BUF, south=LAT - BUF, east=LNG + BUF, north=LAT + BUF, epsg=4326)
season_temporal = get_season_dates_for_extent(extent, year=2025, season="tc-annual")
print("Season window:", season_temporal.start_date, "-", season_temporal.end_date)

workflow_config = build_config_from_params(
    season_ids=["tc-annual"],
    season_windows={"tc-annual": (season_temporal.start_date, season_temporal.end_date)},
    export_class_probabilities=True,
)

con = openeo.connect("openeo.dataspace.copernicus.eu")
con.authenticate_oidc_client_credentials(
    client_id=os.environ["CDSE_CLIENT_ID"], client_secret=os.environ["CDSE_CLIENT_SECRET"], provider_id="CDSE"
)

results = create_inference_process_graph(
    spatial_extent=extent, temporal_extent=season_temporal,
    product_type=WorldCerealProductType.CROPTYPE, connection=con, workflow_config=workflow_config,
)
cube = results[0] if isinstance(results, list) else results
job = cube.create_job(title="agrimap-esa-worldcereal-gadag-test-v2", job_options=DEFAULT_INFERENCE_JOB_OPTIONS)
print("Job ID:", job.job_id)
job.start()
print("Job started. Status:", job.status())
with open("experiments/last_job_id.txt", "w") as f:
    f.write(job.job_id)
