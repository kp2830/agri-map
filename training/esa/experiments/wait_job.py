import os, time
from dotenv import load_dotenv
load_dotenv("../.env")
import openeo

con = openeo.connect("openeo.dataspace.copernicus.eu")
con.authenticate_oidc_client_credentials(client_id=os.environ["CDSE_CLIENT_ID"], client_secret=os.environ["CDSE_CLIENT_SECRET"], provider_id="CDSE")
job_id = open("experiments/last_job_id.txt").read().strip()
job = con.job(job_id)
while True:
    status = job.status()
    print("STATUS:", status, flush=True)
    if status in ("finished", "error", "canceled"):
        break
    time.sleep(15)

meta = job.describe()
print("COSTS:", meta.get("costs"))
print("USAGE:", meta.get("usage"))
