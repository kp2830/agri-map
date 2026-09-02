"""
ONE-SHOT status check of the 20 already-submitted calibration jobs -- no polling loop, no
submission, no retry. Calls describe_job() exactly once per job ID and reports whatever the API
currently returns.

Run: .venv/bin/python3 experiments/check_calibration_status.py
"""
import json, os
from dotenv import load_dotenv
load_dotenv("../.env")
import openeo

con = openeo.connect("openeo.dataspace.copernicus.eu")
con.authenticate_oidc_client_credentials(client_id=os.environ["CDSE_CLIENT_ID"], client_secret=os.environ["CDSE_CLIENT_SECRET"], provider_id="CDSE")

jobs = json.load(open("experiments/calibration_jobs.json"))
statuses = []
for j in jobs:
    job = con.job(j["job_id"])
    d = job.describe()
    statuses.append({
        **j,
        "status": d.get("status"),
        "created": d.get("created"),
        "costs": d.get("costs"),
        "usage": d.get("usage"),
    })
    print(f"{j['crop_label']:10s} {j['field_id']:12s} job={j['job_id']} status={d.get('status')} created={d.get('created')} costs={d.get('costs')} duration={(d.get('usage') or {}).get('duration', {}).get('value')}")

with open("experiments/calibration_status_snapshot.json", "w") as f:
    json.dump(statuses, f, indent=2, default=str)
print("\nSaved experiments/calibration_status_snapshot.json")
