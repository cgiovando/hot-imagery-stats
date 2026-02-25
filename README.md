# HOT Imagery Stats Dashboard

An interactive dashboard visualizing satellite imagery usage across [Humanitarian OpenStreetMap Team (HOT)](https://www.hotosm.org) mapping tools.

**Live Dashboard:** [https://cgiovando.github.io/hot-imagery-stats/](https://cgiovando.github.io/hot-imagery-stats/)

> **Note:** This is a work in progress. The dashboard currently tracks [Tasking Manager](https://tasks.hotosm.org) projects. Support for [fAIr](https://fair.hotosm.org) and [MapSwipe](https://mapswipe.org) is planned.

## About

HOT coordinates volunteer mapping efforts using satellite imagery from multiple providers including Microsoft Bing, Esri, Mapbox, and Maxar. This dashboard provides visibility into which imagery sources are used across HOT's Tasking Manager projects, helping HOT understand its imagery consumption patterns and plan for the future.

### What It Shows

- **Project counts and area** by imagery source
- **Geographic distribution** of mapping projects worldwide
- **Trends over time** — how imagery usage has evolved
- **Country-level breakdown** of mapping activity
- **Interactive filters** for year, imagery source, country, organization, and status

## Data Sources

### Tasking Manager (live)

Project data is sourced from the [HOT Tasking Manager API](https://tasking-manager-tm4-production-api.hotosm.org/api/v2/) via [insta-tm](https://github.com/cgiovando/insta-tm), a daily ETL pipeline that mirrors project metadata to S3. The dashboard fetches a lightweight summary JSON at page load — all filtering and aggregation happens client-side.

### fAIr (planned)

[fAIr](https://fair.hotosm.org) is HOT's AI-assisted mapping tool. It currently uses OpenAerialMap imagery, with plans to integrate additional imagery sources. Tracking fAIr imagery usage is a planned addition.

### MapSwipe (planned)

[MapSwipe](https://mapswipe.org) is a mobile app for volunteer mapping. Imagery usage tracking for MapSwipe projects is planned for a future release.

## Tech Stack

- **Vanilla HTML/JS** — No build step, served as a static site
- [Tailwind CSS](https://tailwindcss.com/) — Styling via CDN
- [MapLibre GL JS](https://maplibre.org/) — Interactive map rendering
- [PMTiles](https://protomaps.com/docs/pmtiles) — Efficient vector tile access
- [Chart.js](https://www.chartjs.org/) — Data visualizations
- [insta-tm](https://github.com/cgiovando/insta-tm) — TM data pipeline

## Getting Started

### View the Dashboard

Visit **[https://cgiovando.github.io/hot-imagery-stats/](https://cgiovando.github.io/hot-imagery-stats/)** — no installation required.

### Local Development

```bash
# Clone the repository
git clone https://github.com/cgiovando/hot-imagery-stats.git
cd hot-imagery-stats

# Serve locally
python3 -m http.server 8000 -d docs
```

Then open `http://localhost:8000`

### Fetch Sample Data for Testing

To test with fresh data from the Tasking Manager API:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python scripts/fetch_sample.py
```

This fetches the 100 most recent projects and writes `docs/projects_summary.json`.

## Project Structure

```
docs/                        # GitHub Pages root
├── index.html               # Dashboard page
├── css/dashboard.css        # Custom styles
├── js/
│   ├── data.js              # Data fetching and filtering
│   ├── filters.js           # Filter UI
│   ├── charts.js            # Chart.js visualizations
│   ├── map.js               # MapLibre + PMTiles map
│   └── app.js               # Initialization
├── img/hot-logo.svg         # HOT logo
└── projects_summary.json    # Sample data (fallback)
scripts/
└── fetch_sample.py          # Fetch sample data from TM API
```

## Deployment

The dashboard is deployed via GitHub Pages from the `main` branch `/docs` folder. Data updates automatically when the [insta-tm](https://github.com/cgiovando/insta-tm) ETL runs daily.

## AI-Generated Code Disclaimer

**A significant portion of this application's code was generated with assistance from AI tools.**

### Tools Used
- **Claude** (Anthropic) — Code generation, debugging, and documentation

### What This Means
- The codebase was developed with AI assistance based on requirements and iterative prompts
- All functionality has been tested and verified to work as intended
- The code has undergone human review for usability and correctness

## License

BSD-2-Clause

## Acknowledgments

- [Humanitarian OpenStreetMap Team (HOT)](https://www.hotosm.org/) — Data source and project context
- [MapLibre](https://maplibre.org/) — Open-source map rendering
- [OpenStreetMap](https://www.openstreetmap.org/) — Basemap data
