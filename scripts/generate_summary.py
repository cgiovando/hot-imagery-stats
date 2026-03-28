#!/usr/bin/env python3
"""Generate docs/projects_summary.json from S3-cached project data.

Reads individual project JSONs from s3://insta-tm/api/v2/projects/
(populated daily by the insta-tm ETL), extracts summary fields, and
writes the dashboard data file.

Incremental mode (default): loads the previously committed summary as
a baseline, then fetches only projects that are new or modified since
the last run. Falls back to full rebuild if the baseline is missing,
too old, or has a different schema version.

Usage:
    python scripts/generate_summary.py          # incremental (default)
    python scripts/generate_summary.py --full   # force full rebuild
"""

import json
import re
import sys
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from pathlib import Path

import boto3
from pyproj import Geod
from shapely.geometry import shape

BUCKET = "insta-tm"
PREFIX = "api/v2/projects/"
OUTPUT = Path(__file__).resolve().parent.parent / "docs" / "projects_summary.json"

GEOD = Geod(ellps="WGS84")

# Bump this when build_summary() output schema changes to force a full rebuild
SCHEMA_VERSION = 2

# How far back to look beyond the baseline timestamp to catch stragglers
OVERLAP_BUFFER_HOURS = 24

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
        "uid": f"tm-{project_id}" if project_id else None,
        "sourceId": project_id,
        "name": project_info.get("name", ""),
        "tool": "tm",
        "toolLabel": "Tasking Manager",
        "status": details.get("status"),
        "imagery": normalize_imagery(details.get("imagery")),
        "country": country_tag,
        "org": details.get("organisationName", ""),
        "created": (details.get("created") or "")[:10],
        "mappingTypes": details.get("mappingTypes", []),
        "areaSqKm": compute_area_sqkm(aoi) if aoi else None,
        "centroid": compute_centroid(aoi) if aoi else None,
        "projectUrl": f"https://tasks.hotosm.org/projects/{project_id}" if project_id else None,
        "projectType": None,
        "contributors": None,
        "results": None,
        "pctMapped": details.get("percentMapped"),
        "pctValidated": details.get("percentValidated"),
        "difficulty": details.get("difficulty"),
        "priority": details.get("projectPriority"),
    }


def extract_project_id(key):
    """Extract numeric project ID from an S3 key like 'api/v2/projects/12345.json'."""
    name = key.rsplit("/", 1)[-1]
    return name.replace(".json", "")


def load_baseline():
    """Load the existing summary as a baseline. Returns (tm_projects_by_id, generated_ts, valid)."""
    if not OUTPUT.exists():
        return {}, None, False

    try:
        with open(OUTPUT) as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        print(f"Warning: baseline corrupt or unreadable: {e}", file=sys.stderr)
        return {}, None, False

    # Check schema version
    if data.get("schemaVersion") != SCHEMA_VERSION:
        print(f"Baseline schema version mismatch (got {data.get('schemaVersion')}, "
              f"need {SCHEMA_VERSION}), forcing full rebuild")
        return {}, None, False

    # Parse generated timestamp
    generated_ts = None
    generated_str = data.get("generated", "")
    if generated_str:
        try:
            generated_ts = datetime.fromisoformat(generated_str.replace("Z", "+00:00"))
        except ValueError:
            pass

    # Check staleness (>7 days = force full rebuild)
    if generated_ts:
        age_days = (datetime.now(timezone.utc) - generated_ts).total_seconds() / 86400
        if age_days > 7:
            print(f"Baseline is {age_days:.0f} days old, forcing full rebuild")
            return {}, None, False

    # Extract TM projects by sourceId
    tm_by_id = {}
    for p in data.get("projects", []):
        if p.get("tool") == "tm" and p.get("sourceId") is not None:
            tm_by_id[str(p["sourceId"])] = p

    print(f"Loaded baseline: {len(tm_by_id)} TM projects (generated {generated_str})")
    return tm_by_id, generated_ts, True


def main():
    full_rebuild = "--full" in sys.argv

    thread_local = threading.local()

    def get_s3():
        if not hasattr(thread_local, "s3"):
            thread_local.s3 = boto3.client("s3", region_name="us-east-1")
        return thread_local.s3

    s3 = boto3.client("s3", region_name="us-east-1")

    # List all S3 keys with their LastModified timestamps
    print("Listing project files on S3...", flush=True)
    s3_objects = {}  # key -> LastModified
    paginator = s3.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=BUCKET, Prefix=PREFIX):
        for obj in page.get("Contents", []):
            s3_objects[obj["Key"]] = obj["LastModified"]

    s3_ids = {extract_project_id(k) for k in s3_objects}
    print(f"Found {len(s3_objects)} project files on S3", flush=True)

    # Decide: incremental or full
    baseline, baseline_ts, baseline_valid = {}, None, False
    if not full_rebuild:
        baseline, baseline_ts, baseline_valid = load_baseline()

    if not baseline_valid:
        full_rebuild = True

    if full_rebuild:
        keys_to_fetch = list(s3_objects.keys())
        print(f"Full rebuild: fetching all {len(keys_to_fetch)} projects")
    else:
        # Compute watermark: baseline timestamp minus overlap buffer
        watermark = baseline_ts - timedelta(hours=OVERLAP_BUFFER_HOURS)
        baseline_ids = set(baseline.keys())

        # Fetch: recently modified OR missing from baseline
        keys_to_fetch = []
        modified_count = 0
        missing_count = 0
        for key, last_modified in s3_objects.items():
            pid = extract_project_id(key)
            if last_modified >= watermark:
                keys_to_fetch.append(key)
                modified_count += 1
            elif pid not in baseline_ids:
                keys_to_fetch.append(key)
                missing_count += 1

        # Detect deletions
        deleted_ids = baseline_ids - s3_ids
        if deleted_ids:
            print(f"  {len(deleted_ids)} projects deleted from S3, removing from baseline")
            for did in deleted_ids:
                baseline.pop(did, None)

        print(f"Incremental: {len(keys_to_fetch)} to fetch "
              f"({modified_count} modified since {watermark.isoformat()}, "
              f"{missing_count} missing from baseline, "
              f"{len(deleted_ids)} deleted)")

    # Fetch and process
    t0 = time.time()
    fetched = []
    errors = 0
    done = 0

    def fetch_and_summarize(key):
        resp = get_s3().get_object(Bucket=BUCKET, Key=key)
        details = json.loads(resp["Body"].read())
        return build_summary(details)

    if keys_to_fetch:
        with ThreadPoolExecutor(max_workers=20) as pool:
            futures = {pool.submit(fetch_and_summarize, k): k for k in keys_to_fetch}
            for future in as_completed(futures):
                done += 1
                if done % 500 == 0 or done == 1 or done == len(keys_to_fetch):
                    elapsed = time.time() - t0
                    rate = done / elapsed if elapsed > 0 else 0
                    eta = (len(keys_to_fetch) - done) / rate if rate > 0 else 0
                    print(
                        f"  {done}/{len(keys_to_fetch)} ({rate:.0f}/s, ETA {eta:.0f}s)...",
                        flush=True,
                    )
                try:
                    summary = future.result()
                    if summary["uid"] is not None:
                        fetched.append(summary)
                except Exception as e:
                    errors += 1
                    if errors <= 5:
                        print(f"  Error on {futures[future]}: {e}", file=sys.stderr)

    fetch_elapsed = time.time() - t0

    # Build final TM project list
    if full_rebuild:
        projects = [p for p in fetched if p["uid"] is not None]
    else:
        # Upsert fetched projects into baseline
        for p in fetched:
            sid = str(p["sourceId"])
            baseline[sid] = p
        projects = list(baseline.values())

    tm_count = len(projects)
    print(f"\nTM: {tm_count} projects ({len(fetched)} fetched, "
          f"{errors} errors, {fetch_elapsed:.1f}s)")

    # Merge MapSwipe data if available
    mapswipe_file = OUTPUT.parent / "mapswipe_summary.json"
    ms_count = 0
    ms_stale = False
    if mapswipe_file.exists():
        try:
            with open(mapswipe_file) as f:
                ms_data = json.load(f)
            ms_projects = ms_data.get("projects", [])

            # Check staleness
            ms_generated = ms_data.get("generated", "")
            if ms_generated:
                try:
                    ms_ts = datetime.fromisoformat(ms_generated.replace("Z", "+00:00"))
                    age_hours = (datetime.now(timezone.utc) - ms_ts).total_seconds() / 3600
                    if age_hours > 48:
                        ms_stale = True
                        print(
                            f"\n** WARNING: MapSwipe data is {age_hours:.0f}h old "
                            f"(generated {ms_generated}). Fetch may have failed. **",
                            file=sys.stderr,
                        )
                except ValueError:
                    pass

            projects.extend(ms_projects)
            ms_count = len(ms_projects)
            print(f"MapSwipe: {ms_count} projects" +
                  (" (STALE)" if ms_stale else ""))
        except Exception as e:
            print(f"\nWarning: could not load MapSwipe data: {e}", file=sys.stderr)
    else:
        print("No MapSwipe data found (docs/mapswipe_summary.json), TM only")

    # Sort after merge
    projects.sort(key=lambda p: (p.get("tool", "tm"), str(p.get("sourceId", ""))))

    output = {
        "schemaVersion": SCHEMA_VERSION,
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "totalProjects": len(projects),
        "projects": projects,
    }

    # Write via temp file + rename to avoid corrupt baselines
    tmp_fd, tmp_path = tempfile.mkstemp(
        dir=OUTPUT.parent, suffix=".json", prefix=".projects_summary_"
    )
    try:
        with open(tmp_fd, "w") as f:
            json.dump(output, f)
        Path(tmp_path).replace(OUTPUT)
    except Exception:
        Path(tmp_path).unlink(missing_ok=True)
        raise

    print(f"\nDone. {len(projects)} projects written to {OUTPUT}")
    print(f"  TM: {tm_count}, MapSwipe: {ms_count}, Errors: {errors}")

    # Quick stats
    by_imagery = {}
    for p in projects:
        by_imagery[p["imagery"]] = by_imagery.get(p["imagery"], 0) + 1
    print("\nImagery breakdown:")
    for img, count in sorted(by_imagery.items(), key=lambda x: -x[1]):
        print(f"  {img}: {count}")


if __name__ == "__main__":
    main()
