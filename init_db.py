"""Build a fresh crimson3d.db from schema.sql and the files in seed/.

Usage:
    python init_db.py                # schema + seed/ only
    python init_db.py --demo-users   # also three invented student accounts

WARNING: this deletes the existing database first. The database path comes
from the CRIMSON3D_DB environment variable (default sqlite:///crimson3d.db),
the same one helpers.py uses, so tests can build a throwaway copy.

seed/ is what `python export_rooms.py` writes, so the two together rebuild a
site with every real suite measured so far.
"""

import argparse
import json
import os
import secrets
import sqlite3
import sys
from pathlib import Path

from cs50 import SQL
from werkzeug.security import generate_password_hash

from geometry import validate_suite

ROOT = Path(__file__).parent
SCHEMA = ROOT / "schema.sql"
SEED_DIR = ROOT / "seed"

# --demo-users: invented accounts and invented suite numbers in the sample
# dorm, for the showcase. Never real names or real housing assignments.
DEMO_DORM = "Demo Hall"
DEMO_SUITES = {"D-101": "Single (sample)", "D-201": "Two-bedroom suite (sample)"}
DEMO_ACCOUNTS = [  # (email, suite number or None for "not assigned yet")
    ("demo1@example.com", "D-101"),
    ("demo2@example.com", "D-201"),
    ("demo3@example.com", None),
]

DEFAULT_URL = "sqlite:///crimson3d.db"
SQLITE_PREFIX = "sqlite:///"


def build_database(url, seed_dir=SEED_DIR, demo_users=False):
    """Delete the database at `url`, recreate it from schema.sql, and load `seed_dir`.

    With demo_users=True, also add the showcase accounts and return them as a
    list of (email, password, suite number or None); otherwise return [].
    """
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
    seed_dir = Path(seed_dir)
    load_dorms(db, seed_dir / "dorms.json")
    slugs = load_furniture(db, seed_dir / "furniture.json")
    for suite_file in sorted((seed_dir / "suites").glob("*.json")):
        load_suite_type(db, suite_file, slugs)
    return add_demo_users(db) if demo_users else []


def load_dorms(db, dorms_file):
    """Insert the dorms with their yard and description, if the file exists.

    Suite files name their dorm too, so a dorm missing here is still created
    (with no yard or description) by load_suite_type.
    """
    if not dorms_file.exists():
        return
    for dorm in json.loads(dorms_file.read_text()):
        db.execute(
            "INSERT INTO dorms (name, yard, description) VALUES (?, ?, ?)",
            dorm["name"], dorm.get("yard"), dorm.get("description"),
        )


def load_furniture(db, furniture_file):
    """Insert the furniture catalog. Returns a dict mapping slug -> furniture id."""
    slugs = {}
    for item in json.loads(furniture_file.read_text()):
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
        insert_seed_placement(db, room_file, layout_id, placement, slugs)
    print(f"Loaded {room['dorm']}: {room['name']} ({len(room['default_layout'])} items)")


def insert_seed_placement(db, room_file, layout_id, placement, slugs):
    """Insert one default-layout item: catalog furniture by "slug", or a
    custom item (no slug) with its own "label", "width", "depth" and "height"."""
    if "slug" in placement:
        if placement["slug"] not in slugs:
            sys.exit(f"{room_file.name}: unknown furniture slug {placement['slug']!r}")
        db.execute(
            "INSERT INTO placements (layout_id, furniture_id, x, y, rotation) VALUES (?, ?, ?, ?, ?)",
            layout_id, slugs[placement["slug"]], placement["x"], placement["y"], placement["rotation"],
        )
    else:
        db.execute(
            "INSERT INTO placements (layout_id, furniture_id, label, width, depth, height, x, y, rotation) "
            "VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?)",
            layout_id, placement["label"], placement["width"], placement["depth"], placement["height"],
            placement["x"], placement["y"], placement["rotation"],
        )


def add_demo_users(db):
    """Add the showcase accounts, each with a fresh random password.

    Demo Hall gets invented suite numbers (DEMO_SUITES) so an assigned demo
    student can show "My suite". A suite type missing from seed/ is skipped,
    and its student is left unassigned.
    Returns a list of (email, password, suite number or None).
    """
    suite_ids = {}
    for number, type_name in DEMO_SUITES.items():
        rows = db.execute(
            "SELECT suite_types.id, suite_types.dorm_id FROM suite_types "
            "JOIN dorms ON dorms.id = suite_types.dorm_id WHERE dorms.name = ? AND suite_types.name = ?",
            DEMO_DORM, type_name,
        )
        if rows:
            suite_ids[number] = db.execute(
                "INSERT INTO suites (dorm_id, number, suite_type_id) VALUES (?, ?, ?)",
                rows[0]["dorm_id"], number, rows[0]["id"],
            )

    accounts = []
    for email, number in DEMO_ACCOUNTS:
        # token_urlsafe(8): 8 random bytes as 11 letters, digits, "-" and "_".
        password = secrets.token_urlsafe(8)
        user_id = db.execute(
            "INSERT INTO users (email, hash) VALUES (?, ?)", email, generate_password_hash(password)
        )
        if number not in suite_ids:
            number = None
        else:
            db.execute("INSERT INTO assignments (user_id, suite_id) VALUES (?, ?)", user_id, suite_ids[number])
        accounts.append((email, password, number))
    return accounts


def print_demo_users(accounts):
    """Print the showcase logins. They are only shown here, so note them down."""
    print("\nDemo accounts (invented; passwords change every time you rebuild):")
    for email, password, number in accounts:
        where = f"{DEMO_DORM} {number}" if number else "no suite assigned"
        print(f"  {email:20}  {password}  ({where})")


def get_or_create_dorm(db, name):
    """Return the id of the dorm called `name`, inserting it if it is new."""
    rows = db.execute("SELECT id FROM dorms WHERE name = ?", name)
    if rows:
        return rows[0]["id"]
    return db.execute("INSERT INTO dorms (name) VALUES (?)", name)


if __name__ == "__main__":
    # argparse (Python's standard library) reads options like --demo-users
    # from the command line and writes the --help text for us.
    parser = argparse.ArgumentParser(description="Build a fresh database from schema.sql and seed/.")
    parser.add_argument("--demo-users", action="store_true",
                        help="also add three invented student accounts for the showcase")
    options = parser.parse_args()
    accounts = build_database(os.environ.get("CRIMSON3D_DB", DEFAULT_URL), demo_users=options.demo_users)
    if accounts:
        print_demo_users(accounts)
