# Agricultural Field Explorer

A web application for exploring agricultural fields on a map. A user navigates a Google Map to an agricultural area, selects a location, and sees real agricultural field polygons — sourced from Google's Agricultural Understanding API — rendered on the map. Clicking a field shows its landscape classification and, where available, crop predictions and crop history.

This is **not** a weather app, a soil app, a generic AI-agriculture app, or a general satellite-analysis app. The V1 agricultural data source is exclusively Google's Agricultural Understanding API:

- **ALU** (Agricultural Landscape Understanding) — agricultural landscape/field geometry (fields, trees, farm ponds, other water, dug wells, and other supported feature types) as GeoJSON.
- **AMED** (Agricultural Monitoring and Event Detection) — field-level crop predictions and monitoring/history data.

Initial geographic focus is India, but the app is not hardcoded to only work there.

## Architecture

```
React (client)
  ↓  lat/lng of a user-selected map location
Express backend (server)
  ↓  lat/lng → S2 Level-13 cell ID
Google Agricultural Understanding API — ALU
  ↓  landscape/field GeoJSON for that cell
Google Agricultural Understanding API — AMED
  ↓  crop predictions + monitoring history for a field
Backend normalizes ALU + AMED into one response
  ↓
React renders field polygons on Google Maps;
clicking a field opens a details panel with crop info + history
```

- **Frontend:** React, Vite, TypeScript, Tailwind CSS.
- **Backend:** Node.js, Express, TypeScript (ESM). All Google API calls happen here — API credentials never reach the browser.
- **Geospatial:** S2 geometry (`s2js`) for lat/lng ↔ S2 cell conversion, backend-only; Level 13 is the required cell level for ALU landscape queries. GeoJSON is the wire format for field geometry between backend and frontend.
- **Database:** none in V1. ALU/AMED data is not persisted. A database may be added later for users, saved fields/locations, favorites, notes, and search history — not before then.
- **AI:** not part of the V1 data pipeline. Crop information always comes directly from AMED; nothing is inferred or guessed by a model.

See [`CLAUDE.md`](./CLAUDE.md) for the full set of project rules and the detailed backend/frontend directory layout.

## Project structure

```
agri-map/
├── client/   React + Vite + TypeScript + Tailwind CSS (frontend)
└── server/   Node.js + Express + TypeScript (backend)
```

## Prerequisites

- Node.js 20+ and npm
- A Google Cloud project with:
  - **Maps JavaScript API** enabled, with a browser API key restricted by HTTP referrer
  - Access to the **Agricultural Understanding API** (ALU + AMED), with server-side credentials

Neither Google integration is wired up yet — see [Development phases](#development-phases) below.

## Development setup

### 1. Backend (`server/`)

```bash
cd server
npm install
cp .env.example .env
npm run dev
```

The API starts on `http://localhost:4000` (configurable via `PORT` in `.env`).

Scripts:

- `npm run dev` — start the API with hot reload (`tsx watch`)
- `npm run build` — compile TypeScript to `dist/`
- `npm start` — run the compiled server from `dist/`
- `npm run typecheck` — type-check without emitting output

### 2. Frontend (`client/`)

```bash
cd client
npm install
cp .env.example .env
npm run dev
```

The app starts on `http://localhost:5173` and expects the API at the URL configured in `VITE_API_BASE_URL`.

Scripts:

- `npm run dev` — start the Vite dev server
- `npm run build` — type-check and build for production
- `npm run preview` — preview the production build locally
- `npm run lint` — lint the codebase

Run the frontend and backend in two separate terminals during development.

## Environment variables

**`server/.env`** (never committed — see `server/.env.example`):

- `PORT` — port the Express server listens on (default `4000`).
- Google Agricultural Understanding API credentials — **not yet added**; will be introduced in Phase 4 (ALU) / Phase 7 (AMED), server-side only, once the exact credential mechanism (API key vs. service account) is confirmed against the official API docs.

**`client/.env`** (never committed — see `client/.env.example`):

- `VITE_API_BASE_URL` — base URL of the backend API (default `http://localhost:4000`).
- Google Maps JavaScript API browser key — **not yet added**; will be introduced in Phase 1. Must be restricted by HTTP referrer in Google Cloud Console.

## Development phases

Built incrementally, one phase per change, with typecheck/lint/build verified before moving on:

1. Google Maps integration (map renders, pan/zoom/search, map/satellite toggle)
2. Map click → capture and display lat/lng
3. lat/lng → S2 Level-13 cell ID (backend)
4. ALU integration (real API, no mock data)
5. ALU GeoJSON → field polygons rendered on the map
6. Field polygon click → selection + highlight
7. AMED integration (real API, no mock data)
8. Field-details panel: ALU properties + AMED crop info
9. Crop-history timeline UI, sourced from AMED
10. Loading / error / empty states (no agricultural coverage, no data, invalid input, API failures)
11. UI polish, testing, documentation

## Current status

Only the project scaffold exists so far: a running React + Tailwind frontend, and an Express backend with a health check and a small internal `/geo` endpoint exercising the S2 utilities (lat/lng ↔ S2 cell token, GeoJSON coverings). No Google Maps, ALU, or AMED integration yet — that begins at Phase 1.
