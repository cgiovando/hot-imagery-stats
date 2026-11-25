#!/usr/bin/env python3
"""Generate docs/projects_summary.json from R2-cached project data.

Reads individual project JSONs from the insta-tm R2 bucket (api/v2/projects/),
populated daily by the insta-tm ETL, extracts summary fields, merges MapSwipe
and fAIr summaries, flags excluded projects, and writes the dashboard data file.

Incremental mode (default): loads the previously committed summary as
a baseline, then fetches only projects that are new or modified since
the last run. Falls back to full rebuild if the baseline is missing,
too old, or has a different schema version.

Usage:
    python scripts/generate_summary.py          # incremental (default)
    python scripts/generate_summary.py --full   # force full rebuild
    python scripts/generate_summary.py --force  # bypass the drop guard

Requires S3_ENDPOINT_URL (R2 endpoint) plus AWS_ACCESS_KEY_ID /
AWS_SECRET_ACCESS_KEY in the environment.
"""

import json
import os
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from pathlib import Path

import boto3
import requests
from pyproj import Geod
from shapely.geometry import shape

from drivers import DRIVERS, classify_project, match_text
from common import (
    MAX_AREA_SQKM,
    atomic_json_write,
    check_drop,
    load_json,
    normalize_lonlat,
)

BUCKET = "insta-tm"
PREFIX = "api/v2/projects/"
DOCS = Path(__file__).resolve().parent.parent / "docs"
OUTPUT = DOCS / "projects_summary.json"
TM_PROJECT_URL = (
    "https://tasking-manager-tm4-production-api.hotosm.org/api/v2/projects/{}/"
    "?as_file=false&abbreviated=true"
)
TM_STATS_URL = (
    "https://tasking-manager-tm4-production-api.hotosm.org/api/v2/projects/{}/statistics/"
)

GEOD = Geod(ellps="WGS84")

# Bump this when the output schema changes to force a full rebuild
SCHEMA_VERSION = 6

# How far back to look beyond the baseline timestamp to catch stragglers
OVERLAP_BUFFER_HOURS = 24

# Data files older than this are reported as stale
STALE_HOURS = 48

IMAGERY_PATTERNS = [
    (re.compile(r"bing", re.IGNORECASE), "Bing"),
    (re.compile(r"esri|world\.imagery|arcgis", re.IGNORECASE), "Esri"),
    (re.compile(r"mapbox", re.IGNORECASE), "Mapbox"),
    (re.compile(r"maxar|digitalglobe|vivid|securewatch", re.IGNORECASE), "Maxar"),
]

OAM_RE = re.compile(r"openaerialmap|oam|open\.aerial", re.IGNORECASE)
OAM_PATH_RE = re.compile(r"tiles\.openaerialmap\.org/([^/]+/\d+/[^/]+)")

OAM_PLATFORM_MAP = {
    "uav": "OAM Drone",
    "satellite": "OAM Satellite",
    "aircraft": "OAM Aircraft",
}

# Loaded once in main(), shared via module-level variable
_oam_cache = {}


def classify_oam(oam_path):
    """Map an OAM TMS path to an OAM platform category via the cache."""
    if oam_path and oam_path in _oam_cache:
        platform = _oam_cache[oam_path].get("platform") or ""
        return OAM_PLATFORM_MAP.get(platform.lower(), "OAM Unknown")
    return "OAM Unknown"


def extract_oam_path(raw):
    """Return the OAM image path from an imagery string, or None.

    Only this identifier is stored, never the raw imagery URL, because raw
    TM imagery strings can embed third-party access tokens.
    """
    if not raw:
        return None
    m = OAM_PATH_RE.search(raw)
    return m.group(1) if m else None


def normalize_imagery(raw):
    if not raw or raw.strip() == "":
        return "Not specified"
    raw_stripped = raw.strip()

    # OAM URLs: classify by platform via the cached OAM catalog
    if OAM_RE.search(raw_stripped):
        return classify_oam(extract_oam_path(raw_stripped))

    # Known basemap providers
    for pattern, category in IMAGERY_PATTERNS:
        if pattern.search(raw_stripped):
            return category

    # Other custom TMS URLs
    if re.search(r"custom", raw_stripped, re.IGNORECASE):
        return "Custom"
    if raw_stripped.startswith(("http://", "https://", "tms[")):
        return "Custom"
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
        c = shape(geojson_geometry).centroid
        return normalize_lonlat(c.x, c.y)
    except Exception:
        return None


def build_summary(details):
    project_id = details.get("projectId")
    aoi = details.get("areaOfInterest")
    country_tag = details.get("countryTag", []) or []
    project_info = details.get("projectInfo", {}) or {}
    raw_imagery = details.get("imagery")

    return {
        "uid": f"tm-{project_id}" if project_id else None,
        "sourceId": project_id,
        "name": project_info.get("name", ""),
        "tool": "tm",
        "toolLabel": "Tasking Manager",
        "status": details.get("status"),
        "imagery": normalize_imagery(raw_imagery),
        "oamPath": extract_oam_path(raw_imagery),
        "country": country_tag,
        "org": details.get("organisationName", ""),
        "created": (details.get("created") or "")[:10],
        "mappingTypes": details.get("mappingTypes", []),
        "areaSqKm": compute_area_sqkm(aoi) if aoi else None,
        "centroid": compute_centroid(aoi) if aoi else None,
        "projectUrl": f"https://tasks.hotosm.org/projects/{project_id}" if project_id else None,
        "projectType": None,
        "contributors": None,
        "timeSpentSec": None,
        "results": None,
        "pctMapped": details.get("percentMapped"),
        "pctValidated": details.get("percentValidated"),
        "difficulty": details.get("difficulty"),
        "priority": details.get("projectPriority"),
        # Drivers found in the short description (the description itself is
        # not stored). Campaigns/interests are not in the R2 mirror and are
        # filled from the TM API by fetch_tm_meta().
        "descDrivers": sorted(match_text(project_info.get("shortDescription"))),
        "campaigns": None,
        "interests": None,
    }


def fetch_tm_activity(projects):
    """Fill contributors/timeSpentSec from the TM statistics endpoint.

    Only called for projects at 0% mapped: TM's percentMapped can read 0 even
    after substantial work (e.g. tasks later reset), so mapper count and time
    spent decide whether a project was ever actually worked on.
    """
    if not projects:
        return 0
    session = requests.Session()
    failures = 0

    def fetch(p):
        for attempt in range(3):
            try:
                r = session.get(TM_STATS_URL.format(p["sourceId"]), timeout=30)
                if r.ok:
                    d = r.json()
                    return p, d.get("totalMappers"), d.get("totalTimeSpent")
            except (requests.RequestException, ValueError):
                pass
            time.sleep(1 + attempt)
        return p, None, None

    print(f"Fetching TM activity stats for {len(projects)} projects at 0% mapped...", flush=True)
    with ThreadPoolExecutor(max_workers=8) as pool:
        for p, mappers, seconds in pool.map(fetch, projects):
            if mappers is None:
                failures += 1
                continue
            p["contributors"] = int(mappers)
            p["timeSpentSec"] = round(float(seconds or 0))
    if failures:
        print(f"  {failures} activity lookups failed (left unknown, not excluded)", file=sys.stderr)
    return failures


def fetch_tm_meta(projects):
    """Fill campaigns/interests (name lists) from the TM project endpoint."""
    if not projects:
        return 0
    session = requests.Session()
    failures = 0

    def fetch(p):
        for attempt in range(3):
            try:
                r = session.get(TM_PROJECT_URL.format(p["sourceId"]), timeout=60)
                if r.ok:
                    d = json.loads(r.text, strict=False)
                    return (p, [c["name"].strip() for c in d.get("campaigns") or [] if c.get("name")],
                            [i["name"] for i in d.get("interests") or [] if i.get("name")])
            except (requests.RequestException, ValueError, KeyError, TypeError):
                pass
            time.sleep(1 + attempt)
        return p, None, None

    print(f"Fetching TM campaigns/interests for {len(projects)} projects...", flush=True)
    with ThreadPoolExecutor(max_workers=8) as pool:
        for done, (p, campaigns, interests) in enumerate(pool.map(fetch, projects), 1):
            if campaigns is None:
                failures += 1
            else:
                p["campaigns"], p["interests"] = campaigns, interests
            if done % 2000 == 0:
                print(f"  {done}/{len(projects)}...", flush=True)
    if failures:
        print(f"  {failures} metadata lookups failed (retried next run)", file=sys.stderr)
    return failures


def exclusion_reason(p):
    """Why a project is left out of default views, or None to include it.

    - area_over_1m_km2: AOIs over 1M km2 are world/country-scale artifacts.
    - no_activity: zero progress and nobody ever worked on it, so no imagery
      was consumed. TM needs both 0 mappers and 0 time spent; unknown
      activity (failed lookup) is never excluded.
    """
    if (p.get("areaSqKm") or 0) > MAX_AREA_SQKM:
        return "area_over_1m_km2"
    tool = p.get("tool")
    if tool == "tm":
        if p.get("pctMapped") == 0 and p.get("contributors") == 0 and p.get("timeSpentSec") == 0:
            return "no_activity"
    elif tool == "mapswipe":
        if not p.get("pctMapped") and p.get("contributors") == 0:
            return "no_activity"
    return None


def extract_project_id(key):
    """Extract numeric project ID from an R2 key like 'api/v2/projects/12345.json'."""
    name = key.rsplit("/", 1)[-1]
    return name.replace(".json", "")


def parse_ts(value):
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")) if value else None
    except ValueError:
        return None


def load_baseline(data):
    """Return (tm_projects_by_id, generated_ts, valid) from the previous summary."""
    if data is None:
        return {}, None, False

    if data.get("schemaVersion") != SCHEMA_VERSION:
        print(f"Baseline schema version mismatch (got {data.get('schemaVersion')}, "
              f"need {SCHEMA_VERSION}), forcing full rebuild")
        return {}, None, False

    generated_ts = parse_ts(data.get("generated", ""))
    if generated_ts:
        age_days = (datetime.now(timezone.utc) - generated_ts).total_seconds() / 86400
        if age_days > 7:
            print(f"Baseline is {age_days:.0f} days old, forcing full rebuild")
            return {}, None, False

    tm_by_id = {
        str(p["sourceId"]): p
        for p in data.get("projects", [])
        if p.get("tool") == "tm" and p.get("sourceId") is not None
    }
    print(f"Loaded baseline: {len(tm_by_id)} TM projects (generated {data.get('generated')})")
    return tm_by_id, generated_ts, True


def load_tool_summary(path, label):
    """Load a MapSwipe/fAIr summary file, warning if it is stale."""
    data = load_json(path)
    if data is None:
        print(f"No {label} data found ({path.name}), skipping")
        return []
    projects = data.get("projects", [])
    ts = parse_ts(data.get("generated", ""))
    stale = ""
    if ts:
        age_hours = (datetime.now(timezone.utc) - ts).total_seconds() / 3600
        if age_hours > STALE_HOURS:
            stale = " (STALE)"
            print(f"\n** WARNING: {label} data is {age_hours:.0f}h old "
                  f"(generated {data.get('generated')}). Fetch may have failed. **",
                  file=sys.stderr)
    print(f"{label}: {len(projects)} projects{stale}")
    return projects


def main():
    global _oam_cache
    full_rebuild = "--full" in sys.argv
    force = "--force" in sys.argv

    endpoint = os.environ.get("S3_ENDPOINT_URL")
    if not endpoint:
        sys.exit("S3_ENDPOINT_URL is not set (R2 endpoint for the insta-tm bucket)")

    _oam_cache = load_json(DOCS / "oam_platform_cache.json") or {}
    print(f"Loaded OAM platform cache: {len(_oam_cache)} entries")

    previous = load_json(OUTPUT)
    prev_tm_count = sum(1 for p in (previous or {}).get("projects", []) if p.get("tool") == "tm")
    # Campaigns/interests from the previous output (any schema version), so a
    # full rebuild only re-fetches projects that changed since then.
    prev_meta = {
        str(p["sourceId"]): (p["campaigns"], p.get("interests") or [])
        for p in (previous or {}).get("projects", [])
        if p.get("tool") == "tm" and p.get("campaigns") is not None
    }
    prev_ts = parse_ts((previous or {}).get("generated", ""))

    thread_local = threading.local()

    def get_s3():
        if not hasattr(thread_local, "s3"):
            thread_local.s3 = boto3.client("s3", region_name="auto", endpoint_url=endpoint)
        return thread_local.s3

    # List all R2 keys with their LastModified timestamps
    print("Listing project files on R2...", flush=True)
    s3_objects = {}
    paginator = get_s3().get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=BUCKET, Prefix=PREFIX):
        for obj in page.get("Contents", []):
            s3_objects[obj["Key"]] = obj["LastModified"]
    s3_ids = {extract_project_id(k) for k in s3_objects}
    print(f"Found {len(s3_objects)} project files on R2", flush=True)

    # An empty or truncated listing would otherwise read as mass deletion
    check_drop("R2 project listing", prev_tm_count, len(s3_objects), force)

    baseline, baseline_ts, baseline_valid = {}, None, False
    if not full_rebuild:
        baseline, baseline_ts, baseline_valid = load_baseline(previous)
    if not baseline_valid:
        full_rebuild = True

    if full_rebuild:
        keys_to_fetch = list(s3_objects.keys())
        print(f"Full rebuild: fetching all {len(keys_to_fetch)} projects")
    else:
        watermark = baseline_ts - timedelta(hours=OVERLAP_BUFFER_HOURS)
        baseline_ids = set(baseline.keys())
        keys_to_fetch = []
        modified_count = missing_count = 0
        for key, last_modified in s3_objects.items():
            pid = extract_project_id(key)
            if last_modified >= watermark:
                keys_to_fetch.append(key)
                modified_count += 1
            elif pid not in baseline_ids:
                keys_to_fetch.append(key)
                missing_count += 1

        deleted_ids = baseline_ids - s3_ids
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

    def fetch_and_summarize(key):
        resp = get_s3().get_object(Bucket=BUCKET, Key=key)
        return build_summary(json.loads(resp["Body"].read()))

    if keys_to_fetch:
        with ThreadPoolExecutor(max_workers=20) as pool:
            futures = {pool.submit(fetch_and_summarize, k): k for k in keys_to_fetch}
            for done, future in enumerate(as_completed(futures), 1):
                if done % 2000 == 0 or done == len(keys_to_fetch):
                    print(f"  {done}/{len(keys_to_fetch)}...", flush=True)
                try:
                    summary = future.result()
                    if summary["uid"] is not None:
                        fetched.append(summary)
                except Exception as e:
                    errors += 1
                    if errors <= 5:
                        print(f"  Error on {futures[future]}: {e}", file=sys.stderr)

    if full_rebuild:
        projects = fetched
    else:
        for p in fetched:
            baseline[str(p["sourceId"])] = p
        projects = list(baseline.values())

    # Activity stats for projects at 0% mapped that don't have them yet:
    # freshly fetched ones, plus earlier lookups that failed. Unchanged
    # projects keep earlier values; a project that gets worked on changes
    # on R2 and is refetched (and re-checked) here.
    fetch_tm_activity(
        [p for p in projects if p.get("pctMapped") == 0 and p.get("contributors") is None]
    )

    # Campaigns/interests: reuse earlier values for projects unchanged on R2
    # since the previous output, fetch the rest (new, changed, or failed).
    modified_since = {}
    for key, last_modified in s3_objects.items():
        modified_since[extract_project_id(key)] = last_modified
    cutoff = prev_ts - timedelta(hours=OVERLAP_BUFFER_HOURS) if prev_ts else None
    need_meta = []
    for p in projects:
        if p.get("campaigns") is not None:
            continue
        sid = str(p["sourceId"])
        lm = modified_since.get(sid)
        if sid in prev_meta and cutoff and lm and lm < cutoff:
            p["campaigns"], p["interests"] = prev_meta[sid]
        else:
            need_meta.append(p)
    fetch_tm_meta(need_meta)

    # Re-classify OAM imagery for every TM project with the current cache, so
    # unchanged projects pick up newly catalogued OAM images too.
    reclassified = 0
    for p in projects:
        if p.get("oamPath"):
            new = classify_oam(p["oamPath"])
            if new != p["imagery"]:
                p["imagery"] = new
                reclassified += 1

    tm_count = len(projects)
    check_drop("TM projects", prev_tm_count, tm_count, force)
    print(f"\nTM: {tm_count} projects ({len(fetched)} fetched, {errors} errors, "
          f"{time.time() - t0:.1f}s, {reclassified} OAM reclassified)")

    ms_projects = load_tool_summary(DOCS / "mapswipe_summary.json", "MapSwipe")
    fair_projects = load_tool_summary(DOCS / "fair_summary.json", "fAIr")
    projects.extend(ms_projects)
    projects.extend(fair_projects)

    for p in projects:
        classify_project(p)
        reason = exclusion_reason(p)
        p["excluded"] = reason is not None
        p["excludedReason"] = reason

    projects.sort(key=lambda p: (p.get("tool", "tm"), str(p.get("sourceId", ""))))

    output = {
        "schemaVersion": SCHEMA_VERSION,
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "totalProjects": len(projects),
        "driverLabels": DRIVERS,
        "projects": projects,
    }
    atomic_json_write(OUTPUT, output)

    print(f"\nDone. {len(projects)} projects written to {OUTPUT}")
    print(f"  TM: {tm_count}, MapSwipe: {len(ms_projects)}, fAIr: {len(fair_projects)}, "
          f"Errors: {errors}")

    excluded = {}
    for p in projects:
        if p["excluded"]:
            key = (p["tool"], p["excludedReason"])
            excluded[key] = excluded.get(key, 0) + 1
    print("\nExcluded from default views:")
    for (tool, reason), n in sorted(excluded.items()):
        print(f"  {tool} {reason}: {n}")

    by_driver = {}
    for p in projects:
        for d in p["drivers"]:
            by_driver[d] = by_driver.get(d, 0) + 1
    print("\nDrivers (primary):")
    for d, n in sorted(by_driver.items(), key=lambda x: -x[1]):
        print(f"  {d}: {n}")
    print(f"  (no primary driver: {sum(1 for p in projects if not p['drivers'])})")

    by_imagery = {}
    for p in projects:
        by_imagery[p["imagery"]] = by_imagery.get(p["imagery"], 0) + 1
    print("\nImagery breakdown:")
    for img, count in sorted(by_imagery.items(), key=lambda x: -x[1]):
        print(f"  {img}: {count}")


if __name__ == "__main__":
    main()
