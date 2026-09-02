import json, os, time
from dotenv import load_dotenv
load_dotenv("../.env")
import openeo

con = openeo.connect("openeo.dataspace.copernicus.eu")
con.authenticate_oidc_client_credentials(client_id=os.environ["CDSE_CLIENT_ID"], client_secret=os.environ["CDSE_CLIENT_SECRET"], provider_id="CDSE")
jobs = json.load(open("experiments/calibration_jobs.json"))

pending = {j["job_id"]: j for j in jobs}
results = {}
while pending:
    for job_id in list(pending.keys()):
        job = con.job(job_id)
        status = job.status()
        print(f"{pending[job_id]['crop_label']} ({job_id}): {status}", flush=True)
        if status in ("finished", "error", "canceled"):
            meta = job.describe()
            results[job_id] = {**pending[job_id], "final_status": status, "costs": meta.get("costs"), "usage": meta.get("usage")}
            del pending[job_id]
    if pending:
        time.sleep(25)

json.dump(list(results.values()), open("experiments/calibration_results.json", "w"), indent=2, default=str)
print("\nALL DONE. Summary:")
total_cost = 0
for r in results.values():
    print(f"  {r['crop_label']} ({r['field_id']}): status={r['final_status']} cost={r['costs']}")
    total_cost += r['costs'] or 0
print(f"TOTAL REAL CREDITS SPENT THIS CALIBRATION TRANCHE: {total_cost}")
