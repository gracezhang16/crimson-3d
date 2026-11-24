"""Tests for the JSON API (Grace): /api/types/<id> and /api/furniture (S4),
and the layouts endpoints with ownership checks and validation (S5)."""

import json
from pathlib import Path

import pytest

import api
from api import placement_to_json, whole_if_possible
from helpers import db

SEED_ROOMS = Path(__file__).resolve().parent.parent / "seed" / "rooms"


def seed_room(filename):
    """Load one seed/rooms/*.json file."""
    return json.loads((SEED_ROOMS / filename).read_text())


def type_id(name):
    """Return the id of the seeded suite type with this name."""
    return db.execute("SELECT id FROM suite_types WHERE name = ?", name)[0]["id"]


def log_in(client, role="student", email=None):
    """Create a user with this role, log the client in as them, return their id."""
    user_id = db.execute(
        "INSERT INTO users (email, hash, role) VALUES (?, 'x', ?)",
        email or f"{role}@example.com", role,
    )
    with client.session_transaction() as session:
        session["user_id"] = user_id
    return user_id


def make_draft():
    """Turn the sample single into a draft and return its id."""
    draft_id = type_id("Single (sample)")
    db.execute("UPDATE suite_types SET status = 'draft' WHERE id = ?", draft_id)
    return draft_id


# --- /api/types/<id> --------------------------------------------------------

def test_type_has_exactly_the_spec_fields(client):
    response = client.get(f"/api/types/{type_id('Single (sample)')}")
    assert response.status_code == 200
    assert response.is_json
    data = response.get_json()
    assert set(data) == {"id", "name", "dorm", "capacity", "geometry", "default_layout"}
    assert data["name"] == "Single (sample)"
    assert data["capacity"] == 1
    assert set(data["dorm"]) == {"id", "name"}
    assert data["dorm"]["name"] == "Demo Hall"
    assert set(data["default_layout"]) == {"placements"}


def test_type_geometry_is_an_object_equal_to_the_seed(client):
    data = client.get(f"/api/types/{type_id('Single (sample)')}").get_json()
    assert data["geometry"] == seed_room("demo-hall-single.json")["geometry"]


def test_type_default_layout_matches_the_seed(client):
    seed = seed_room("demo-hall-double.json")["default_layout"]
    data = client.get(f"/api/types/{type_id('Double (sample)')}").get_json()
    placements = data["default_layout"]["placements"]
    assert len(placements) == len(seed)

    # Same positions, in the same order, as the seed file.
    first = placements[0]
    assert set(first) == {"furniture_id", "x", "y", "rotation"}
    assert (first["x"], first["y"], first["rotation"]) == (seed[0]["x"], seed[0]["y"], seed[0]["rotation"])
    slug = db.execute("SELECT slug FROM furniture WHERE id = ?", first["furniture_id"])[0]["slug"]
    assert slug == seed[0]["slug"]


def test_type_without_default_layout_has_no_placements(client):
    single = type_id("Single (sample)")
    db.execute("DELETE FROM layouts WHERE suite_type_id = ?", single)
    data = client.get(f"/api/types/{single}").get_json()
    assert data["default_layout"] == {"placements": []}


def test_missing_type_is_json_404(client):
    response = client.get("/api/types/9999")
    assert response.status_code == 404
    assert "error" in response.get_json()


def test_draft_type_hidden_from_visitor(client):
    draft = make_draft()
    response = client.get(f"/api/types/{draft}")
    assert response.status_code == 404
    assert "error" in response.get_json()


def test_draft_type_hidden_from_student(client):
    draft = make_draft()
    log_in(client, "student")
    assert client.get(f"/api/types/{draft}").status_code == 404


def test_draft_type_visible_to_admin(client):
    draft = make_draft()
    log_in(client, "admin")
    response = client.get(f"/api/types/{draft}")
    assert response.status_code == 200
    assert response.get_json()["id"] == draft


# --- Placement format (SPEC.md 4.4) -----------------------------------------

def test_catalog_placement_format():
    row = {"furniture_id": 3, "label": None, "width": None, "depth": None, "height": None,
           "x": 37.0, "y": 33.0, "rotation": 0}
    assert placement_to_json(row) == {"furniture_id": 3, "x": 37, "y": 33, "rotation": 0}


def test_custom_placement_format():
    row = {"furniture_id": None, "label": "Bean bag chair", "width": 36, "depth": 36,
           "height": 28, "x": 60.0, "y": 80.5, "rotation": 90}
    assert placement_to_json(row) == {
        "furniture_id": None, "label": "Bean bag chair", "width": 36, "depth": 36,
        "height": 28, "x": 60, "y": 80.5, "rotation": 90,
    }


def test_whole_if_possible():
    assert whole_if_possible(94.0) == 94 and isinstance(whole_if_possible(94.0), int)
    assert whole_if_possible(94.5) == 94.5


# --- /api/furniture ---------------------------------------------------------

FURNITURE_KEYS = {"id", "slug", "name", "category", "width", "depth", "height",
                  "clearance", "color", "note"}


def test_furniture_lists_whole_catalog(client):
    response = client.get("/api/furniture")
    assert response.status_code == 200
    items = response.get_json()
    assert len(items) == 11
    assert all(set(item) == FURNITURE_KEYS for item in items)
    bed = next(item for item in items if item["slug"] == "bed-twin-xl")
    assert (bed["width"], bed["depth"], bed["height"], bed["clearance"]) == (40, 84, 36, 14)


def test_furniture_lists_harvard_items_first(client):
    categories = [item["category"] for item in client.get("/api/furniture").get_json()]
    assert categories == sorted(categories, key=lambda c: c == "purchase")


# --- JSON errors for unknown addresses --------------------------------------

def test_unknown_api_address_is_json_404(client):
    response = client.get("/api/nope")
    assert response.status_code == 404
    assert response.get_json() == {"error": "There is no such API address."}


def test_wrong_method_is_json_405(client):
    response = client.delete("/api/furniture")
    assert response.status_code == 405
    assert "error" in response.get_json()


def test_unknown_page_is_still_html_404(client):
    response = client.get("/no-such-page")
    assert response.status_code == 404
    assert not response.is_json


# --- Layouts (S5) -----------------------------------------------------------

BED = {"furniture_id": 1, "x": 20, "y": 42, "rotation": 0}
BEAN_BAG = {"furniture_id": None, "label": "Bean bag chair", "width": 36, "depth": 36,
            "height": 28, "x": 60.4, "y": 80.6, "rotation": 90}


@pytest.fixture
def single():
    """The id of the sample single (114 x 150 in)."""
    return type_id("Single (sample)")


def create(client, type_id, name="My layout", placements=None):
    """POST a new layout and return the response."""
    return client.post("/api/layouts", json={
        "type_id": type_id, "name": name,
        "placements": [BED] if placements is None else placements,
    })


def layout_count():
    return db.execute("SELECT COUNT(*) AS n FROM layouts WHERE user_id IS NOT NULL")[0]["n"]


def placement_count():
    return db.execute("SELECT COUNT(*) AS n FROM placements")[0]["n"]


@pytest.mark.parametrize("method, url", [
    ("get", "/api/layouts?type_id=1"),
    ("post", "/api/layouts"),
    ("get", "/api/layouts/1"),
    ("put", "/api/layouts/1"),
    ("delete", "/api/layouts/1"),
])
def test_layouts_need_login(client, method, url):
    response = getattr(client, method)(url, json={})
    assert response.status_code == 401
    assert "error" in response.get_json()


def test_stale_session_is_401(client):
    with client.session_transaction() as session:
        session["user_id"] = 9999  # no such user, e.g. after a database rebuild
    assert client.get("/api/layouts?type_id=1").status_code == 401


def test_save_and_reload_round_trip(client, single):
    log_in(client)
    response = create(client, single, name="  Bed by the window  ", placements=[BED, BEAN_BAG])
    assert response.status_code == 201
    layout_id = response.get_json()["id"]

    data = client.get(f"/api/layouts/{layout_id}").get_json()
    assert data == {
        "id": layout_id,
        "name": "Bed by the window",          # trimmed
        "type_id": single,
        "share_url": None,
        "placements": [
            BED,
            {**BEAN_BAG, "x": 60, "y": 81},   # rounded to whole inches
        ],
    }


def test_catalog_item_extra_fields_are_ignored(client, single):
    log_in(client)
    layout_id = create(client, single, placements=[{**BED, "label": "Sneaky", "width": 5}]).get_json()["id"]
    assert client.get(f"/api/layouts/{layout_id}").get_json()["placements"] == [BED]


def test_empty_layout_can_be_saved(client, single):
    log_in(client)
    assert create(client, single, placements=[]).status_code == 201


def test_create_needs_json(client, single):
    log_in(client)
    response = client.post("/api/layouts", data={"type_id": single, "name": "x"})
    assert response.status_code == 400
    assert client.post("/api/layouts", json=[1, 2]).status_code == 400


@pytest.mark.parametrize("bad_type_id, status", [("1", 400), (None, 400), (True, 400), (9999, 404)])
def test_create_checks_type_id(client, bad_type_id, status):
    log_in(client)
    assert create(client, bad_type_id).status_code == status


def test_create_rejects_draft_room_for_student(client, single):
    db.execute("UPDATE suite_types SET status = 'draft' WHERE id = ?", single)
    log_in(client)
    assert create(client, single).status_code == 404


@pytest.mark.parametrize("name", ["", "   ", "x" * 61, None, 42])
def test_create_rejects_bad_name(client, single, name):
    log_in(client)
    response = create(client, single, name=name)
    assert response.status_code == 400
    assert "1 to 60 characters" in response.get_json()["error"]


def test_create_accepts_60_character_name(client, single):
    log_in(client)
    assert create(client, single, name="x" * 60).status_code == 201


def test_bad_rotation_is_400(client, single):
    log_in(client)
    response = create(client, single, placements=[{**BED, "rotation": 45}])
    assert response.status_code == 400
    assert "0, 90, 180 or 270" in response.get_json()["error"]
    assert layout_count() == 0


@pytest.mark.parametrize("bad, expected", [
    ({**BED, "furniture_id": 999}, "isn't in the catalog"),
    ({**BED, "x": 500}, "outside the room"),
    ({**BEAN_BAG, "width": None}, "needs a width"),
    ({**BEAN_BAG, "height": 121}, "needs a height"),
])
def test_bad_placements_are_400(client, single, bad, expected):
    log_in(client)
    response = create(client, single, placements=[bad])
    assert response.status_code == 400
    assert expected in response.get_json()["error"]


def test_too_many_placements_is_400(client, single):
    log_in(client)
    assert create(client, single, placements=[BED] * 100).status_code == 201
    assert create(client, single, placements=[BED] * 101).status_code == 400


def test_several_problems_are_summarised(client, single):
    log_in(client)
    error = create(client, single, placements=[{**BED, "rotation": 1}] * 3).get_json()["error"]
    assert error.endswith("(and 2 more problems)")


def test_at_most_20_layouts_per_room(client, single):
    log_in(client)
    for number in range(20):
        assert create(client, single, name=f"Layout {number}").status_code == 201
    response = create(client, single, name="One too many")
    assert response.status_code == 400
    assert "at most 20" in response.get_json()["error"]
    # The limit is per suite type: another room still works.
    assert create(client, type_id("Double (sample)")).status_code == 201


def test_duplicate_names_are_allowed(client, single):
    log_in(client)
    assert create(client, single, name="Same").status_code == 201
    assert create(client, single, name="Same").status_code == 201


def test_failed_save_leaves_nothing_behind(client, single, monkeypatch):
    """If inserting placements fails halfway, the transaction rolls everything back."""
    real_insert = api.insert_placements

    def insert_then_fail(layout_id, placements):
        real_insert(layout_id, placements[:1])
        raise RuntimeError("simulated crash halfway through saving")

    monkeypatch.setattr(api, "insert_placements", insert_then_fail)
    log_in(client)
    before = placement_count()
    with pytest.raises(RuntimeError):
        create(client, single, placements=[BED, BED])
    assert layout_count() == 0
    assert placement_count() == before


# Ownership

def test_other_users_layout_is_403(client, single):
    log_in(client, email="owner@example.com")
    layout_id = create(client, single).get_json()["id"]

    log_in(client, email="intruder@example.com")
    assert client.get(f"/api/layouts/{layout_id}").status_code == 403
    assert client.put(f"/api/layouts/{layout_id}", json={"name": "Mine now"}).status_code == 403
    assert client.delete(f"/api/layouts/{layout_id}").status_code == 403
    assert db.execute("SELECT name FROM layouts WHERE id = ?", layout_id)[0]["name"] == "My layout"


def test_default_layout_is_403_even_for_admin(client, single):
    default_id = db.execute(
        "SELECT id FROM layouts WHERE suite_type_id = ? AND user_id IS NULL", single
    )[0]["id"]
    log_in(client, "admin")
    assert client.get(f"/api/layouts/{default_id}").status_code == 403
    assert client.put(f"/api/layouts/{default_id}", json={"placements": []}).status_code == 403
    assert client.delete(f"/api/layouts/{default_id}").status_code == 403


def test_missing_layout_is_404(client):
    log_in(client)
    assert client.get("/api/layouts/9999").status_code == 404


def test_layout_of_unpublished_room_is_404(client, single):
    log_in(client)
    layout_id = create(client, single).get_json()["id"]
    db.execute("UPDATE suite_types SET status = 'draft' WHERE id = ?", single)
    assert client.get(f"/api/layouts/{layout_id}").status_code == 404
    # Still stored: publishing again brings it back.
    db.execute("UPDATE suite_types SET status = 'published' WHERE id = ?", single)
    assert client.get(f"/api/layouts/{layout_id}").status_code == 200


# Listing

def test_list_shows_only_own_layouts_for_that_room(client, single):
    log_in(client, email="other@example.com")
    create(client, single, name="Someone else's")

    log_in(client, email="me@example.com")
    first = create(client, single, name="First").get_json()["id"]
    second = create(client, single, name="Second").get_json()["id"]
    create(client, type_id("Double (sample)"), name="Other room")

    rows = client.get(f"/api/layouts?type_id={single}").get_json()
    assert [row["id"] for row in rows] == [second, first]   # newest first
    assert set(rows[0]) == {"id", "name", "updated"}


def test_list_needs_a_valid_type_id(client):
    log_in(client)
    assert client.get("/api/layouts").status_code == 400
    assert client.get("/api/layouts?type_id=abc").status_code == 400
    assert client.get("/api/layouts?type_id=9999").status_code == 404


# Updating and deleting

def test_rename_keeps_placements(client, single):
    log_in(client)
    layout_id = create(client, single, placements=[BED, BEAN_BAG]).get_json()["id"]
    response = client.put(f"/api/layouts/{layout_id}", json={"name": "Renamed"})
    assert response.status_code == 200
    body = response.get_json()
    assert body["ok"] is True and body["updated"]
    data = client.get(f"/api/layouts/{layout_id}").get_json()
    assert data["name"] == "Renamed"
    assert len(data["placements"]) == 2


def test_update_replaces_all_placements(client, single):
    log_in(client)
    layout_id = create(client, single, placements=[BED, BEAN_BAG]).get_json()["id"]
    moved = {**BED, "x": 90, "rotation": 180}
    assert client.put(f"/api/layouts/{layout_id}", json={"placements": [moved]}).status_code == 200
    data = client.get(f"/api/layouts/{layout_id}").get_json()
    assert data["placements"] == [moved]
    assert data["name"] == "My layout"


def test_update_validates(client, single):
    log_in(client)
    layout_id = create(client, single).get_json()["id"]
    url = f"/api/layouts/{layout_id}"
    assert client.put(url, json={}).status_code == 400
    assert client.put(url, json={"name": ""}).status_code == 400
    assert client.put(url, json={"placements": [{**BED, "rotation": 45}]}).status_code == 400
    assert client.put(url, data="name=x").status_code == 400
    assert client.get(url).get_json()["placements"] == [BED]   # unchanged


def test_delete_removes_layout_and_placements(client, single):
    log_in(client)
    before = placement_count()
    layout_id = create(client, single, placements=[BED, BEAN_BAG]).get_json()["id"]
    assert placement_count() == before + 2

    response = client.delete(f"/api/layouts/{layout_id}")
    assert response.status_code == 200
    assert response.get_json() == {"ok": True}
    assert client.get(f"/api/layouts/{layout_id}").status_code == 404
    assert placement_count() == before   # ON DELETE CASCADE removed them
