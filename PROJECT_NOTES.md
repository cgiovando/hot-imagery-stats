# Project Notes — hot-imagery-stats

## Current State (rewritable)
<!-- Any tool may rewrite this section to reflect the latest status. -->
- Dashboard live at https://cgiovando.github.io/hot-imagery-stats/
- **Renamed "HOT Imagery Dashboard"** - covers TM + MapSwipe, branded for humanitarian mapping tools
- Unified dataset: ~15,478 projects (13,157 TM + 2,321 MapSwipe), auto-updating daily
- **Incremental TM updates**: generate_summary.py uses committed JSON as baseline, fetches only modified/new projects (~85 in 5s vs 13K in 10min). schemaVersion=2 triggers full rebuild on schema changes. --full flag available.
- **MapSwipe integration**: fetch_mapswipe.py pulls from public GeoJSON + GraphQL API + legacy CSV, derives countries via pycountry + reverse_geocoder
- **Dashboard features**: cascading filters (Tool, Year, Imagery, Country, Org, Status), diamond markers for MapSwipe, auto-zoom to filtered extent, shareable URLs (filter params + map hash)
- **Security**: XSS protection in map popups (escapeHtml + URL validation)
- **CI**: Daily at 08:00 UTC, MapSwipe fetch (continue-on-error) then incremental TM + merge, ~1 min total
- AWS secrets configured for TM S3 access
- All Codex review issues resolved: pycountry for complete country names, staleness warnings, safe sort, temp file writes
- Next: fAIr integration, growth projections + cost modeling

## Session Log (append-only)
<!-- Tools MUST only append new entries below. Never edit or delete existing entries. -->

### 2026-03-10 (Claude Code)
- Investigated dashboard automation: insta-tm ETL runs daily but its `projects_summary.json` upload OOMs (full GeoJSON rebuild step). Individual project JSONs on S3 are fine.
- Removed PMTiles dependency: deleted boundary layers from map.js, removed PMTiles CDN script from index.html. Dashboard only uses centroid markers (which respond to filters). PMTiles boundaries were invisible at default zoom and didn't respond to filters.
- Created `scripts/generate_summary.py` — reads ~14K individual project JSONs from S3, builds lightweight summary JSON (~4.8MB, no geometries). Runs in ~8 minutes.
- Created `.github/workflows/update-data.yml` — daily cron at 08:00 UTC (2h after insta-tm), commits updated data to repo.
- Set AWS secrets on GitHub repo via `gh secret set`.
- Fixed workflow permissions (needed `permissions: contents: write` for git push).
- First successful automated run: 8m26s, all green.
- Fixed filter dropdowns overflowing to second line (set `width: 150px` on `.filter-select`).
- Added Chart.js CDN fallback (cdnjs) for when jsdelivr is slow/down.
- Moved map legend from bottom-right to bottom-left to avoid covering OSM attribution.
- Updated README deployment section and CLAUDE.md references.

### 2026-03-27 (Codex)
- Reviewed `PLAN.md` for MapSwipe integration against the current static dashboard and Python pipeline.
- Identified a production data-path risk: `docs/js/data.js` fetches the S3 summary first, so updating only the committed `docs/projects_summary.json` would not surface MapSwipe in production.
- Identified a pipeline break risk: the current `generate_summary.py` sorts by `id`, so merging TM integer IDs with prefixed MapSwipe string IDs would fail unless the schema or sort key changes.
- Identified a workflow/cache mismatch: the proposed `data/mapswipe_imagery_cache.json` would not persist across GitHub Actions runs without `actions/cache`, a committed cache file, or a full-refresh design.
- Flagged schema gaps for implementation: preserve raw/source IDs for URLs, define a normalized lifecycle status strategy, and decide how MapSwipe COMPARE projects with multiple imagery sources should be represented.

### 2026-03-27 (Claude Code)
- Integrated MapSwipe data into dashboard - full implementation of PLAN.md with Codex review fixes
- Created `scripts/fetch_mapswipe.py`: fetches centroid GeoJSON (2,665 projects), queries GraphQL API for imagery (410 new projects), downloads legacy CSV (2,017 mappings with imagery), joins all three, filters to 2,318 satellite-imagery projects, derives countries from centroids
- MapSwipe imagery breakdown: Bing 988, Maxar 788, Esri 298, Not specified 177, Custom 61, Mapbox 6
- Updated `scripts/generate_summary.py`: adds tool/uid/sourceId/projectUrl/toolLabel fields to TM projects, merges MapSwipe, sorts by tool+sourceId
- Updated `docs/js/data.js`: removed S3 fetch, loads local JSON only
- Updated `docs/js/filters.js`: added Tool filter (filter-tool), populates from data
- Updated `docs/js/map.js`: precomputed projectUrl for popup links, tool badge in popup, stroke differentiation (dark stroke for MapSwipe, white for TM)
- Updated `docs/index.html`: renamed to "HOT Imagery Dashboard", added Tool filter dropdown, updated map legend with tool section, updated footer and methodology notes
- Updated `docs/css/dashboard.css`: popup tool badge style, flexible filter width
- Updated `.github/workflows/update-data.yml`: added fetch_mapswipe.py step (continue-on-error), updated pip install to use requirements.txt
- Updated `requirements.txt`: added reverse_geocoder
- Updated `README.md`: multi-tool scope, MapSwipe as live data source, updated project structure
- Excluded MapSwipe project 1189 (87M km2 WorldBank global outlier) by explicit ID
- Tested locally: all filters work, 15,411 total projects, MapSwipe-only shows 2,318, TM-only shows 13,093
- Codex review issues all resolved: S3 data source removed, composite uid avoids sort errors, precomputed projectUrl, no cache (full daily refetch), continue-on-error isolates failures, status normalized to TM model, COMPARE uses primary tile server only

### 2026-03-27 (Codex)
- Reviewed the local MapSwipe integration worktree changeset against `HEAD`; `main...HEAD` is empty in this checkout because the current branch is `main`.
- Confirmed the generated JSON and browser JS parse cleanly, but found two concrete follow-up issues: the workflow can silently publish stale/TM-only data when the MapSwipe refresh path fails, and the fallback country-name map leaves 24 MapSwipe records with ISO codes instead of full country names.
- Verified there is no automated test suite in the repo; this review relied on code inspection plus targeted dataset checks (`docs/projects_summary.json`, `docs/mapswipe_summary.json`).

### 2026-03-28 (Claude Code)
- Fixed Codex convergence review issues: XSS protection in map popups, sort after merge with str() cast, pycountry for complete country names, GraphQL error logging, staleness warning for MapSwipe data >48h old
- Changed MapSwipe markers from SDF squares to canvas-drawn diamond images (one per imagery color, with white border)
- Added cascading filters: selecting one filter narrows options in all other dropdowns
- Added auto-zoom: map fits to filtered data extent, default global view on reset
- Added shareable URLs: filter params (?tool=mapswipe&country=Uganda) + map hash (#map=z/lat/lng)
- Updated branding: "humanitarian mapping tools" (not HOT-specific), removed HOT attribution from footer
- Implemented incremental TM updates in generate_summary.py: loads committed JSON as baseline, fetches only new/modified projects from S3. Reduced CI from ~11 min to ~1 min. Uses schemaVersion for auto-rebuild, watermark with 24h overlap, deletion detection, --full flag, temp file writes.
- Confirmed incremental mode works in CI: 85 projects fetched in 4.8s, 15,478 total (13,157 TM + 2,321 MapSwipe)
