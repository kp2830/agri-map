# Copernicus Data Space Ecosystem (CDSE) setup

Required for real Sentinel-2/Sentinel-1 pixel/statistical values. Catalog search (which product/date exists) already works with no account — this is only for actually computing NDVI/NDRE/NDWI/NDYI/VV/VH over a real polygon.

## Steps (self-service, free, ~5-10 minutes, no business approval)

1. Go to https://dataspace.copernicus.eu and register an account (email + password + email verification — same as any consumer signup, no company/commercial approval process).
2. Log in, then go to the **Sentinel Hub** dashboard within CDSE (accessible from your account's user menu, or directly at https://shapps.dataspace.copernicus.eu/dashboard/).
3. Under **User Settings → OAuth clients**, create a new OAuth client. This gives you:
   - a **Client ID**
   - a **Client Secret** (shown once — copy it immediately)
4. No specific "scope" selection is needed for the Statistical API used here — a default OAuth client has access to it. No separate product/data subscription step is required; CDSE's Sentinel-1/2 archive access is included with the free account.

## Where these go

Create `training/.env` (already gitignored via `training/.venv/` and `training/data/` entries — add `training/.env` too, see below) with:

```
CDSE_CLIENT_ID=<your client id>
CDSE_CLIENT_SECRET=<your client secret>
```

**Never** paste these into chat, commit them, or put them in any tracked file. `training/.env.example` (tracked) documents the variable names only, matching this repo's existing `server/.env`/`server/.env.example` convention.

## What happens once this is set

`training/sunflower/cdse_client.py`'s `get_access_token()` reads `CDSE_CLIENT_ID`/`CDSE_CLIENT_SECRET` from the environment (via `training/.env`, loaded with `python-dotenv`) and exchanges them for a real bearer token. Every script in `training/sunflower/` that needs real satellite values (the smoke test, the full-dataset extraction) calls this the same way — nothing is hardcoded, nothing is asked for interactively.
