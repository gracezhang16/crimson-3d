"""Tests for rebuilding the site from seed/ (S8): export_rooms.py writes the
database back to seed/, init_db.py reads it, and --demo-users adds showcase
accounts.

These tests build their own small databases in pytest's tmp_path (a fresh
temporary folder per test), separate from the shared test database.
"""

import json
import shutil
from pathlib import Path

from cs50 import SQL
from werkzeug.security import check_password_hash

from export_rooms import export_seed
from init_db import DEMO_ACCOUNTS, add_demo_users, build_database

SEED = Path(__file__).parent.parent / "seed"


def fresh(tmp_path, name="site.db", seed_dir=SEED, demo_users=False):
    """Build a database from `seed_dir` in tmp_path; returns (db, accounts)."""
    url = f"sqlite:///{tmp_path / name}"
    accounts = build_database(url, seed_dir=seed_dir, demo_users=demo_users)
    return SQL(url), accounts


def seed_copy(tmp_path):
    """A copy of seed/ to export into, so the real seed/ is never touched."""
    target = tmp_path / "seed"
    shutil.copytree(SEED, target)
    return target


def add_published_suite(db):
    """An invented dorm and published suite type, with a default layout holding
    one catalog item and one custom item. Returns the suite type's id."""
    dorm_id = db.execute(
        "INSERT INTO dorms (name, yard, description) VALUES ('Test Hall', 'Test Yard', 'Invented for tests.')"
    )
    geometry = json.loads((SEED / "suites" / "demo-hall-single.json").read_text())["geometry"]
    type_id = db.execute(
        "INSERT INTO suite_types (dorm_id, name, capacity, bathroom, geometry, status, measured_by, measured_on) "
        "VALUES (?, 'Quad: four rooms', 4, 'shared-suite', ?, 'published', 'Test team', '2026-11-20')",
        dorm_id, json.dumps(geometry),
    )
    layout_id = db.execute(
        "INSERT INTO layouts (user_id, suite_type_id, name, is_default) VALUES (NULL, ?, 'Default layout', 1)",
        type_id,
    )
    db.execute(
        "INSERT INTO placements (layout_id, furniture_id, x, y, rotation) "
        "SELECT ?, id, 30, 50, 90 FROM furniture WHERE slug = 'desk'",
        layout_id,
    )
    db.execute(
        "INSERT INTO placements (layout_id, furniture_id, label, width, depth, height, x, y, rotation) "
        "VALUES (?, NULL, 'Bean bag', 36, 36, 28, 60, 80, 0)",
        layout_id,
    )
    return type_id


# ---------------------------------------------------------------------------
# export_rooms.py
# ---------------------------------------------------------------------------

def test_exporting_a_fresh_database_changes_nothing(tmp_path):
    """seed/ -> database -> export gives back exactly the same files."""
    db, _ = fresh(tmp_path)
    target = seed_copy(tmp_path)

    report = export_seed(db, target)

    assert report["changed"] == []
    assert report["stale"] == []
    for path in SEED.rglob("*.json"):
        assert (target / path.relative_to(SEED)).read_text() == path.read_text(), path.name


def test_a_new_suite_survives_export_and_rebuild(tmp_path):
    """The S8 'done when': a fresh database rebuilt from the exported seed/
    has the suites, dorms and furniture that were added through the site."""
    db, _ = fresh(tmp_path)
    add_published_suite(db)
    db.execute("UPDATE furniture SET width = 39 WHERE slug = 'bed-twin-xl'")
    target = seed_copy(tmp_path)

    report = export_seed(db, target)

    assert sorted(report["changed"]) == ["dorms.json", "furniture.json", "suites/test-hall-quad-four-rooms.json"]

    rebuilt, _ = fresh(tmp_path, "rebuilt.db", seed_dir=target)
    suite = rebuilt.execute(
        "SELECT suite_types.*, dorms.yard FROM suite_types JOIN dorms ON dorms.id = suite_types.dorm_id "
        "WHERE dorms.name = 'Test Hall'"
    )[0]
    assert suite["name"] == "Quad: four rooms"
    assert suite["status"] == "published"
    assert suite["yard"] == "Test Yard"
    assert str(suite["measured_on"]) == "2026-11-20"
    assert json.loads(suite["geometry"]) == json.loads(
        db.execute("SELECT geometry FROM suite_types WHERE id = ?", suite["id"])[0]["geometry"]
    )
    items = rebuilt.execute(
        "SELECT furniture.slug, placements.label, placements.width, placements.x, placements.y, placements.rotation "
        "FROM layouts JOIN placements ON placements.layout_id = layouts.id "
        "LEFT JOIN furniture ON furniture.id = placements.furniture_id "
        "WHERE layouts.suite_type_id = ? AND layouts.is_default = 1 ORDER BY placements.id",
        suite["id"],
    )
    assert [(i["slug"], i["label"], i["width"], i["x"], i["y"], i["rotation"]) for i in items] == [
        ("desk", None, None, 30, 50, 90),
        (None, "Bean bag", 36, 60, 80, 0),
    ]
    assert rebuilt.execute("SELECT width FROM furniture WHERE slug = 'bed-twin-xl'")[0]["width"] == 39


def test_drafts_are_not_exported(tmp_path):
    db, _ = fresh(tmp_path)
    type_id = add_published_suite(db)
    db.execute("UPDATE suite_types SET status = 'draft' WHERE id = ?", type_id)
    target = seed_copy(tmp_path)

    report = export_seed(db, target)

    assert not (target / "suites" / "test-hall-quad-four-rooms.json").exists()
    assert report["stale"] == []


def test_seed_files_with_no_suite_are_listed_but_kept(tmp_path):
    db, _ = fresh(tmp_path)
    db.execute("UPDATE suite_types SET status = 'draft' WHERE name = 'Double (sample)'")
    target = seed_copy(tmp_path)

    report = export_seed(db, target)

    assert report["stale"] == ["suites/demo-hall-double.json"]
    assert (target / "suites" / "demo-hall-double.json").exists()


def test_an_existing_seed_file_is_rewritten_in_place(tmp_path):
    """A suite already in seed/ keeps its file name, even if it doesn't match
    the name a new export would choose ('demo-hall-single-sample.json')."""
    db, _ = fresh(tmp_path)
    db.execute("UPDATE suite_types SET notes = 'Changed in the builder.' WHERE name = 'Single (sample)'")
    target = seed_copy(tmp_path)

    report = export_seed(db, target)

    assert report["changed"] == ["suites/demo-hall-single.json"]
    written = json.loads((target / "suites" / "demo-hall-single.json").read_text())
    assert written["notes"] == "Changed in the builder."


# ---------------------------------------------------------------------------
# init_db.py --demo-users
# ---------------------------------------------------------------------------

def test_no_accounts_without_demo_users(tmp_path):
    db, accounts = fresh(tmp_path)
    assert accounts == []
    assert db.execute("SELECT COUNT(*) AS n FROM users")[0]["n"] == 0


def test_demo_users_are_invented_students_with_working_passwords(tmp_path):
    db, accounts = fresh(tmp_path, demo_users=True)

    assert [email for email, _, _ in accounts] == [email for email, _ in DEMO_ACCOUNTS]
    for email, password, _ in accounts:
        assert email.endswith("@example.com")
        user = db.execute("SELECT * FROM users WHERE email = ?", email)[0]
        assert user["role"] == "student"
        assert check_password_hash(user["hash"], password)

    assigned = db.execute(
        "SELECT users.email, suites.number, suite_types.name FROM assignments "
        "JOIN users ON users.id = assignments.user_id JOIN suites ON suites.id = assignments.suite_id "
        "JOIN suite_types ON suite_types.id = suites.suite_type_id ORDER BY users.email"
    )
    assert [(row["email"], row["number"], row["name"]) for row in assigned] == [
        ("demo1@example.com", "D-101", "Single (sample)"),
        ("demo2@example.com", "D-201", "Two-bedroom suite (sample)"),
    ]


def test_demo_passwords_change_every_build(tmp_path):
    _, first = fresh(tmp_path, "one.db", demo_users=True)
    _, second = fresh(tmp_path, "two.db", demo_users=True)
    assert [p for _, p, _ in first] != [p for _, p, _ in second]


def test_an_assigned_demo_student_can_log_in_and_reach_their_suite(client):
    from helpers import db
    accounts = add_demo_users(db)
    email, password, number = accounts[0]
    assert number == "D-101"

    response = client.post("/login", data={"email": email, "password": password})
    assert response.status_code == 302

    response = client.get("/my-suite")
    assert response.status_code == 302
    single = db.execute("SELECT id FROM suite_types WHERE name = 'Single (sample)'")[0]["id"]
    assert response.headers["Location"].endswith(f"/plan/{single}")
