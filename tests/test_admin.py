"""Tests for the admin blueprint (Hannah): A1 admin home and suite types list,
A2 builder form and dorms page.

The guard tests don't list admin URLs by hand. They read Flask's route table
(app.url_map) and try every /admin route with every method it accepts, so a
route added later without @admin_required fails these tests straight away.
"""

import re

import pytest

from app import app
from helpers import db


def admin_routes():
    """Yield (method, url) for every /admin route, with 1 for each <id> part."""
    for rule in app.url_map.iter_rules():
        if rule.rule.startswith("/admin"):
            url = re.sub(r"<[^>]+>", "1", rule.rule)   # /admin/types/<int:type_id> -> /admin/types/1
            for method in sorted(rule.methods - {"HEAD", "OPTIONS"}):
                yield method, url


ADMIN_ROUTES = list(admin_routes())


def log_in(client, role):
    """Create a user with this role and log the client in as them."""
    user_id = db.execute(
        "INSERT INTO users (email, hash, role) VALUES (?, 'x', ?)", f"{role}@example.com", role
    )
    with client.session_transaction() as session:
        session["user_id"] = user_id


def test_admin_routes_were_found():
    # Guards against the tests below passing because they found nothing to test.
    assert ("GET", "/admin") in ADMIN_ROUTES
    assert ("GET", "/admin/types") in ADMIN_ROUTES
    assert ("POST", "/admin/dorms") in ADMIN_ROUTES


@pytest.mark.parametrize("method, url", ADMIN_ROUTES)
def test_visitor_gets_403_on_every_admin_route(client, method, url):
    assert client.open(url, method=method).status_code == 403


@pytest.mark.parametrize("method, url", ADMIN_ROUTES)
def test_student_gets_403_on_every_admin_route(client, method, url):
    log_in(client, "student")
    response = client.open(url, method=method)
    assert response.status_code == 403
    assert "Only admins" in response.get_data(as_text=True)


def test_admin_home_shows_counts(client):
    log_in(client, "admin")
    response = client.get("/admin")
    assert response.status_code == 200
    page = response.get_data(as_text=True)
    assert "Published suite types" in page
    assert '<div class="fs-3 fw-semibold">3</div>' in page   # the three Demo Hall suite types
    assert 'href="/admin/types"' in page


def test_suite_types_list_includes_drafts(client):
    db.execute("UPDATE suite_types SET status = 'draft' WHERE name = 'Single (sample)'")
    log_in(client, "admin")
    response = client.get("/admin/types")
    assert response.status_code == 200
    page = response.get_data(as_text=True)
    assert "Single (sample)" in page and "Double (sample)" in page
    assert ">Draft<" in page and ">Published<" in page


def test_navbar_admin_link_only_for_admins(client):
    log_in(client, "student")
    assert 'href="/admin"' not in client.get("/").get_data(as_text=True)


def test_navbar_admin_link_for_admin(client):
    log_in(client, "admin")
    assert 'href="/admin"' in client.get("/").get_data(as_text=True)


# --- A2: builder form --------------------------------------------------------

def test_builder_form_has_every_field_with_a_label(client):
    log_in(client, "admin")
    response = client.get("/admin/types/new")
    assert response.status_code == 200
    page = response.get_data(as_text=True)
    for field in ("dorm_id", "name", "capacity", "bathroom", "width", "length",
                  "ceiling", "measured_by", "measured_on", "notes"):
        assert f'<label for="{field}"' in page, field
        assert f'id="{field}"' in page, field
    assert 'name="geometry"' in page                       # hidden field for A4
    assert 'value="rectangle" checked' in page and 'value="walls"' in page
    assert '<template id="wall-row-template">' in page
    assert 'id="features-table"' in page and '<template id="feature-template">' in page
    # Suites (U3): room tabs, the selected room's name, kind and position.
    for field in ("room-tabs", "room-name", "room-kind", "room-x", "room-y", "place-room"):
        assert f'id="{field}"' in page, field
    assert 'data-action="remove-room"' in page
    assert 'data-action="add-feature"' in page
    assert "/static/js/builder/main.js" in page


def test_builder_lists_dorms(client):
    db.execute("INSERT INTO dorms (name) VALUES ('Canaday')")
    log_in(client, "admin")
    page = client.get("/admin/types/new").get_data(as_text=True)
    assert ">Canaday</option>" in page and ">Demo Hall</option>" in page


# --- A2: dorms page (pulled forward from A7) ---------------------------------

def test_dorms_page_lists_dorms_with_counts(client):
    log_in(client, "admin")
    page = client.get("/admin/dorms").get_data(as_text=True)
    assert "Demo Hall" in page
    assert '<td class="text-end">3</td>' in page


def test_add_dorm(client):
    log_in(client, "admin")
    response = client.post("/admin/dorms", data={"name": "  Canaday ", "yard": "Old Yard", "description": ""})
    assert response.status_code == 302
    assert response.headers["Location"] == "/admin/dorms"
    row = db.execute("SELECT name, yard, description FROM dorms WHERE name = 'Canaday'")[0]
    assert row == {"name": "Canaday", "yard": "Old Yard", "description": None}
    assert "Added Canaday." in client.get("/admin/dorms").get_data(as_text=True)


def test_add_duplicate_dorm(client):
    log_in(client, "admin")
    response = client.post("/admin/dorms", data={"name": "Demo Hall"})
    assert response.status_code == 400
    assert "already a dorm called Demo Hall" in response.get_data(as_text=True)


@pytest.mark.parametrize("data, message", [
    ({"name": ""}, "1 to 60 characters"),
    ({"name": "x" * 61}, "1 to 60 characters"),
    ({"name": "Ok", "yard": "y" * 61}, "at most 60"),
    ({"name": "Ok", "description": "d" * 501}, "at most 500"),
])
def test_add_dorm_validates(client, data, message):
    log_in(client, "admin")
    response = client.post("/admin/dorms", data=data)
    assert response.status_code == 400
    assert message in response.get_data(as_text=True)
    assert db.execute("SELECT COUNT(*) AS n FROM dorms")[0]["n"] == 1


def test_bad_dorm_keeps_what_was_typed(client):
    log_in(client, "admin")
    page = client.post("/admin/dorms", data={"name": "", "yard": "River"}).get_data(as_text=True)
    assert 'value="River"' in page


# --- A4: save, edit, publish ---------------------------------------------------

import json  # noqa: E402  (grouped with the A4 tests that use it)

L_ROOM = {
    "version": 2, "units": "in", "ceiling": 96,
    "rooms": [{
        "name": "Main room", "kind": "bedroom",
        "outline": [[0, 0], [120, 0], [120, 60], [60, 60], [60, 150], [0, 150]],
        "features": [{"kind": "door", "wall": 3, "offset": 20, "width": 30, "height": 80}],
    }],
}


def with_room_changes(**changes):
    """L_ROOM with its one room changed (e.g. features=[...])."""
    return {**L_ROOM, "rooms": [{**L_ROOM["rooms"][0], **changes}]}


def demo_hall_id():
    return db.execute("SELECT id FROM dorms WHERE name = 'Demo Hall'")[0]["id"]


def builder_form(**changes):
    """A valid builder form submission, with some fields replaced."""
    form = {
        "dorm_id": str(demo_hall_id()), "name": "L-shaped single", "capacity": "1",
        "bathroom": "hallway", "measured_by": "Test Admin", "measured_on": "2026-09-01",
        "notes": "", "geometry": json.dumps(L_ROOM),
    }
    form.update(changes)
    return form


def admin_client(client):
    log_in(client, "admin")
    return client


def test_save_new_suite_type_as_draft(client):
    response = admin_client(client).post("/admin/types/new", data=builder_form())
    assert response.status_code == 302
    row = db.execute("SELECT * FROM suite_types WHERE name = 'L-shaped single'")[0]
    assert response.headers["Location"] == f"/admin/types/{row['id']}/edit"
    assert row["status"] == "draft"
    assert row["bathroom"] == "hallway" and row["measured_on"] == "2026-09-01"
    assert json.loads(row["geometry"]) == L_ROOM
    admin_id = db.execute("SELECT id FROM users WHERE role = 'admin'")[0]["id"]
    assert row["created_by"] == admin_id
    assert "Saved draft" in client.get(response.headers["Location"]).get_data(as_text=True)


def test_saved_draft_opens_in_the_planner_for_admins_only(client):
    admin_client(client).post("/admin/types/new", data=builder_form())
    type_id = db.execute("SELECT id FROM suite_types WHERE name = 'L-shaped single'")[0]["id"]
    assert client.get(f"/plan/{type_id}").status_code == 200
    assert client.get(f"/api/types/{type_id}").get_json()["geometry"] == L_ROOM
    client.get("/logout")
    assert client.get(f"/plan/{type_id}").status_code == 404


def test_server_rejects_window_wider_than_wall_with_readable_message(client):
    room = with_room_changes(features=[{"kind": "window", "wall": 1, "offset": 0, "width": 80, "height": 50, "sill": 30}])
    response = admin_client(client).post("/admin/types/new", data=builder_form(geometry=json.dumps(room)))
    assert response.status_code == 400
    page = response.get_data(as_text=True)
    assert "Window 1 is wider than wall B (80 in on a 60 in wall)." in page
    assert 'value="L-shaped single"' in page               # what was typed is kept
    assert "data-geometry=" in page and "&#34;window&#34;" in page   # and so is the shape
    assert db.execute("SELECT COUNT(*) AS n FROM suite_types")[0]["n"] == 3   # nothing new was saved


@pytest.mark.parametrize("changes, message", [
    ({"name": ""}, "name of 1 to 60 characters"),
    ({"name": "x" * 61}, "name of 1 to 60 characters"),
    ({"capacity": "0"}, "Capacity must be"),
    ({"capacity": "seven"}, "Capacity must be"),
    ({"dorm_id": "999"}, "Pick a dorm"),
    ({"bathroom": "outdoor"}, "bathroom option"),
    ({"measured_on": "2026-02-30"}, "real date"),
    ({"notes": "n" * 501}, "at most 500"),
    ({"geometry": ""}, "shape is missing"),
    ({"geometry": "{not json"}, "couldn&#39;t be read"),   # Jinja escapes the apostrophe
    ({"geometry": json.dumps(dict(L_ROOM, ceiling=500))}, "Ceiling"),
])
def test_save_validates_every_field(client, changes, message):
    response = admin_client(client).post("/admin/types/new", data=builder_form(**changes))
    assert response.status_code == 400
    assert message in response.get_data(as_text=True)


def test_duplicate_name_in_the_same_dorm(client):
    response = admin_client(client).post("/admin/types/new", data=builder_form(name="Single (sample)"))
    assert response.status_code == 400
    assert "Demo Hall already has a suite type called Single (sample)." in response.get_data(as_text=True)


def test_edit_page_is_filled_from_the_database(client):
    single = db.execute("SELECT id FROM suite_types WHERE name = 'Single (sample)'")[0]["id"]
    page = admin_client(client).get(f"/admin/types/{single}/edit").get_data(as_text=True)
    assert 'value="Single (sample)"' in page
    assert 'value="hallway" selected' in page
    assert "data-geometry=" in page and "&#34;outline&#34;" in page
    assert "This suite type is published" in page          # warning before editing live rooms
    assert f'href="/plan/{single}"' in page                # Preview in 3D
    assert "Unpublish" in page


def test_edit_saves_changes(client):
    single = db.execute("SELECT id FROM suite_types WHERE name = 'Single (sample)'")[0]["id"]
    response = admin_client(client).post(f"/admin/types/{single}/edit", data=builder_form(name="Single, renamed"))
    assert response.status_code == 302
    row = db.execute("SELECT name, status, geometry FROM suite_types WHERE id = ?", single)[0]
    assert row["name"] == "Single, renamed"
    assert row["status"] == "published"                    # editing doesn't unpublish
    assert json.loads(row["geometry"]) == L_ROOM


def test_edit_missing_suite_type_is_404(client):
    assert admin_client(client).get("/admin/types/9999/edit").status_code == 404


def test_publish_and_unpublish(client):
    admin_client(client).post("/admin/types/new", data=builder_form())
    type_id = db.execute("SELECT id FROM suite_types WHERE name = 'L-shaped single'")[0]["id"]

    response = client.post(f"/admin/types/{type_id}/publish")
    assert response.status_code == 302
    assert db.execute("SELECT status FROM suite_types WHERE id = ?", type_id)[0]["status"] == "published"
    client.get("/logout")
    assert client.get(f"/types/{type_id}").status_code == 200   # students can see it now

    admin_id = db.execute("SELECT id FROM users WHERE role = 'admin'")[0]["id"]
    with client.session_transaction() as session:   # log the same admin back in
        session["user_id"] = admin_id
    client.post(f"/admin/types/{type_id}/unpublish")
    assert db.execute("SELECT status FROM suite_types WHERE id = ?", type_id)[0]["status"] == "draft"


def test_publish_refuses_an_invalid_saved_room(client):
    bad = dict(L_ROOM, ceiling=10)
    type_id = db.execute(
        "INSERT INTO suite_types (dorm_id, name, geometry) VALUES (?, 'Broken', ?)",
        demo_hall_id(), json.dumps(bad),
    )
    admin_client(client).post(f"/admin/types/{type_id}/publish")
    assert db.execute("SELECT status FROM suite_types WHERE id = ?", type_id)[0]["status"] == "draft"
    assert "Can&#39;t publish Broken yet" in client.get(f"/admin/types/{type_id}/edit").get_data(as_text=True)


def test_suite_types_list_has_edit_3d_and_publish_buttons(client):
    page = admin_client(client).get("/admin/types").get_data(as_text=True)
    single = db.execute("SELECT id FROM suite_types WHERE name = 'Single (sample)'")[0]["id"]
    assert f'href="/admin/types/{single}/edit"' in page
    assert f'href="/plan/{single}"' in page
    assert f'action="/admin/types/{single}/unpublish"' in page


def test_duplicate_name_is_reported_with_other_problems(client):
    response = admin_client(client).post("/admin/types/new", data=builder_form(name="Single (sample)", capacity="9"))
    page = response.get_data(as_text=True)
    assert "Capacity must be" in page and "already has a suite type called Single (sample)" in page


def test_editing_keeps_its_own_name(client):
    single = db.execute("SELECT id FROM suite_types WHERE name = 'Single (sample)'")[0]["id"]
    response = admin_client(client).post(f"/admin/types/{single}/edit", data=builder_form(name="Single (sample)"))
    assert response.status_code == 302


# --- A5: rooms and assignments -------------------------------------------------

def type_id_named(name):
    return db.execute("SELECT id FROM suite_types WHERE name = ?", name)[0]["id"]


def add_student(email):
    return db.execute("INSERT INTO users (email, hash) VALUES (?, 'x')", email)


def make_room(number="B-21", type_name="Double (sample)"):
    """Insert a room directly and return its id."""
    suite_type = db.execute("SELECT id, dorm_id FROM suite_types WHERE name = ?", type_name)[0]
    return db.execute(
        "INSERT INTO suites (dorm_id, number, suite_type_id) VALUES (?, ?, ?)",
        suite_type["dorm_id"], number, suite_type["id"],
    )


def test_add_room(client):
    response = admin_client(client).post("/admin/suites", data={"number": " B-21 ", "suite_type_id": type_id_named("Double (sample)")})
    assert response.status_code == 302
    room = db.execute("SELECT * FROM suites")[0]
    assert room["number"] == "B-21"
    assert room["dorm_id"] == demo_hall_id()               # taken from the suite type
    page = client.get("/admin/suites").get_data(as_text=True)
    assert "Added suite B-21." in page and "Demo Hall B-21" in page and "0 of 2" in page


@pytest.mark.parametrize("data, message", [
    ({"number": "", "suite_type_id": "1"}, "number of 1 to 20"),
    ({"number": "x" * 21, "suite_type_id": "1"}, "number of 1 to 20"),
    ({"number": "A-1", "suite_type_id": "999"}, "Pick a suite type"),
    ({"number": "A-1", "suite_type_id": "abc"}, "Pick a suite type"),
])
def test_add_room_validates(client, data, message):
    admin_client(client).post("/admin/suites", data=data)
    assert message in client.get("/admin/suites").get_data(as_text=True)
    assert db.execute("SELECT COUNT(*) AS n FROM suites")[0]["n"] == 0


def test_room_numbers_are_unique_per_dorm(client):
    make_room("B-21")
    admin_client(client).post("/admin/suites", data={"number": "B-21", "suite_type_id": type_id_named("Single (sample)")})
    assert "already has a suite B-21" in client.get("/admin/suites").get_data(as_text=True)


def test_assigned_student_sees_my_suite(client):
    suite_id = make_room("B-21", "Single (sample)")
    student_id = add_student("frosh@example.com")
    admin_client(client).post(f"/admin/suites/{suite_id}/assign", data={"email": " Frosh@Example.com "})
    assert db.execute("SELECT suite_id FROM assignments WHERE user_id = ?", student_id)[0]["suite_id"] == suite_id
    assert "Assigned frosh@example.com to Demo Hall B-21." in client.get("/admin/suites").get_data(as_text=True)

    # The A5 "done when": the student now has My suite, and it opens their planner.
    with client.session_transaction() as session:
        session["user_id"] = student_id
    assert "My suite" in client.get("/").get_data(as_text=True)
    response = client.get("/my-suite")
    assert response.headers["Location"] == f"/plan/{type_id_named('Single (sample)')}"


def test_assign_unknown_email(client):
    suite_id = make_room()
    admin_client(client).post(f"/admin/suites/{suite_id}/assign", data={"email": "nobody@example.com"})
    assert "Ask the student to register first" in client.get("/admin/suites").get_data(as_text=True)
    assert db.execute("SELECT COUNT(*) AS n FROM assignments")[0]["n"] == 0


def test_assigning_again_moves_the_student(client):
    first, second = make_room("B-21"), make_room("B-22")
    student_id = add_student("frosh@example.com")
    admin_client(client).post(f"/admin/suites/{first}/assign", data={"email": "frosh@example.com"})
    client.post(f"/admin/suites/{second}/assign", data={"email": "frosh@example.com"})
    assert db.execute("SELECT suite_id FROM assignments WHERE user_id = ?", student_id) == [{"suite_id": second}]
    assert "(moved from Demo Hall B-21)" in client.get("/admin/suites").get_data(as_text=True)


def test_a_full_room_refuses_another_student(client):
    suite_id = make_room("B-21", "Double (sample)")          # capacity 2
    for email in ("a@example.org", "b@example.org", "c@example.org"):
        add_student(email)
    admin_client(client)
    for email in ("a@example.org", "b@example.org", "c@example.org"):
        client.post(f"/admin/suites/{suite_id}/assign", data={"email": email})
    assert db.execute("SELECT COUNT(*) AS n FROM assignments")[0]["n"] == 2
    page = client.get("/admin/suites").get_data(as_text=True)
    assert "Demo Hall B-21 is full (capacity 2)" in page


def test_unassign(client):
    suite_id = make_room()
    student_id = add_student("frosh@example.com")
    db.execute("INSERT INTO assignments (user_id, suite_id) VALUES (?, ?)", student_id, suite_id)
    admin_client(client).post(f"/admin/suites/{suite_id}/unassign", data={"user_id": student_id})
    assert db.execute("SELECT COUNT(*) AS n FROM assignments")[0]["n"] == 0
    assert "Unassigned from Demo Hall B-21." in client.get("/admin/suites").get_data(as_text=True)


def test_unassign_someone_not_in_the_room(client):
    suite_id = make_room()
    admin_client(client).post(f"/admin/suites/{suite_id}/unassign", data={"user_id": "999"})
    assert "isn&#39;t assigned to this suite" in client.get("/admin/suites").get_data(as_text=True)


def test_assign_to_missing_room_is_404(client):
    assert admin_client(client).post("/admin/suites/999/assign", data={"email": "x@example.com"}).status_code == 404


# --- A6: default layout --------------------------------------------------------

def default_placements(type_id):
    return db.execute(
        "SELECT furniture_id, x, y, rotation FROM placements JOIN layouts ON layouts.id = placements.layout_id "
        "WHERE layouts.suite_type_id = ? AND layouts.user_id IS NULL ORDER BY placements.id",
        type_id,
    )


def test_default_layout_page_is_the_planner_in_admin_mode(client):
    single = type_id_named("Single (sample)")
    response = admin_client(client).get(f"/admin/types/{single}/default-layout")
    assert response.status_code == 200
    page = response.get_data(as_text=True)
    assert 'data-mode="admin-default"' in page
    assert 'id="save-default-button"' in page
    assert 'id="save-button"' not in page                    # no student save controls


def test_default_layout_page_missing_type_is_404(client):
    assert admin_client(client).get("/admin/types/999/default-layout").status_code == 404


def test_save_default_layout_is_what_visitors_see(client):
    single = type_id_named("Single (sample)")
    new = [{"furniture_id": 1, "x": 30, "y": 50, "rotation": 90}, {"furniture_id": 2, "x": 90, "y": 120, "rotation": 0}]
    response = admin_client(client).put(f"/admin/api/types/{single}/default-layout", json={"placements": new})
    assert response.status_code == 200
    assert response.get_json()["ok"] is True
    client.get("/logout")
    assert client.get(f"/api/types/{single}").get_json()["default_layout"]["placements"] == new


def test_default_layout_is_created_if_missing_and_stays_unique(client):
    single = type_id_named("Single (sample)")
    db.execute("DELETE FROM layouts WHERE suite_type_id = ? AND user_id IS NULL", single)
    admin_client(client)
    for x in (30, 40):
        client.put(f"/admin/api/types/{single}/default-layout",
                   json={"placements": [{"furniture_id": 1, "x": x, "y": 50, "rotation": 0}]})
    rows = db.execute("SELECT id FROM layouts WHERE suite_type_id = ? AND user_id IS NULL AND is_default = 1", single)
    assert len(rows) == 1
    assert [p["x"] for p in default_placements(single)] == [40]


def test_save_default_layout_validates(client):
    single = type_id_named("Single (sample)")
    before = default_placements(single)
    admin_client(client)
    bad = client.put(f"/admin/api/types/{single}/default-layout",
                     json={"placements": [{"furniture_id": 1, "x": 30, "y": 50, "rotation": 45}]})
    assert bad.status_code == 400
    assert "0, 90, 180 or 270" in bad.get_json()["error"]
    assert client.put(f"/admin/api/types/{single}/default-layout", json={"nope": []}).status_code == 400
    assert client.put(f"/admin/api/types/{single}/default-layout", data="x").status_code == 400
    assert client.put("/admin/api/types/999/default-layout", json={"placements": []}).status_code == 404
    assert default_placements(single) == before


def test_edit_page_links_to_default_layout(client):
    single = type_id_named("Single (sample)")
    page = admin_client(client).get(f"/admin/types/{single}/edit").get_data(as_text=True)
    assert f'href="/admin/types/{single}/default-layout"' in page
