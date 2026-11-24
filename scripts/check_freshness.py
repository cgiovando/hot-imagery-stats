#!/usr/bin/env python3
"""Fail (exit 1) if any committed data file is older than STALE_HOURS.

Runs as the last CI step, after fresh data has been committed, so a broken
source triggers a failed run (and GitHub's failure email) without blocking
updates from the sources that still work. Uses the `generated` timestamp
embedded in each file, never filesystem mtime.
"""

import sys
from datetime import datetime, timezone
from pathlib import Path

from common import load_json

STALE_HOURS = 48
DOCS = Path(__file__).resolve().parent.parent / "docs"
FILES = {
    "Unified summary": DOCS / "projects_summary.json",
    "MapSwipe": DOCS / "mapswipe_summary.json",
    "fAIr": DOCS / "fair_summary.json",
}


def main():
    now = datetime.now(timezone.utc)
    stale = []
    for label, path in FILES.items():
        data = load_json(path) or {}
        generated = data.get("generated", "")
        try:
            ts = datetime.fromisoformat(generated.replace("Z", "+00:00"))
        except ValueError:
            stale.append(f"{label}: missing or invalid timestamp")
            continue
        age = (now - ts).total_seconds() / 3600
        print(f"{label}: generated {generated} ({age:.0f}h ago)")
        if age > STALE_HOURS:
            stale.append(f"{label}: {age:.0f}h old")
    if stale:
        print("\nStale data (source fetch has been failing):", file=sys.stderr)
        for s in stale:
            print(f"  {s}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
