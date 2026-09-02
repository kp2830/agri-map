"""
Step 1: build the WorldCereal CROPTYPE inference process graph for the smallest real test
(one real field: the Gadag candidate, ~640m x 640m box around its real centroid) and get a REAL
openEO cost estimate BEFORE submitting anything. No job is started by this script.
"""
import os
from dotenv import load_dotenv
load_dotenv("../.env")

import openeo
from openeo_gfmap import BoundingBoxExtent, TemporalContext
from worldcereal.job import create_inference_process_graph, WorldCerealProductType
from worldcereal.job_params import build_config_from_params
from worldcereal.seasons import get_season_dates_for_extent

LAT, LNG = 15.6744383, 75.3440033
BUF = 0.003
extent = BoundingBoxExtent(west=LNG - BUF, south=LAT - BUF, east=LNG + BUF, north=LAT + BUF, epsg=4326)

# Use WorldCereal's own real, location-specific crop-calendar reference to determine the season
# window for this exact AOI -- not an assumed/manual date range.
season_temporal = get_season_dates_for_extent(extent, year=2025, season="tc-annual")
print("Real WorldCereal crop-calendar season window for this AOI:", season_temporal.start_date, "to", season_temporal.end_date)

workflow_config = build_config_from_params(
    season_ids=["tc-annual"],
    season_windows={"tc-annual": (season_temporal.start_date, season_temporal.end_date)},
    export_class_probabilities=True,
)

con = openeo.connect("openeo.dataspace.copernicus.eu")
con.authenticate_oidc_client_credentials(
    client_id=os.environ["CDSE_CLIENT_ID"], client_secret=os.environ["CDSE_CLIENT_SECRET"], provider_id="CDSE"
)
print("Authenticated as:", con.describe_account()["info"]["oidc_userinfo"]["preferred_username"])

results = create_inference_process_graph(
    spatial_extent=extent,
    temporal_extent=season_temporal,
    product_type=WorldCerealProductType.CROPTYPE,
    connection=con,
    workflow_config=workflow_config,
)
cube = results[0] if isinstance(results, list) else results
print("cube type:", type(cube))
import inspect
print(inspect.signature(cube.create_job))
job = cube.create_job(title="agrimap-esa-worldcereal-gadag-test")
print("Job created (NOT started):", job.job_id)
estimate = job.estimate()
print("COST ESTIMATE:", estimate)
