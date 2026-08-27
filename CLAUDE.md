# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project purpose

**Agricultural Field Explorer.** A web app where a user navigates a Google Map to an agricultural area, selects a location, and sees real agricultural field polygons (from Google's Agricultural Understanding API) rendered on the map. Clicking a field shows its landscape classification and, where available, crop predictions and crop history.

The end-to-end flow:

```
User → React app → Google Maps → user selects a location → lat/lng
  → Express backend → S2 Level-13 cell ID
  → ALU (landscape/field GeoJSON)
  → AMED (crop/monitoring info)
  → backend normalizes the response → React
  → field polygons drawn on Google Maps
  → user clicks a field → field details + crop info + crop history
```

**This is not** a weather app, a soil app, a generic AI-agriculture app, or a general satellite-analysis app. The V1 agricultural data source is exclusively Google's Agricultural Understanding API:

- **ALU** (Agricultural Landscape Understanding) — landscape/field geometry: fields, trees, farm ponds, other water, dug wells, and other supported feature types, as GeoJSON with properties.
- **AMED** (Agricultural Monitoring and Event Detection) — field-level crop predictions and monitoring/history data.

Initial geographic focus is India, but nothing should be hardcoded so it only works there (default map center/bounds should be configurable, not baked into logic).

## Hard rules (do not violate these while implementing any phase)

- **No mock or invented agricultural data, ever**, once real integration work begins. No fake fields, crop types, confidences, or history — not even as "temporary" placeholders. If ALU/AMED has no data for a location, the UI shows a genuine empty state, not a stand-in.
- **Never fabricate a crop prediction.** If AMED returns no prediction, display "no prediction available" — never a guessed or default crop.
- **Only surface properties the API actually returned.** Don't invent field properties (e.g. don't add a "yield estimate" field) that ALU/AMED doesn't provide.
- **No weather APIs, no soil APIs, no other agricultural data APIs.** ALU + AMED are the only external agricultural data sources in V1.
- **No separate satellite-imagery/remote-sensing pipeline.** Google Maps satellite view is sufficient visual context; don't add a second imagery pipeline unless the official ALU/AMED workflow requires it.
- **No LLM/AI crop guessing.** Never use a model to infer or summarize a crop value in place of an actual AMED result. (AI for summarization/interpretation may be considered later, but it is not part of the V1 data pipeline and is out of scope until explicitly requested.)
- **No MongoDB / persistence layer in V1.** ALU/AMED responses are not persisted. A database will be considered later for users, saved fields/locations, favorites, notes, and search history — not before then, and not "because it's the M in MERN."
- **Google Agricultural Understanding API credentials must never reach the React client.** All ALU/AMED calls happen server-side. The client only ever talks to the Express backend.
- **The frontend does not implement S2 logic.** It sends lat/lng to the backend and receives a cell ID/GeoJSON back; all S2 conversion (including the Level-13 requirement for ALU landscape queries) lives in the backend.
- **Never commit secrets.** Credentials live in `.env` files (gitignored); `.env.example` documents variable names only.

## Technology stack

| Layer | Choice |
|---|---|
| Frontend | React + Vite + TypeScript + Tailwind CSS |
| Backend | Node.js + Express + TypeScript (ESM) |
| Geospatial | `s2js` (S2 geometry), GeoJSON as the wire format for field geometry |
| Map | Google Maps JavaScript API |
| Agricultural data | Google Agricultural Understanding API — ALU + AMED |
| Database | none in V1 |

## Repository layout

Two independent npm projects, no root `package.json` / workspace tooling. Run each with its own `npm install` / `npm run dev` from within its directory.

```
client/   React + Vite + TypeScript + Tailwind CSS
server/   Node.js + Express + TypeScript
```

### Backend target structure

As ALU/AMED integration is built out (starting Phase 4), backend code should organize as:

```
server/src/
  routes/                 thin route definitions, mounted in app.ts
  controllers/            request/response handling, calls into services
  services/
    agricultural/
      alu/                ALU request building + response parsing
      amed/               AMED request building + response parsing
    google/                shared Google API client/auth setup
  utils/
    s2/                   S2 conversion helpers (lat/lng ↔ cell ID, coverings)
  types/                  shared TypeScript types (ALU/AMED response shapes, normalized field types)
  middleware/             error handling, request validation, etc.
```

**Current state note:** the scaffold today has `server/src/routes/` (with `health.ts` and `geo.ts`) and `server/src/lib/s2/` (not yet renamed to `utils/s2/`), with no `controllers/`, `services/`, or `types/` yet since there's no ALU/AMED integration to justify them. Introduce `controllers/` and `services/agricultural/` when Phase 4 (ALU) actually adds Google API calls — don't create empty layers ahead of need. The `lib/s2` → `utils/s2` rename is a trivial pending cleanup; do it as a small, isolated change (not bundled into a feature commit) when convenient.

### Frontend structure

```
client/src/
  components/    shared/reusable UI (currently empty)
  features/      feature-based modules, e.g. a future map/ or field-details/ (currently empty)
  hooks/         shared hooks (currently empty)
  lib/api.ts     the one place that knows the backend base URL and does fetch — route new
                 backend calls through here, not directly from components
  types/         shared TypeScript types (currently empty)
```

No routing library or state management library is installed yet — add one only when there's an actual second view or real cross-component state need.

## ALU / AMED responsibilities

- **ALU** answers "what agricultural landscape features exist here": field boundaries and other feature types (trees, ponds, wells, etc.) as GeoJSON geometry + properties (type, area, confidence, capture timestamp, etc. — whatever the API actually returns). Queried via the S2 Level-13 cell for the selected location.
- **AMED** answers "what's growing in this field, and when": crop prediction, confidence, alternative predictions, season start/end, and historical monitoring/crop-history data, keyed to an ALU field feature.
- The backend normalizes both into a single response shape for the frontend (exact shape TBD when Phase 4/7 are implemented against real API responses — don't design the normalized type speculatively before seeing real payloads).

## S2 usage

- **Level 13** is the required cell level for ALU landscape queries (~1km cell width) — this is already the default level in `server/src/lib/s2/index.ts` (`DEFAULT_LEVEL = 13`).
- S2 conversion is backend-only. Existing utilities: `latLngToCellToken`, `cellTokenToLatLng`, `getCoveringCellTokens` (GeoJSON → covering cell tokens, useful for querying ALU across a field's or viewport's extent).
- `s2js` namespaces its API (`s2`, `s1`, `geojson`, etc.) — e.g. degrees/radians conversion is `s1.angle.degrees`, not `s1.degrees`. Relative imports need `.js` extensions (ESM + `NodeNext`).

## Empty / error states (required, not optional)

The app must handle all of these without crashing or showing fabricated data: location outside agricultural coverage, no landscape (ALU) data, no crop (AMED) data, unknown crop, no prediction, invalid coordinates, invalid S2 cell, API errors, API timeouts, and network failures. Each of these gets a genuine, honest UI state — not a silent fallback to fake content.

## Security

- Google Agricultural Understanding API credentials: server-side env vars only, never sent to or readable by the client.
- Google Maps JavaScript API key: client-side by necessity (it's a browser API), but must be restricted appropriately in Google Cloud Console (HTTP referrer restriction) — document this requirement in README, don't rely on the key alone for security.
- `.env` files are gitignored; `.env.example` files document required variable names without values.

## Development strategy — build in phases

Do not implement multiple phases in one change. For **each** phase: inspect existing code first, explain the intended change before making it, make the smallest coherent change that accomplishes the phase, then run typecheck → lint → tests (where they exist) → build/run, and fix any failures before moving to the next phase. Never break existing working functionality to add a new one.

1. Google Maps integration (map renders, pan/zoom/search, map/satellite toggle)
2. Map click → capture and display lat/lng
3. lat/lng → S2 Level-13 cell ID (backend)
4. ALU integration (backend calls real ALU API for the selected cell)
5. ALU GeoJSON → field polygons rendered on the map, visually distinct from other feature types
6. Field polygon click → selection + highlight
7. AMED integration (backend calls real AMED API for the selected field)
8. Field-details panel: ALU properties + AMED crop info
9. Crop-history timeline UI, sourced from AMED
10. Loading / error / empty states across the whole flow
11. UI polish, testing, documentation

## Known environment quirks

- This environment's global npm cache has had permission issues (root-owned files under `~/.npm`). If `npm install` fails with `EACCES` on the cache, don't reach for `sudo` in an agent session — use a local, project-relative `--cache` directory instead (e.g. `npm install --cache ../.npm-cache`).
