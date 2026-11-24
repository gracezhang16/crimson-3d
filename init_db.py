"""Build a fresh crimson3d.db from schema.sql and the files in seed/.

Usage:
    python init_db.py

WARNING: this deletes the existing database first. The database path comes
from the CRIMSON3D_DB environment variable (default sqlite:///crimson3d.db),
the same one helpers.py uses, so tests can build a throwaway copy.

S8 adds a --demo-users option for showcase accounts.
"""

import json
import os
import sqlite3
import sys
from pathlib import Path

from cs50 import SQL

from geometry import validate_suite

ROOT = Path(__file__).parent
SCHEMA = ROOT / "schema.sql"
FURNITURE_FILE = ROOT / "seed" / "furniture.json"
SUITES_DIR = ROOT / "seed" / "suites"

DEFAULT_URL = "sqlite:///crimson3d.db"
SQLITE_PREFIX = "sqlite:///"


def build_database(url):
    """Delete the database at `url`, recreate it from schema.sql, and load seed/."""
    if not url.startswith(SQLITE_PREFIX):
        sys.exit(f"Expected a {SQLITE_PREFIX}... database URL, got {url!r}")
    path = Path(url[len(SQLITE_PREFIX):])
    path.unlink(missing_ok=True)

    # cs50.SQL runs one statement per call, so the multi-statement schema file
    # goes through Python's built-in sqlite3 module instead. (This also creates
    # the file, which cs50.SQL insists already exists.)
    with sqlite3.connect(path) as connection:
        connection.executescript(SCHEMA.read_text())
    connection.close()

    db = SQL(url)
    slugs = load_furniture(db)
    for suite_file in sorted(SUITES_DIR.glob("*.json")):
        load_suite_type(db, suite_file, slugs)


def load_furniture(db):
    """Insert the furniture catalog. Returns a dict mapping slug -> furniture id."""
    slugs = {}
    for item in json.loads(FURNITURE_FILE.read_text()):
        slugs[item["slug"]] = db.execute(
            "INSERT INTO furniture (slug, name, category, width, depth, height, clearance, color, note) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            item["slug"], item["name"], item["category"], item["width"], item["depth"],
            item["height"], item["clearance"], item["color"], item["note"],
        )
    print(f"Loaded {len(slugs)} furniture items")
    return slugs


def load_suite_type(db, room_file, slugs):
    """Insert one seed/suites/*.json file: its dorm (if new), suite type and default layout."""
    room = json.loads(room_file.read_text())

    # Refuse to load a suite the planner could not draw.
    errors = validate_suite(room["geometry"])
    if errors:
        sys.exit(f"{room_file.name} has an invalid geometry:\n  " + "\n  ".join(errors))

    dorm_id = get_or_create_dorm(db, room["dorm"])
    type_id = db.execute(
        "INSERT INTO suite_types (dorm_id, name, capacity, bathroom, geometry, status, "
        "measured_by, measured_on, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        dorm_id, room["name"], room["capacity"], room["bathroom"], json.dumps(room["geometry"]),
        room["status"], room["measured_by"], room["measured_on"], room["notes"],
    )

    # A room type's default layout is the layouts row with no owner (SPEC.md 5).
    layout_id = db.execute(
        "INSERT INTO layouts (user_id, suite_type_id, name, is_default) VALUES (NULL, ?, ?, 1)",
        type_id, "Default layout",
    )
    for placement in room["default_layout"]:
        if placement["slug"] not in slugs:
            sys.exit(f"{room_file.name}: unknown furniture slug {placement['slug']!r}")
        db.execute(
            "INSERT INTO placements (layout_id, furniture_id, x, y, rotation) VALUES (?, ?, ?, ?, ?)",
            layout_id, slugs[placement["slug"]], placement["x"], placement["y"], placement["rotation"],
        )
    print(f"Loaded {room['dorm']}: {room['name']} ({len(room['default_layout'])} items)")


def get_or_create_dorm(db, name):
    """Return the id of the dorm called `name`, inserting it if it is new."""
    rows = db.execute("SELECT id FROM dorms WHERE name = ?", name)
    if rows:
        return rows[0]["id"]
    return db.execute("INSERT INTO dorms (name) VALUES (?)", name)


if __name__ == "__main__":
    build_database(os.environ.get("CRIMSON3D_DB", DEFAULT_URL))
