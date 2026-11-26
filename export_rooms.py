"""Write the database's dorms, furniture catalog and published suite types
back to seed/, so `python init_db.py` can rebuild the same site from scratch.

Usage:
    python export_rooms.py

Then review the changes with `git diff seed/` and commit them. This is how
real suites, measured and built in the admin builder, end up in the
repository (SPEC.md section 5, milestones S8 and A9).

What gets written:
    seed/dorms.json          every dorm with its yard and description
    seed/furniture.json      the whole furniture catalog
    seed/suites/<file>.json  one file per *published* suite type (drafts stay
                             in the database only), with its default layout

A suite type that already has a seed file (matched by dorm and name inside the
file) is written back to that same file; a new one gets a file named after its
dorm and name, e.g. "canaday-hall-four-room-suite.json". Files are only
rewritten when their content changes, and seed files that no longer match any
published suite type are listed but never deleted: you decide.

The output uses the exact JSON layout of the files in seed/, so an export of
an unchanged database changes nothing (tests/test_seed.py checks this).
"""

import json
import os
import re
from pathlib import Path

from cs50 import SQL

ROOT = Path(__file__).parent
SEED_DIR = ROOT / "seed"
DEFAULT_URL = "sqlite:///crimson3d.db"

FURNITURE_FIELDS = ("slug", "name", "category", "width", "depth", "height", "clearance", "color", "note")


def export_seed(db, seed_dir=SEED_DIR):
    """Write dorms, furniture and published suite types from `db` into `seed_dir`.

    Returns a report dict of file names (relative to seed_dir):
        {"changed": [...], "unchanged": [...], "stale": [...]}
    where "stale" lists suite files that match no published suite type.
    """
    seed_dir = Path(seed_dir)
    suites_dir = seed_dir / "suites"
    suites_dir.mkdir(parents=True, exist_ok=True)
    report = {"changed": [], "unchanged": [], "stale": []}

    def save(path, text):
        name = str(path.relative_to(seed_dir))
        if path.exists() and path.read_text() == text:
            report["unchanged"].append(name)
        else:
            path.write_text(text)
            report["changed"].append(name)

    save(seed_dir / "dorms.json", one_per_line(dorm_records(db)))
    save(seed_dir / "furniture.json", one_per_line(furniture_records(db)))

    existing = existing_suite_files(suites_dir)
    written = set()
    for record in suite_type_records(db):
        path = existing.get((record["dorm"], record["name"]))
        if path is None:
            path = new_suite_path(suites_dir, record, taken=written)
        written.add(path)
        # indent=2 matches the hand-written seed files; ensure_ascii=False keeps
        # characters like "×" readable instead of writing "×".
        save(path, json.dumps(record, indent=2, ensure_ascii=False) + "\n")

    report["stale"] = sorted(
        str(path.relative_to(seed_dir)) for path in suites_dir.glob("*.json") if path not in written
    )
    return report


def dorm_records(db):
    """Every dorm as {name, yard, description}, in the order they were added."""
    return db.execute("SELECT name, yard, description FROM dorms ORDER BY id")


def furniture_records(db):
    """The whole furniture catalog, in the order it was added."""
    return db.execute(f"SELECT {', '.join(FURNITURE_FIELDS)} FROM furniture ORDER BY id")


def suite_type_records(db):
    """Every published suite type in the seed file format (SPEC.md section 5)."""
    rows = db.execute(
        "SELECT suite_types.*, dorms.name AS dorm FROM suite_types "
        "JOIN dorms ON dorms.id = suite_types.dorm_id "
        "WHERE suite_types.status = 'published' ORDER BY dorms.name, suite_types.name"
    )
    records = []
    for row in rows:
        records.append({
            "dorm": row["dorm"],
            "name": row["name"],
            "capacity": row["capacity"],
            "bathroom": row["bathroom"],
            "status": row["status"],
            "measured_by": row["measured_by"],
            # str() in case the database driver hands back a date object.
            "measured_on": str(row["measured_on"]) if row["measured_on"] else None,
            "notes": row["notes"],
            "geometry": json.loads(row["geometry"]),
            "default_layout": default_layout(db, row["id"]),
        })
    return records


def default_layout(db, type_id):
    """A suite type's default layout as seed placements.

    Catalog furniture is written by slug, so it survives the catalog being
    rebuilt with different ids; a custom item has no slug, so it is written
    with its own label and size instead.
    """
    rows = db.execute(
        "SELECT furniture.slug, placements.label, placements.width, placements.depth, "
        "placements.height, placements.x, placements.y, placements.rotation "
        "FROM layouts JOIN placements ON placements.layout_id = layouts.id "
        "LEFT JOIN furniture ON furniture.id = placements.furniture_id "
        "WHERE layouts.suite_type_id = ? AND layouts.user_id IS NULL AND layouts.is_default = 1 "
        "ORDER BY placements.id",
        type_id,
    )
    placements = []
    for row in rows:
        if row["slug"]:
            item = {"slug": row["slug"]}
        else:
            item = {"label": row["label"], "width": row["width"], "depth": row["depth"], "height": row["height"]}
        # x and y are REAL columns, so SQLite hands back 94.0 for 94; positions
        # are whole inches (SPEC.md 4.4), so write them as whole numbers.
        item.update({"x": whole(row["x"]), "y": whole(row["y"]), "rotation": row["rotation"]})
        placements.append(item)
    return placements


def whole(number):
    """94.0 -> 94; anything that isn't a whole number is left as it is."""
    return int(number) if float(number).is_integer() else number


def one_per_line(records):
    """A JSON list with one record per line, the layout of seed/furniture.json:
    short enough to read, and a change to one item is a one-line diff."""
    lines = ["  " + json.dumps(record, ensure_ascii=False) for record in records]
    return "[\n" + ",\n".join(lines) + "\n]\n"


def existing_suite_files(suites_dir):
    """Map (dorm, name) -> path for the suite files already in `suites_dir`."""
    found = {}
    for path in sorted(suites_dir.glob("*.json")):
        try:
            data = json.loads(path.read_text())
            found[(data["dorm"], data["name"])] = path
        except (ValueError, KeyError, TypeError):
            continue  # not a suite file we understand: leave it alone
    return found


def new_suite_path(suites_dir, record, taken):
    """A free file name for a new suite type, e.g. 'demo-hall-triple.json'."""
    base = slugify(f"{record['dorm']} {record['name']}") or "suite"
    path = suites_dir / f"{base}.json"
    number = 2
    while path.exists() or path in taken:
        path = suites_dir / f"{base}-{number}.json"
        number += 1
    return path


def slugify(text):
    """'Canaday Hall: Four-room suite' -> 'canaday-hall-four-room-suite'."""
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def print_report(report):
    """Summarise an export_seed() report in the terminal."""
    for name in report["changed"]:
        print(f"  wrote     seed/{name}")
    print(f"  {len(report['unchanged'])} file(s) unchanged")
    for name in report["stale"]:
        print(f"  NOT IN DATABASE: seed/{name} (no published suite type matches it; delete it if it's gone)")
    if report["changed"]:
        print("Review with `git diff seed/`, then commit.")


if __name__ == "__main__":
    print_report(export_seed(SQL(os.environ.get("CRIMSON3D_DB", DEFAULT_URL))))
