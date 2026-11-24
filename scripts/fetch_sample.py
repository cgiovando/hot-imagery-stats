#!/usr/bin/env python3
"""
Fetch the last 100 active TM projects and produce a local projects_summary.json
for dashboard testing. Uses the same normalization logic as the insta-tm ETL.
"""

import json
import re
import sys
from datetime import datetime, timezone

import requests
from pyproj import Geod
from shapely.geometry import shape

API_BASE = "https://tasking-manager-tm4-production-api.hotosm.org/api/v2"
GEOD = Geod(ellps="WGS84")

IMAGERY_PATTERNS = [
    (re.compile(r"bing", re.IGNORECASE), "Bing"),
    (re.compile(r"esri|arcgis|world.imagery", re.IGNORECASE), "Esri"),
    (re.compile(r"mapbox", re.IGNORECASE), "Mapbox"),
    (re.compile(r"maxar|digitalglobe|vivid|securewatch", re.IGNORECASE), "Maxar"),
    (re.compile(r"openaerialmap|oam|open.aerial", re.IGNORECASE), "Custom"),
    (re.compile(r"custom", re.IGNORECASE), "Custom"),
]


def normalize_imagery(raw):
    if not raw or raw.strip() == "":
        return "Not specified"
    for pattern, category in IMAGERY_PATTERNS:
        if pattern.search(raw.strip()):
            return category
    if raw.strip().startswith(("http://", "https://", "tms[")):
        return "Other"
    return "Other"


def compute_area(geojson_geometry):
    try:
        geom = shape(geojson_geometry)
        area_sqm, _ = GEOD.geometry_area_perimeter(geom)
        return round(abs(area_sqm) / 1_000_000, 2)
    except Exception:
        return None


def compute_centroid(geojson_geometry):
    try:
        geom = shape(geojson_geometry)
        c = geom.centroid
        return [round(c.x, 4), round(c.y, 4)]
    except Exception:
        return None


def main():
    session = requests.Session()
    session.headers.update({
        "Accept": "application/json",
        "User-Agent": "HOT-ImageryStats-SampleFetch/1.0",
    })

    # Fetch last 100 projects (most recently updated)
    print("Fetching project listing (pages 1-5)...")
    project_ids = []
    for page in range(1, 6):
        resp = session.get(f"{API_BASE}/projects/", params={
            "orderBy": "last_updated",
            "orderByType": "DESC",
            "projectStatuses": "PUBLISHED,ARCHIVED",
            "page": page,
        }, timeout=60)
        resp.raise_for_status()
        results = resp.json().get("results", [])
        for p in results:
            project_ids.append(p["projectId"])
        if len(project_ids) >= 100:
            break

    project_ids = project_ids[:100]
    print(f"Got {len(project_ids)} project IDs, fetching details...")

    projects = []
    for i, pid in enumerate(project_ids, 1):
        try:
            resp = session.get(f"{API_BASE}/projects/{pid}/", timeout=60)
            resp.raise_for_status()
            d = resp.json()

            aoi = d.get("areaOfInterest")
            imagery_raw = d.get("imagery")
            country_tag = d.get("countryTag", []) or []
            project_info = d.get("projectInfo", {}) or {}

            entry = {
                "id": pid,
                "name": project_info.get("name", ""),
                "status": d.get("status"),
                "imagery": normalize_imagery(imagery_raw),
                "imageryRaw": imagery_raw or "",
                "country": country_tag,
                "org": d.get("organisationName", ""),
                "created": (d.get("created") or "")[:10],
                "mappingTypes": d.get("mappingTypes", []),
                "areaSqKm": compute_area(aoi) if aoi else None,
                "centroid": compute_centroid(aoi) if aoi else None,
                "pctMapped": d.get("percentMapped"),
                "pctValidated": d.get("percentValidated"),
                "difficulty": d.get("difficulty"),
                "priority": d.get("projectPriority"),
            }
            projects.append(entry)
            print(f"  [{i}/{len(project_ids)}] #{pid} - {entry['imagery']} - {entry['name'][:50]}")

        except Exception as e:
            print(f"  [{i}/{len(project_ids)}] #{pid} - FAILED: {e}")

    summary = {
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "totalProjects": len(projects),
        "projects": projects,
    }

    out_path = "docs/projects_summary.json"
    with open(out_path, "w") as f:
        json.dump(summary, f, indent=2)
    print(f"\nWrote {len(projects)} projects to {out_path}")


if __name__ == "__main__":
    main()
