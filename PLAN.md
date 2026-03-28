# Plan: Integrate MapSwipe into HOT Imagery Dashboard

## Goal
Expand the hot-imagery-stats dashboard from TM-only to a multi-tool HOT imagery dashboard, starting with MapSwipe. The dashboard should show imagery usage across all HOT mapping tools, with a "Tool" filter to subset by data source.

## Context
- Dashboard is a static site in `docs/` (vanilla HTML/JS, Tailwind, MapLibre, Chart.js)
- Currently shows ~13K Tasking Manager projects from `docs/projects_summary.json`
- Daily GitHub Action fetches TM data from S3, regenerates summary, commits to repo
- MapSwipe imagery data is now available: GraphQL API for new projects (Oct 2025+), legacy CSV export for older projects
- fAIr will be added in a follow-up (architecture designed to support it now)

## Data Sources for MapSwipe

### 1. Public centroid GeoJSON (metadata + geography)
- URL: `https://backend.mapswipe.org/media/global/asset/projects_centroid.geojson`
- Updated daily at midnight UTC
- 3.7 MB, ~2,665 projects
- Fields: id, firebase_id, name, project_type, project_type_display, organization_name, status, status_display, area_sqkm, centroid (GeoJSON point), progress, number_of_contributor_users, number_of_results, created_at, last_contribution_date

### 2. GraphQL API (imagery for new projects)
- Endpoint: `https://backend.mapswipe.org/graphql/`
- Auth: CSRF token from GET `/health-check/`, then POST with `x-csrftoken` header and `origin: https://managers.mapswipe.org`
- Query: `publicProjects` with inline fragments for each project type's `tileServerProperty { name }`
- Returns imagery for projects created Oct 2025+ (those with non-null projectTypeSpecifics)
- Legacy projects return null for projectTypeSpecifics

### 3. Legacy CSV export (imagery for old projects)
- URL: `https://raw.githubusercontent.com/mapswipe/mapswipe-docs/main/assets/legacy-datasets/projects.csv`
- Static file (one-time export by Navi Ayer, Mar 27 2026)
- 2,197 rows: `project_old_id, tile_server_name`
- Join key: `project_old_id` matches `firebase_id` in centroid GeoJSON
- Distribution: maxar_premium 873, bing 820, esri 258, custom 49, maxar_standard 10, mapbox 6, esri_beta 1, empty 180

## Implementation Steps

### Step 1: New script `scripts/fetch_mapswipe.py`

**Purpose**: Fetch, join, and normalize all MapSwipe data into an internal summary JSON.

**Logic**:
1. Download `projects_centroid.geojson` from MapSwipe backend (full re-download each run, only 3.7 MB)
2. Download legacy CSV from GitHub (static, fetched each run)
3. Query GraphQL API for ALL projects (paginated, 100/page, ~26 pages) to get imagery for new projects. No caching - full fetch is fast (<1 min) and avoids CI persistence complexity.
4. Join imagery data: prefer GraphQL `tileServerProperty.name`, fall back to legacy CSV `tile_server_name`, then "Not specified" for oldest projects with no data
5. For COMPARE projects (2 imagery sources): use primary `tileServerProperty` only (73-85 projects, minimal impact)
6. Filter projects:
   - Include project types: FIND (1), VALIDATE (2), COMPARE (3), COMPLETENESS (4)
   - Exclude: STREET (7, uses Mapillary), VALIDATE_IMAGE (10, no satellite tiles)
   - Include statuses: Published, Finished only
   - Exclude outlier by explicit ID: project 1189 "WSF 2019 Validation - Global" (87M km2)
7. Derive country from centroid using `reverse_geocoder` Python package (offline, fast, GeoNames-based)
8. Normalize imagery names: `bing` -> "Bing", `maxar_premium`/`maxar_standard` -> "Maxar", `esri`/`esri_beta` -> "Esri", `mapbox` -> "Mapbox", `custom` -> "Custom", empty/null -> "Not specified"
9. Normalize statuses: Published -> "PUBLISHED", Finished -> "ARCHIVED" (matches TM status model)
10. Precompute frontend-ready fields in Python:
    - `uid`: `"tm-{id}"` or `"ms-{id}"` (unique cross-tool identifier)
    - `sourceId`: original numeric ID (for sorting within a tool)
    - `projectUrl`: full URL to view project on its native platform
    - `tool`: `"mapswipe"`
    - `toolLabel`: `"MapSwipe"` (display name)
11. Output internal `docs/mapswipe_summary.json` (not a public artifact, consumed by generate_summary.py)

**Output schema per project**:
```json
{
  "uid": "ms-2515",
  "sourceId": 2515,
  "name": "Find Features - Buildings - Flood Response...",
  "tool": "mapswipe",
  "toolLabel": "MapSwipe",
  "status": "PUBLISHED",
  "imagery": "Bing",
  "country": ["Kenya"],
  "org": "HOT",
  "created": "2025-10-14",
  "areaSqKm": 1392.03,
  "centroid": [36.82, -1.29],
  "projectUrl": "https://mapswipe.org/en/data/project/2515/",
  "projectType": "Find Features",
  "contributors": 45,
  "results": 12000,
  "pctMapped": null,
  "pctValidated": null,
  "difficulty": null,
  "priority": null,
  "mappingTypes": []
}
```

**Dependencies**: `requests`, `reverse_geocoder` (new)

### Step 2: Update `scripts/generate_summary.py`

**Changes**:
1. After generating TM summary, add precomputed fields to every TM project:
   - `"uid": "tm-{id}"`, `"sourceId": id`, `"tool": "tm"`, `"toolLabel": "Tasking Manager"`
   - `"projectUrl": "https://tasks.hotosm.org/projects/{id}"`
   - `"projectType": null, "contributors": null, "results": null`
2. Load `docs/mapswipe_summary.json` if it exists (fail gracefully if missing)
3. Merge MapSwipe projects into the unified projects array
4. Update `totalProjects` to reflect combined count
5. Sort by `tool` then `sourceId` (avoids mixed-type sort errors)
6. Output unified `docs/projects_summary.json`

### Step 3: Fix data source in `docs/js/data.js`

**Critical fix from Codex review**: The dashboard currently fetches from S3 first, falling back to local. Since the GitHub Action commits the merged JSON directly to the repo (and GitHub Pages serves it), remove the S3 fetch and load local `projects_summary.json` only. This ensures MapSwipe data is always visible.

### Step 4: Dashboard - Add "Tool" filter

**File: `docs/index.html`**
- Add `<select id="filter-tool">` dropdown in the filter bar, positioned first (before Year)
- Options: All, Tasking Manager, MapSwipe

**File: `docs/js/filters.js`**
- Add `filter-tool` to FILTER_IDS
- Populate dropdown from data (derive unique `toolLabel` values)
- Add filter logic: match on `tool` field

**File: `docs/js/data.js`**
- Add `tool` to `applyFilters()` logic
- Map filter display value back to tool code (e.g., "Tasking Manager" -> "tm")

### Step 5: Dashboard - Update charts and cards

**File: `docs/js/app.js`**
- Summary cards work on filtered data, so they naturally reflect tool filter
- No structural changes needed

**File: `docs/js/charts.js`**
- No structural changes needed - all 4 charts already work on filtered data
- The imagery source charts will naturally include MapSwipe data
- Timeline chart will show MapSwipe projects appearing from 2019 onward
- Top Countries will include MapSwipe countries

### Step 6: Dashboard - Update map

**File: `docs/js/map.js`**
- Visual differentiation: use stroke color or opacity to distinguish tools (simpler than shape change, works with existing circle layer)
- Update popup: use precomputed `projectUrl` field for the "View project" link, show `toolLabel` in popup
- Update legend to show tool differentiation

### Step 7: Branding updates

**File: `docs/index.html`**
- Page `<title>`: "HOT Imagery Dashboard"
- Header subtitle: "Imagery usage across HOT mapping tools"
- Footer: list Tasking Manager and MapSwipe as data sources with links
- Add methodology note: "MapSwipe countries are derived from project centroids. TM countries come from project metadata. MapSwipe areas represent geographic coverage; actual tile requests are higher due to multi-user verification."

**File: `README.md`**
- Update About section to reflect multi-tool scope
- Update Data Sources: MapSwipe is now "live" not "planned"
- Remove the "work in progress" note about MapSwipe

### Step 8: Update GitHub Action

**File: `.github/workflows/update-data.yml`**
- Add `reverse_geocoder` to pip install step (alongside existing deps)
- Update `requirements.txt` to include `reverse_geocoder`
- Add step to run `scripts/fetch_mapswipe.py` BEFORE `generate_summary.py`
- Mark MapSwipe step as `continue-on-error: true` so TM updates still succeed if MapSwipe fetch fails
- No additional secrets needed (all MapSwipe endpoints are public)

### Step 9: Update project docs

**File: `CLAUDE.md`**
- Update project structure diagram
- Update data flow diagram to show MapSwipe pipeline
- Note fAIr as next planned integration

## Architecture Decisions

### Why composite `uid` field instead of raw IDs
TM uses integer IDs (1-14000+). MapSwipe also uses integers (1-2900+). A `uid` like `"tm-95"` / `"ms-2515"` avoids collisions. A separate `sourceId` (numeric) enables sorting within each tool.

### Why precompute `projectUrl` in Python
Avoids conditional URL construction in vanilla JS. The map popup just uses `project.projectUrl` directly. Easy to extend for fAIr later.

### Why full re-fetch daily (no incremental cache)
~2,600 MapSwipe projects, 3.7 MB GeoJSON, ~26 GraphQL pages. Full fetch takes <1 minute. Caching adds complexity and breaks on ephemeral CI runners (`data/` is gitignored). Simpler to re-fetch everything.

### Why load local JSON only (drop S3 fetch)
The GitHub Action commits updated `projects_summary.json` to the repo. GitHub Pages serves it. The S3 fetch in data.js was a pre-Action leftover and would miss MapSwipe data (which is never uploaded to S3).

### Why `continue-on-error` for MapSwipe step
If MapSwipe's API is down, the TM data should still update. `generate_summary.py` gracefully handles missing `mapswipe_summary.json` by using the last committed version.

### Why derive country offline with `reverse_geocoder`
Avoids API rate limits and external service dependencies. Processes thousands of points in seconds. Accurate enough for country-level resolution from centroids.

### Why exclude STREET and VALIDATE_IMAGE project types
STREET uses Mapillary (not satellite imagery), VALIDATE_IMAGE uses uploaded images. Neither consumes satellite tile services.

### Why exclude project 1189 by ID (not by area threshold)
Explicit exclusion is more robust than `area_sqkm > 10,000,000` which could hide legitimate large projects. Project 1189 "WSF 2019 Validation - Global" (87M km2, WorldBank/DLR) is a known one-off.

### Why normalize MapSwipe statuses to TM model
TM uses PUBLISHED/ARCHIVED/DRAFT. MapSwipe has different lifecycle states. Mapping Published->PUBLISHED and Finished->ARCHIVED keeps the status filter consistent across tools. Other statuses are excluded during fetch.

### COMPARE projects: primary imagery only
COMPARE projects have two tile servers (A vs B). The dashboard assumes one imagery per project. Using the primary `tileServerProperty` is a reasonable simplification for 73-85 projects.

## Testing Plan
1. Run `fetch_mapswipe.py` locally, verify output schema and project counts
2. Run `generate_summary.py` locally, verify TM + MapSwipe merge and correct sorting
3. Serve `docs/` locally (`python3 -m http.server 8000 -d docs`), verify:
   - Tool filter works (shows all, TM only, MapSwipe only)
   - Charts update correctly with filter changes
   - Map shows both TM and MapSwipe markers with correct popups and links
   - Summary cards reflect filtered data
4. Check that MapSwipe project links go to correct URLs
5. Run the full GitHub Action workflow manually to verify automation
6. Verify TM-only data still works if MapSwipe fetch fails

## Follow-up: fAIr Integration
The `tool` field and multi-tool filter infrastructure will be ready for fAIr. fAIr integration is simpler:
- API: `https://api-prod.fair.hotosm.org/api/v1/`
- Data: ~123 published models, ~294 datasets
- Imagery: ~90% OpenAerialMap (no Bing) - still useful for the dashboard's broader purpose
- Script: `scripts/fetch_fair.py` following same pattern as MapSwipe
- Add `"fair"` as a tool option, precompute `projectUrl` pointing to fair.hotosm.org
