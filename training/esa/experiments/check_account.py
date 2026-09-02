"""
Check real CDSE account state: credit balance (if exposed) and full job history with real costs,
to (a) verify our own cumulative-cost bookkeeping against the platform's own record, and
(b) determine actual remaining quota before committing to a 100-field batch. Read-only, zero cost.

Run: .venv/bin/python3 experiments/check_account.py
"""
import os
import json

from dotenv import load_dotenv
load_dotenv("../.env")

import openeo

con = openeo.connect("openeo.dataspace.copernicus.eu")
con.authenticate_oidc_client_credentials(
    client_id=os.environ["CDSE_CLIENT_ID"], client_secret=os.environ["CDSE_CLIENT_SECRET"], provider_id="CDSE"
)
print("Authenticated.")

print("\n=== describe_account() ===")
try:
    acct = con.describe_account()
    print(json.dumps(acct, indent=2, default=str))
except Exception as e:
    print(f"FAILED: {type(e).__name__}: {e}")

print("\n=== user_jobs() -- full real job history on this account ===")
try:
    jobs = con.user_jobs()
    total_cost = 0.0
    n_finished = 0
    n_error = 0
    for j in jobs:
        cost = j.get("costs")
        status = j.get("status")
        if status == "finished":
            n_finished += 1
        elif status == "error":
            n_error += 1
        if cost is not None:
            total_cost += cost
        print(f"{j.get('id')}: status={status} costs={cost} title={j.get('title')}")
    print(f"\nTotal real jobs on account: {len(jobs)} (finished={n_finished}, error={n_error})")
    print(f"Sum of reported per-job costs across full account history: {total_cost}")
except Exception as e:
    print(f"FAILED: {type(e).__name__}: {e}")

print("\n=== capabilities billing plans (if any) ===")
try:
    caps = con.capabilities()
    print(json.dumps(caps.capabilities.get("billing", "no billing field"), indent=2, default=str))
except Exception as e:
    print(f"FAILED: {type(e).__name__}: {e}")
