#!/usr/bin/env python3
"""Fetch fAIr dataset data and generate docs/fair_summary.json.

Combines multiple data sources:
1. Dataset list API (metadata, source_imagery, status, dates) - paginated
2. Dataset centroid GeoJSON (geographic coordinates)
3. AOI API (polygon geometries for area computation) - paginated
4. OAM catalog via cgiovando/oam-api (platform classification) - cached

Usage:
    python scripts/fetch_fair.py
    python scripts/fetch_fair.py --skip-oam   # skip OAM platform lookup
"""

import json
import re
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

import pycountry
import requests
import reverse_geocoder as rg
from pyproj import Geod
from shapely.geometry import shape
from shapely.ops import unary_union
from shapely.validation import make_valid

# --- Constants ---

DATASET_API = "https://api-prod.fair.hotosm.org/api/v1/dataset/"
CENTROID_API = "https://api-prod.fair.hotosm.org/api/v1/datasets/centroid/"
AOI_API = "https://api-prod.fair.hotosm.org/api/v1/aoi/"
PAGE_SIZE = 50
AOI_PAGE_SIZE = 100

# OAM platform cache and catalog
OAM_CATALOG_URL = (
    "https://cgiovando-oam-api.s3.us-east-1.amazonaws.com/all_images.geojson"
)

DOCS_DIR = Path(__file__).resolve().parent.parent / "docs"
OUTPUT = DOCS_DIR / "fair_summary.json"
OAM_CACHE_FILE = DOCS_DIR / "oam_platform_cache.json"

GEOD = Geod(ellps="WGS84")

# Imagery normalization: OAM URLs get classified by platform via OAM catalog.
# Non-OAM URLs use these patterns (same categories as TM/MapSwipe).
IMAGERY_PATTERNS = [
    (re.compile(r"bing", re.IGNORECASE), "Bing"),
    (re.compile(r"esri|world\.imagery|arcgis", re.IGNORECASE), "Esri"),
    (re.compile(r"mapbox", re.IGNORECASE), "Mapbox"),
    (re.compile(r"maxar|digitalglobe|vivid|securewatch", re.IGNORECASE), "Maxar"),
]

# OAM platform -> imagery category
OAM_PLATFORM_MAP = {
    "uav": "OAM Drone",
    "satellite": "OAM Satellite",
    "aircraft": "OAM Aircraft",
}


def is_oam_url(url):
    """Check if a URL points to OpenAerialMap tiles."""
    return bool(url and "openaerialmap" in url.lower())


def extract_oam_tms_path(url):
    """Extract the TMS path key from an OAM URL for cache lookup.

    OAM TMS URLs: tiles.openaerialmap.org/{upload_id}/{idx}/{image_id}/{z}/{x}/{y}
    Returns: '{upload_id}/{idx}/{image_id}' or None.
    """
    m = re.search(r"tiles\.openaerialmap\.org/([^/]+/\d+/[^/]+)", url)
    return m.group(1) if m else None


def normalize_imagery(raw, oam_cache):
    """Normalize a source_imagery URL to a category name.

    For OAM URLs, looks up the platform in the OAM cache.
    For non-OAM URLs, uses regex pattern matching.
    """
    if not raw or raw.strip() == "":
        return "Not specified"
    raw_stripped = raw.strip()

    # OAM URLs: classify by platform
    if is_oam_url(raw_stripped):
        tms_path = extract_oam_tms_path(raw_stripped)
        if tms_path and tms_path in oam_cache:
            platform = oam_cache[tms_path].get("platform", "")
            return OAM_PLATFORM_MAP.get(platform.lower(), "OAM Unknown")
        return "OAM Unknown"

    # Non-OAM: match against known basemap providers
    for pattern, category in IMAGERY_PATTERNS:
        if pattern.search(raw_stripped):
            return category

    if raw_stripped.startswith(("http://", "https://", "tms[")):
        return "Custom"
    return "Other"


# --- Data fetching ---


def fetch_all_datasets():
    """Fetch all datasets from the paginated API."""
    print("Fetching datasets from API...", flush=True)
    datasets = []
    offset = 0
    total = None

    while True:
        resp = requests.get(
            DATASET_API,
            params={"limit": PAGE_SIZE, "offset": offset},
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()

        if total is None:
            total = data.get("count", 0)
            print(f"  Total datasets: {total}", flush=True)

        results = data.get("results", [])
        if not results:
            break

        datasets.extend(results)
        offset += len(results)
        print(f"  Fetched {offset}/{total}...", flush=True)

        if offset >= total:
            break

        time.sleep(0.2)

    print(f"  Got {len(datasets)} datasets", flush=True)
    return datasets


def fetch_centroids():
    """Fetch dataset centroids GeoJSON. Returns dict of did -> [lon, lat]."""
    print("Fetching dataset centroids...", flush=True)
    resp = requests.get(CENTROID_API, timeout=30)
    resp.raise_for_status()
    data = resp.json()
    features = data.get("features", [])

    centroids = {}
    for f in features:
        did = f.get("properties", {}).get("did")
        geom = f.get("geometry")
        if did and geom and geom.get("coordinates"):
            coords = geom["coordinates"]
            centroids[did] = [round(coords[0], 4), round(coords[1], 4)]

    print(f"  Got {len(centroids)} centroids (of {len(features)} features)", flush=True)
    return centroids


def fetch_all_aois():
    """Fetch all AOI polygon geometries. Returns dict of dataset_id -> [geojson_geom, ...]."""
    print("Fetching AOI geometries...", flush=True)
    aois_by_dataset = {}
    offset = 0
    total = None

    while True:
        resp = requests.get(
            AOI_API,
            params={"limit": AOI_PAGE_SIZE, "offset": offset},
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()

        if total is None:
            total = data.get("count", 0)
            print(f"  Total AOIs: {total}", flush=True)

        features = data.get("results", {}).get("features", [])
        if not features:
            break

        for feat in features:
            did = feat.get("properties", {}).get("dataset")
            geom = feat.get("geometry")
            if did and geom:
                aois_by_dataset.setdefault(did, []).append(geom)

        offset += len(features)
        if offset % 500 == 0 or offset >= total:
            print(f"  Fetched {offset}/{total} AOIs...", flush=True)

        if offset >= total:
            break

        time.sleep(0.1)

    print(
        f"  Got {sum(len(v) for v in aois_by_dataset.values())} AOIs "
        f"across {len(aois_by_dataset)} datasets",
        flush=True,
    )
    return aois_by_dataset


def compute_dataset_areas(aois_by_dataset):
    """Compute geodesic area (km2) per dataset from AOI polygons."""
    print("Computing dataset areas...", flush=True)
    areas = {}
    for did, geom_list in aois_by_dataset.items():
        try:
            geoms = [make_valid(shape(g)) for g in geom_list]
            combined = unary_union(geoms)
            area_sqm, _ = GEOD.geometry_area_perimeter(combined)
            areas[did] = round(abs(area_sqm) / 1_000_000, 2)
        except Exception:
            # Fallback: sum individual areas
            total = 0
            for g in geom_list:
                try:
                    s = make_valid(shape(g))
                    a, _ = GEOD.geometry_area_perimeter(s)
                    total += abs(a) / 1_000_000
                except Exception:
                    pass
            areas[did] = round(total, 2)

    print(
        f"  Computed area for {len(areas)} datasets, "
        f"total {sum(areas.values()):.1f} km2",
        flush=True,
    )
    return areas


# --- OAM platform classification ---


def atomic_json_write(path, data):
    """Write JSON via temp file + rename to avoid corrupt files on crash."""
    tmp_fd, tmp_path = tempfile.mkstemp(
        dir=path.parent, suffix=".json", prefix=f".{path.stem}_"
    )
    try:
        with open(tmp_fd, "w") as f:
            json.dump(data, f, separators=(",", ":") if path == OAM_CACHE_FILE else (", ", ": "))
        Path(tmp_path).replace(path)
    except Exception:
        Path(tmp_path).unlink(missing_ok=True)
        raise


def load_oam_cache():
    """Load the OAM platform cache from disk."""
    if OAM_CACHE_FILE.exists():
        try:
            with open(OAM_CACHE_FILE) as f:
                cache = json.load(f)
            print(f"Loaded OAM platform cache: {len(cache)} entries", flush=True)
            return cache
        except (json.JSONDecodeError, OSError) as e:
            print(f"Warning: OAM cache unreadable: {e}", file=sys.stderr)
    return {}


def save_oam_cache(cache):
    """Save the OAM platform cache to disk."""
    atomic_json_write(OAM_CACHE_FILE, cache)
    print(f"Saved OAM platform cache: {len(cache)} entries", flush=True)


def build_oam_lookup_from_catalog():
    """Download the oam-api GeoJSON catalog and build a TMS path -> metadata lookup."""
    print("Downloading OAM catalog (all_images.geojson)...", flush=True)
    resp = requests.get(OAM_CATALOG_URL, timeout=120)
    resp.raise_for_status()
    data = resp.json()

    features = data.get("features", [])
    print(f"  OAM catalog: {len(features)} images", flush=True)

    lookup = {}
    for feat in features:
        props = feat.get("properties", {})
        tms = props.get("tms", "")
        if "openaerialmap" in tms:
            path = extract_oam_tms_path(tms)
            if path:
                lookup[path] = {
                    "platform": props.get("platform", ""),
                    "provider": props.get("provider", ""),
                }

    print(f"  Built lookup: {len(lookup)} TMS paths", flush=True)
    return lookup


def refresh_oam_cache(oam_cache):
    """Refresh the OAM platform cache from the full catalog.

    Downloads the oam-api catalog daily to stay in sync with new OAM uploads.
    This ensures both fAIr and TM OAM URLs get resolved, not just fAIr's.
    """
    catalog_lookup = build_oam_lookup_from_catalog()

    added = 0
    for path, info in catalog_lookup.items():
        if path not in oam_cache:
            oam_cache[path] = info
            added += 1

    print(f"  Cache updated: {added} new entries (total: {len(oam_cache)})", flush=True)
    return added


# --- Country derivation ---


def derive_countries(centroid_list):
    """Derive country names from centroids using reverse_geocoder + pycountry."""
    if not centroid_list:
        return {}
    print(f"Deriving countries for {len(centroid_list)} datasets...", flush=True)
    coords = [(lat, lon) for _, lon, lat in centroid_list]
    ids = [did for did, _, _ in centroid_list]
    results = rg.search(coords, verbose=False)
    country_map = {}
    for did, result in zip(ids, results):
        cc = result.get("cc", "")
        if cc:
            c = pycountry.countries.get(alpha_2=cc)
            country_map[did] = c.name if c else cc
    print(f"  Derived countries for {len(country_map)} datasets", flush=True)
    return country_map


# --- Main ---


def main():
    skip_oam = "--skip-oam" in sys.argv
    t0 = time.time()

    # 1. Fetch all datasets
    datasets = fetch_all_datasets()

    # 2. Fetch centroids
    centroids = fetch_centroids()

    # 3. Fetch AOIs and compute area
    aois_by_dataset = fetch_all_aois()
    areas = compute_dataset_areas(aois_by_dataset)

    # 4. OAM platform classification
    oam_cache = load_oam_cache()
    if not skip_oam:
        refresh_oam_cache(oam_cache)
        save_oam_cache(oam_cache)

    # 5. Derive countries
    centroid_list = [(did, c[0], c[1]) for did, c in centroids.items()]
    country_map = derive_countries(centroid_list)

    # 6. Build project records
    projects = []
    for ds in datasets:
        did = ds.get("id")
        centroid = centroids.get(did)

        project = {
            "uid": f"fair-{did}",
            "sourceId": did,
            "name": ds.get("name", ""),
            "tool": "fair",
            "toolLabel": "fAIr",
            "status": "PUBLISHED",
            "imagery": normalize_imagery(ds.get("source_imagery"), oam_cache),
            "country": [country_map[did]] if did in country_map else [],
            "org": "",
            "created": (ds.get("created_at") or "")[:10],
            "mappingTypes": [],
            "areaSqKm": areas.get(did),
            "centroid": centroid,
            "projectUrl": f"https://fair.hotosm.org/datasets/{did}",
            "projectType": None,
            "contributors": None,
            "results": ds.get("models_count"),
            "pctMapped": None,
            "pctValidated": None,
            "difficulty": None,
            "priority": None,
        }
        projects.append(project)

    # 7. Write output
    output = {
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "totalProjects": len(projects),
        "projects": projects,
    }

    atomic_json_write(OUTPUT, output)

    elapsed = time.time() - t0
    print(f"\nDone in {elapsed:.1f}s. {len(projects)} datasets written to {OUTPUT}")

    # Quick stats
    by_imagery = {}
    for p in projects:
        by_imagery[p["imagery"]] = by_imagery.get(p["imagery"], 0) + 1
    print("\nImagery breakdown:")
    for img, count in sorted(by_imagery.items(), key=lambda x: -x[1]):
        print(f"  {img}: {count}")

    with_area = sum(1 for p in projects if p["areaSqKm"] is not None)
    total_area = sum(p["areaSqKm"] for p in projects if p["areaSqKm"])
    print(f"\nDatasets with area: {with_area}/{len(projects)}, total {total_area:.1f} km2")

    with_centroid = sum(1 for p in projects if p["centroid"])
    print(f"Datasets with centroids: {with_centroid}/{len(projects)}")

    countries_with_data = sum(1 for p in projects if p["country"])
    print(f"Datasets with country data: {countries_with_data}/{len(projects)}")


if __name__ == "__main__":
    main()
