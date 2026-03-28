# HOT Imagery Dashboard

An interactive dashboard visualizing satellite imagery usage across humanitarian mapping tools, maintained by the [Humanitarian OpenStreetMap Team (HOT)](https://www.hotosm.org).

**Live Dashboard:** [https://cgiovando.github.io/hot-imagery-stats/](https://cgiovando.github.io/hot-imagery-stats/)

## About

Humanitarian mapping efforts rely on satellite imagery from multiple providers including Microsoft Bing, Esri, Mapbox, and Maxar. This dashboard provides visibility into which imagery sources are used across humanitarian mapping tools like the HOT Tasking Manager and MapSwipe, helping the community understand imagery consumption patterns and plan for the future.

### What It Shows

- **Project counts and area** by imagery source (Bing, Esri, Mapbox, Maxar, etc.)
- **Geographic distribution** of mapping projects worldwide (circles for TM, diamonds for MapSwipe)
- **Trends over time** - how imagery usage has evolved since 2012
- **Country-level breakdown** of mapping activity
- **Cascading filters** - selecting one filter narrows options in all others (tool, year, imagery, country, organization, status)
- **Shareable URLs** - filter state and map position are synced to the URL for easy sharing
- **Auto-zoom** - map fits to the extent of filtered data

## Data Sources

### Tasking Manager (live)

Project data is sourced from the [HOT Tasking Manager API](https://tasking-manager-tm4-production-api.hotosm.org/api/v2/) via [insta-tm](https://github.com/cgiovando/insta-tm), a daily ETL pipeline that mirrors project metadata to S3.

### MapSwipe (live)

Project data is sourced from the [MapSwipe](https://mapswipe.org) public data exports and GraphQL API. Imagery provider information comes from the API for recent projects and a legacy database export for older projects. Countries are derived from project centroids.

### fAIr (planned)

[fAIr](https://fair.hotosm.org) is HOT's AI-assisted mapping tool. It currently uses OpenAerialMap imagery primarily. Tracking fAIr imagery usage is planned for a future release.

## Tech Stack

- **Vanilla HTML/JS** - No build step, served as a static site
- [Tailwind CSS](https://tailwindcss.com/) - Styling via CDN
- [MapLibre GL JS](https://maplibre.org/) - Interactive map rendering
- [Chart.js](https://www.chartjs.org/) - Data visualizations
- [insta-tm](https://github.com/cgiovando/insta-tm) - TM data pipeline
- Python scripts for MapSwipe data fetching and summary generation

## Getting Started

### View the Dashboard

Visit **[https://cgiovando.github.io/hot-imagery-stats/](https://cgiovando.github.io/hot-imagery-stats/)** - no installation required.

### Local Development

```bash
# Clone the repository
git clone https://github.com/cgiovando/hot-imagery-stats.git
cd hot-imagery-stats

# Serve locally
python3 -m http.server 8000 -d docs
```

Then open `http://localhost:8000`

### Fetch Fresh Data

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Fetch MapSwipe data
python scripts/fetch_mapswipe.py

# Generate unified summary (requires AWS credentials for TM data)
python scripts/generate_summary.py
```

## Project Structure

```
docs/                        # GitHub Pages root
├── index.html               # Dashboard page
├── css/dashboard.css        # Custom styles
├── js/
│   ├── data.js              # Data fetching and filtering
│   ├── filters.js           # Filter UI (tool, year, imagery, etc.)
│   ├── charts.js            # Chart.js visualizations
│   ├── map.js               # MapLibre map with centroid markers
│   └── app.js               # Initialization
├── img/hot-logo.svg         # HOT logo
├── projects_summary.json    # Unified dataset (TM + MapSwipe)
└── mapswipe_summary.json    # MapSwipe data (intermediate)
scripts/
├── fetch_mapswipe.py        # Fetch MapSwipe data from API + legacy CSV
├── generate_summary.py      # Generate unified summary from S3 + MapSwipe
└── fetch_sample.py          # Fetch sample TM data for testing
```

## Deployment

The dashboard is deployed via GitHub Pages from the `main` branch `/docs` folder. A [daily GitHub Action](.github/workflows/update-data.yml) fetches MapSwipe data, regenerates the unified `docs/projects_summary.json` from all sources, and commits it to the repo.

## AI-assisted development

> This project was developed with significant assistance from AI coding tools.

- **[Claude Code](https://claude.ai/claude-code)** (Anthropic) - Code generation, architecture, debugging, and documentation
- All functionality has been tested and verified to work as intended
- Features and infrastructure choices have been reviewed and approved by the maintainer

This disclosure follows emerging best practices for transparency in AI-assisted software development.

## License

BSD-2-Clause

## Acknowledgments

- [Humanitarian OpenStreetMap Team (HOT)](https://www.hotosm.org/) - Data source and project context
- [MapSwipe](https://mapswipe.org/) - Volunteer mapping data
- [MapLibre](https://maplibre.org/) - Open-source map rendering
- [OpenStreetMap](https://www.openstreetmap.org/) - Basemap data
