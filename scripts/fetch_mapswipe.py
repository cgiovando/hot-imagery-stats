#!/usr/bin/env python3
"""Fetch MapSwipe project data and generate docs/mapswipe_summary.json.

Combines three data sources:
1. Public centroid GeoJSON (metadata, area, geography) - daily refresh
2. GraphQL API (imagery for new projects, Oct 2025+)
3. Legacy CSV export (imagery for old projects, static)

Usage:
    python scripts/fetch_mapswipe.py
"""

import csv
import io
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import requests
import reverse_geocoder as rg

# --- Constants ---

CENTROID_URL = (
    "https://backend.mapswipe.org/media/global/asset/projects_centroid.geojson"
)
LEGACY_CSV_URL = (
    "https://raw.githubusercontent.com/mapswipe/mapswipe-docs"
    "/main/assets/legacy-datasets/projects.csv"
)
GRAPHQL_URL = "https://backend.mapswipe.org/graphql/"
HEALTH_CHECK_URL = "https://backend.mapswipe.org/health-check/"

OUTPUT = Path(__file__).resolve().parent.parent / "docs" / "mapswipe_summary.json"

# Project types that use satellite imagery (strings in GeoJSON)
SATELLITE_TYPES = {"1", "2", "3", "4"}  # FIND, VALIDATE, COMPARE, COMPLETENESS
# Statuses to include
INCLUDE_STATUSES = {"Published", "Finished"}
# Explicit outlier exclusion (87M km2 WorldBank global validation)
EXCLUDE_FIREBASE_IDS = {"1189"}

# Imagery normalization
IMAGERY_MAP = {
    "bing": "Bing",
    "esri": "Esri",
    "esri_beta": "Esri",
    "mapbox": "Mapbox",
    "maxar_premium": "Maxar",
    "maxar_standard": "Maxar",
    "custom": "Custom",
}

# Status normalization to match TM model
STATUS_MAP = {
    "Published": "PUBLISHED",
    "Finished": "ARCHIVED",
}

# GraphQL query with inline fragments for all satellite project types
GRAPHQL_QUERY = """
query FetchProjects($offset: Int!) {
  publicProjects(
    pagination: { limit: 100, offset: $offset }
  ) {
    totalCount
    results {
      id
      oldId
      firebaseId
      name
      projectType
      status
      createdAt
      progress
      numberOfContributorUsers
      numberOfResults
      lastContributionDate
      requestingOrganization { name }
      projectTypeSpecifics {
        ... on FindProjectPropertyType {
          tileServerProperty { name }
        }
        ... on ValidateProjectPropertyType {
          tileServerProperty { name }
        }
        ... on CompareProjectPropertyType {
          tileServerProperty { name }
        }
        ... on CompletenessProjectPropertyType {
          tileServerProperty { name }
        }
      }
    }
  }
}
"""


def fetch_centroid_geojson():
    """Download the public centroid GeoJSON (all project metadata + centroids)."""
    print("Fetching centroid GeoJSON...", flush=True)
    resp = requests.get(CENTROID_URL, timeout=60)
    resp.raise_for_status()
    data = resp.json()
    features = data.get("features", [])
    print(f"  Got {len(features)} features", flush=True)
    return features


def fetch_legacy_csv():
    """Download the legacy imagery CSV export (project_old_id, tile_server_name)."""
    print("Fetching legacy imagery CSV...", flush=True)
    resp = requests.get(LEGACY_CSV_URL, timeout=30)
    resp.raise_for_status()
    reader = csv.DictReader(io.StringIO(resp.text))
    mapping = {}
    for row in reader:
        old_id = row.get("project_old_id", "").strip()
        tile_server = row.get("tile_server_name", "").strip().strip('"')
        if old_id and tile_server:
            mapping[old_id] = tile_server
    print(f"  Got {len(mapping)} legacy imagery mappings", flush=True)
    return mapping


def get_csrf_token(session):
    """Get CSRF token from the health-check endpoint."""
    resp = session.get(HEALTH_CHECK_URL, timeout=15)
    resp.raise_for_status()
    # Extract token from cookies
    for cookie in session.cookies:
        if "CSRFTOKEN" in cookie.name.upper():
            return cookie.value
    raise RuntimeError("No CSRF token found in health-check response")


def fetch_graphql_imagery(session, csrf_token):
    """Query GraphQL API to get imagery for all projects. Returns dict of id -> imagery_name."""
    print("Fetching imagery from GraphQL API...", flush=True)
    imagery_by_id = {}
    offset = 0
    total = None

    headers = {
        "Content-Type": "application/json",
        "x-csrftoken": csrf_token,
        "origin": "https://managers.mapswipe.org",
    }

    while True:
        payload = {
            "query": GRAPHQL_QUERY,
            "variables": {"offset": offset},
        }
        resp = session.post(
            GRAPHQL_URL, json=payload, headers=headers, timeout=30
        )
        resp.raise_for_status()
        result = resp.json()

        if "errors" in result:
            print(f"  GraphQL errors: {result['errors'][:3]}", file=sys.stderr)

        data = result.get("data", {}).get("publicProjects", {})
        if total is None:
            total = data.get("totalCount", 0)
            print(f"  Total projects in API: {total}", flush=True)

        results = data.get("results", [])
        if not results:
            break

        for project in results:
            pid = project.get("id")
            specs = project.get("projectTypeSpecifics")
            if specs and isinstance(specs, dict):
                tile_server = specs.get("tileServerProperty")
                if tile_server and isinstance(tile_server, dict):
                    name = tile_server.get("name")
                    if name:
                        imagery_by_id[pid] = name.lower()

        offset += len(results)
        pages_done = offset // 100
        if pages_done % 5 == 0 or offset >= total:
            print(f"  Fetched {offset}/{total} projects...", flush=True)

        if offset >= total:
            break

        time.sleep(0.2)  # Be polite to the API

    print(f"  Got imagery for {len(imagery_by_id)} projects from GraphQL", flush=True)
    return imagery_by_id


def normalize_imagery(raw_name):
    """Normalize imagery provider name to match TM categories."""
    if not raw_name:
        return "Not specified"
    return IMAGERY_MAP.get(raw_name.lower().strip(), "Other")


def derive_countries(centroids):
    """Derive country names from centroids using reverse_geocoder."""
    if not centroids:
        return {}
    print(f"Deriving countries for {len(centroids)} projects...", flush=True)
    # reverse_geocoder expects list of (lat, lon) tuples
    coords = [(lat, lon) for _, lon, lat in centroids]
    ids = [pid for pid, _, _ in centroids]
    results = rg.search(coords, verbose=False)
    country_map = {}
    for pid, result in zip(ids, results):
        country_map[pid] = result.get("cc", "")
    print(f"  Derived countries for {len(country_map)} projects", flush=True)
    return country_map


def get_country_name(cc):
    """Convert ISO 2-letter country code to full name using pycountry."""
    import pycountry
    country = pycountry.countries.get(alpha_2=cc)
    return country.name if country else cc


def main():
    t0 = time.time()

    # 1. Fetch centroid GeoJSON (metadata + geography)
    features = fetch_centroid_geojson()

    # 2. Fetch legacy imagery CSV
    legacy_imagery = fetch_legacy_csv()

    # 3. Fetch imagery from GraphQL
    session = requests.Session()
    csrf_token = get_csrf_token(session)
    graphql_imagery = fetch_graphql_imagery(session, csrf_token)

    # 4. Build project list from centroid GeoJSON features
    projects = []
    centroids_for_geocoding = []  # (id, lon, lat)

    for feature in features:
        props = feature.get("properties", {})
        geom = feature.get("geometry", {})

        # Filter by project type
        project_type = props.get("project_type")
        if project_type not in SATELLITE_TYPES:
            continue

        # Filter by status
        status_display = props.get("status_display", "")
        if status_display not in INCLUDE_STATUSES:
            continue

        # Get IDs
        pid = str(props.get("id", ""))
        firebase_id = props.get("firebase_id", "")

        # Exclude known outliers
        if firebase_id in EXCLUDE_FIREBASE_IDS or pid in EXCLUDE_FIREBASE_IDS:
            print(f"  Excluding outlier: {pid} ({props.get('name', '')})")
            continue

        # Get centroid coordinates
        coords = geom.get("coordinates", []) if geom else []
        centroid = [round(coords[0], 4), round(coords[1], 4)] if len(coords) >= 2 else None

        if centroid:
            centroids_for_geocoding.append((pid, centroid[0], centroid[1]))

        # Resolve imagery: GraphQL first, then legacy CSV, then "Not specified"
        imagery_raw = None
        if pid in graphql_imagery:
            imagery_raw = graphql_imagery[pid]
        elif firebase_id in legacy_imagery:
            imagery_raw = legacy_imagery[firebase_id]
        # Also try numeric IDs in legacy (oldest projects have numeric firebase_ids)
        elif pid in legacy_imagery:
            imagery_raw = legacy_imagery[pid]

        area = props.get("area_sqkm")
        try:
            area = round(float(area), 2) if area not in (None, "") else None
        except (ValueError, TypeError):
            area = None

        project = {
            "uid": f"ms-{pid}",
            "sourceId": int(pid) if pid.isdigit() else pid,
            "name": props.get("name", ""),
            "tool": "mapswipe",
            "toolLabel": "MapSwipe",
            "status": STATUS_MAP.get(status_display, status_display.upper()),
            "imagery": normalize_imagery(imagery_raw),
            "country": [],  # filled below
            "org": props.get("organization_name") or "",
            "created": (props.get("created_at") or "")[:10],
            "mappingTypes": [],
            "areaSqKm": area,
            "centroid": centroid,
            "projectUrl": f"https://mapswipe.org/en/projects/{firebase_id}/",
            "projectType": props.get("project_type_display", ""),
            "contributors": props.get("number_of_contributor_users"),
            "results": props.get("number_of_results"),
            "pctMapped": round(float(props.get("progress", 0)) * 100) if props.get("progress") is not None else None,
            "pctValidated": None,
            "difficulty": None,
            "priority": None,
        }
        projects.append(project)

    print(f"\n{len(projects)} projects after filtering", flush=True)

    # 5. Derive countries from centroids
    country_codes = derive_countries(centroids_for_geocoding)
    for project in projects:
        pid = project["uid"].replace("ms-", "")
        cc = country_codes.get(pid, "")
        if cc:
            country_name = get_country_name(cc)
            project["country"] = [country_name]

    # 6. Write output
    output = {
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "totalProjects": len(projects),
        "projects": projects,
    }

    with open(OUTPUT, "w") as f:
        json.dump(output, f)

    elapsed = time.time() - t0
    print(f"\nDone in {elapsed:.1f}s. {len(projects)} projects written to {OUTPUT}")

    # Quick stats
    by_imagery = {}
    for p in projects:
        by_imagery[p["imagery"]] = by_imagery.get(p["imagery"], 0) + 1
    print("\nImagery breakdown:")
    for img, count in sorted(by_imagery.items(), key=lambda x: -x[1]):
        print(f"  {img}: {count}")

    by_type = {}
    for p in projects:
        by_type[p["projectType"]] = by_type.get(p["projectType"], 0) + 1
    print("\nProject type breakdown:")
    for pt, count in sorted(by_type.items(), key=lambda x: -x[1]):
        print(f"  {pt}: {count}")

    countries_with_data = sum(1 for p in projects if p["country"])
    print(f"\nProjects with country data: {countries_with_data}/{len(projects)}")


if __name__ == "__main__":
    main()
