#!/usr/bin/env python3
"""Generate docs/projects_summary.json from S3-cached project data.

Reads individual project JSONs from s3://insta-tm/api/v2/projects/
(populated daily by the insta-tm ETL), extracts summary fields, and
writes the dashboard data file. Uses concurrent downloads to process
~14K projects in ~10 minutes.

Usage:
    python scripts/generate_summary.py
"""

import json
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

import boto3
from pyproj import Geod
from shapely.geometry import shape

BUCKET = "insta-tm"
PREFIX = "api/v2/projects/"
OUTPUT = Path(__file__).resolve().parent.parent / "docs" / "projects_summary.json"

GEOD = Geod(ellps="WGS84")

IMAGERY_PATTERNS = [
    (re.compile(r"bing", re.IGNORECASE), "Bing"),
    (re.compile(r"esri|world\.imagery|arcgis", re.IGNORECASE), "Esri"),
    (re.compile(r"mapbox", re.IGNORECASE), "Mapbox"),
    (re.compile(r"maxar|digitalglobe|vivid|securewatch", re.IGNORECASE), "Maxar"),
    (re.compile(r"openaerialmap|oam|open\.aerial", re.IGNORECASE), "Custom"),
    (re.compile(r"custom", re.IGNORECASE), "Custom"),
]


def normalize_imagery(raw):
    if not raw or raw.strip() == "":
        return "Not specified"
    raw_stripped = raw.strip()
    for pattern, category in IMAGERY_PATTERNS:
        if pattern.search(raw_stripped):
            return category
    if raw_stripped.startswith(("http://", "https://", "tms[")):
        return "Other"
    return "Other"


def compute_area_sqkm(geojson_geometry):
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


def build_summary(details):
    project_id = details.get("projectId")
    aoi = details.get("areaOfInterest")
    country_tag = details.get("countryTag", []) or []
    project_info = details.get("projectInfo", {}) or {}

    return {
        "id": project_id,
        "name": project_info.get("name", ""),
        "status": details.get("status"),
        "imagery": normalize_imagery(details.get("imagery")),
        "country": country_tag,
        "org": details.get("organisationName", ""),
        "created": (details.get("created") or "")[:10],
        "mappingTypes": details.get("mappingTypes", []),
        "areaSqKm": compute_area_sqkm(aoi) if aoi else None,
        "centroid": compute_centroid(aoi) if aoi else None,
        "pctMapped": details.get("percentMapped"),
        "pctValidated": details.get("percentValidated"),
        "difficulty": details.get("difficulty"),
        "priority": details.get("projectPriority"),
    }


def main():
    thread_local = threading.local()

    def get_s3():
        if not hasattr(thread_local, "s3"):
            thread_local.s3 = boto3.client("s3", region_name="us-east-1")
        return thread_local.s3

    s3 = boto3.client("s3", region_name="us-east-1")

    # List all project keys
    print("Listing project files on S3...", flush=True)
    keys = []
    paginator = s3.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=BUCKET, Prefix=PREFIX):
        for obj in page.get("Contents", []):
            keys.append(obj["Key"])

    print(f"Found {len(keys)} project files", flush=True)

    # Process concurrently
    projects = []
    errors = 0
    done = 0
    t0 = time.time()

    def fetch_and_summarize(key):
        resp = get_s3().get_object(Bucket=BUCKET, Key=key)
        details = json.loads(resp["Body"].read())
        return build_summary(details)

    with ThreadPoolExecutor(max_workers=20) as pool:
        futures = {pool.submit(fetch_and_summarize, k): k for k in keys}
        for future in as_completed(futures):
            done += 1
            if done % 500 == 0 or done == 1:
                elapsed = time.time() - t0
                rate = done / elapsed if elapsed > 0 else 0
                eta = (len(keys) - done) / rate if rate > 0 else 0
                print(
                    f"  {done}/{len(keys)} ({rate:.0f}/s, ETA {eta:.0f}s)...",
                    flush=True,
                )
            try:
                summary = future.result()
                if summary["id"] is not None:
                    projects.append(summary)
            except Exception as e:
                errors += 1
                if errors <= 5:
                    print(f"  Error on {futures[future]}: {e}", file=sys.stderr)

    projects.sort(key=lambda p: p["id"])

    output = {
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "totalProjects": len(projects),
        "projects": projects,
    }

    with open(OUTPUT, "w") as f:
        json.dump(output, f)

    print(f"\nDone. {len(projects)} projects written to {OUTPUT} ({errors} errors)")

    # Quick stats
    by_imagery = {}
    for p in projects:
        by_imagery[p["imagery"]] = by_imagery.get(p["imagery"], 0) + 1
    print("\nImagery breakdown:")
    for img, count in sorted(by_imagery.items(), key=lambda x: -x[1]):
        print(f"  {img}: {count}")


if __name__ == "__main__":
    main()
