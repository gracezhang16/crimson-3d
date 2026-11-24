"""Tests for the JSON API (Grace): /api/types/<id> and /api/furniture (S4).
S5 adds the layouts endpoints."""

import json
from pathlib import Path

from api import placement_to_json, whole_if_possible
from helpers import db

SEED_ROOMS = Path(__file__).resolve().parent.parent / "seed" / "rooms"


def seed_room(filename):
    """Load one seed/rooms/*.json file."""
    return json.loads((SEED_ROOMS / filename).read_text())


def type_id(name):
    """Return the id of the seeded room type with this name."""
    return db.execute("SELECT id FROM room_types WHERE name = ?", name)[0]["id"]


def log_in(client, role):
    """Create a user with this role and log the client in as them."""
    user_id = db.execute(
        "INSERT INTO users (email, hash, role) VALUES (?, 'x', ?)", f"{role}@example.com", role
    )
    with client.session_transaction() as session:
        session["user_id"] = user_id


def make_draft():
    """Turn the sample single into a draft and return its id."""
    draft_id = type_id("Single (sample)")
    db.execute("UPDATE room_types SET status = 'draft' WHERE id = ?", draft_id)
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
    db.execute("DELETE FROM layouts WHERE room_type_id = ?", single)
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
