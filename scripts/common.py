"""Shared helpers for the data pipeline scripts."""

import json
import math
import sys
import tempfile
from pathlib import Path

# Refuse to overwrite a data file if a source suddenly returns fewer records
# than this share of the previous run (override with --force).
DROP_GUARD_RATIO = 0.9

# Projects larger than this are excluded from default views (data artifacts
# such as world-scale or country-scale AOIs that were never mapped as drawn).
MAX_AREA_SQKM = 1_000_000


def atomic_json_write(path, data, compact=False):
    """Write JSON via a temp file in the same directory, then rename."""
    path = Path(path)
    tmp_fd, tmp_path = tempfile.mkstemp(
        dir=path.parent, suffix=".json", prefix=f".{path.stem}_"
    )
    try:
        with open(tmp_fd, "w") as f:
            if compact:
                json.dump(data, f, separators=(",", ":"))
            else:
                json.dump(data, f)
        Path(tmp_path).replace(path)
    except BaseException:
        Path(tmp_path).unlink(missing_ok=True)
        raise


def load_json(path):
    """Load a JSON file, returning None if missing or unreadable."""
    path = Path(path)
    if not path.exists():
        return None
    try:
        with open(path) as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        print(f"Warning: {path.name} unreadable: {e}", file=sys.stderr)
        return None


def normalize_lonlat(lon, lat):
    """Return [lon, lat] rounded to 4 decimals with lon wrapped into [-180, 180].

    Only wraps longitudes up to 540 degrees off; anything larger (or a bad
    latitude) is treated as a broken geometry and returns None.
    """
    try:
        lon, lat = float(lon), float(lat)
    except (TypeError, ValueError):
        return None
    if not (math.isfinite(lon) and math.isfinite(lat)) or abs(lat) > 90 or abs(lon) > 540:
        return None
    if lon < -180 or lon > 180:
        lon = ((lon + 180) % 360) - 180
    return [round(lon, 4), round(lat, 4)]


def to_int(value):
    """Coerce API values that may arrive as strings to int (None if empty)."""
    if value is None or value == "":
        return None
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def check_drop(label, previous, current, force=False):
    """Abort (exit 2) if `current` fell below DROP_GUARD_RATIO of `previous`."""
    if force or not previous:
        return
    if current < previous * DROP_GUARD_RATIO:
        print(
            f"\n** DROP GUARD: {label} fell from {previous} to {current} "
            f"(< {DROP_GUARD_RATIO:.0%}). Refusing to write. Re-run with --force "
            f"if this is expected. **",
            file=sys.stderr,
        )
        sys.exit(2)
