# Project Notes — hot-imagery-stats

## Current State (rewritable)
<!-- Any tool may rewrite this section to reflect the latest status. -->
- Dashboard live at https://cgiovando.github.io/hot-imagery-stats/
- **Daily auto-update working**: GitHub Action at 08:00 UTC reads S3-cached project data (from insta-tm ETL), generates `projects_summary.json`, commits to repo → GitHub Pages deploys
- AWS secrets (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`) configured on the repo
- PMTiles removed from dashboard (Mar 10, 2026) — map uses centroid markers only
- Chart.js CDN fallback added (jsdelivr → cdnjs) to handle intermittent CDN failures
- 13,093 projects in latest dataset (up from 13,049 in previous static commit)
- insta-tm ETL left unchanged — serves other projects (osm-carbon-date etc.)
- Next: waiting on Kshitij for MapSwipe imagery data, then growth projections + cost modeling

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
