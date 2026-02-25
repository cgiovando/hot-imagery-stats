# HOT Imagery Stats

Quantifying satellite imagery usage across [HOT](https://www.hotosm.org) tools — [Tasking Manager](https://tasks.hotosm.org), [fAIr](https://fair.hotosm.org), and [MapSwipe](https://mapswipe.org) — to understand consumption patterns and estimate costs under different imagery providers.

## Background

The Humanitarian OpenStreetMap Team (HOT) relies on satellite imagery — primarily from Microsoft/Bing — to power humanitarian mapping. With Bing Maps Enterprise reaching end-of-life in June 2028, HOT needs to quantify its imagery usage to plan for a sustainable transition. This project analyzes usage patterns across HOT's tools to:

- Calculate total area mapped per year, by imagery source
- Break down usage by geography, project type, and tool
- Model costs under Azure Maps and alternative provider pricing
- Project future needs as AI-assisted mapping (fAIr) scales up

## Setup

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Usage

See `notebooks/` for analysis and `scripts/` for data extraction tools.

## License

BSD-2-Clause
