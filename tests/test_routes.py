"""Route tests (Grace): register, login, logout, home and search, dorm and
room type pages with draft visibility. Later milestones add ownership and the
layout save round trip (SPEC.md 11)."""

import pytest
from werkzeug.security import check_password_hash, generate_password_hash

from helpers import db
from pages import feet_inches, like_pattern

PASSWORD = "correct-horse"


def register(client, email="new@example.com", password=PASSWORD, confirmation=None):
    """POST the register form. confirmation defaults to the password."""
    return client.post("/register", data={
        "email": email,
        "password": password,
        "confirmation": password if confirmation is None else confirmation,
    })


def add_user(email="student@example.com", password=PASSWORD):
    """Insert a user straight into the database and return their id."""
    return db.execute(
        "INSERT INTO users (email, hash) VALUES (?, ?)", email, generate_password_hash(password)
    )


def log_in(client, user_id):
    """Pretend to log in by writing user_id straight into the session."""
    with client.session_transaction() as session:
        session["user_id"] = user_id


def type_id(name):
    """Return the id of the seeded room type with this name."""
    return db.execute("SELECT id FROM room_types WHERE name = ?", name)[0]["id"]


def logged_in_id(client):
    """Return the user_id stored in the client's session, or None."""
    with client.session_transaction() as session:
        return session.get("user_id")


def test_home_page_lists_demo_hall(client):
    response = client.get("/")
    assert response.status_code == 200
    page = response.get_data(as_text=True)
    assert "Demo Hall" in page
    assert "2 room types" in page
    assert "not affiliated with Harvard University" in page


# --- Per-test database reset (conftest.py) ----------------------------------
# pytest runs tests in file order, so the second test proves the user added by
# the first one was wiped by the reset.

def test_reset_part_1_add_a_user():
    add_user("temp@example.com")
    assert db.execute("SELECT COUNT(*) AS n FROM users")[0]["n"] == 1


def test_reset_part_2_user_is_gone():
    assert db.execute("SELECT COUNT(*) AS n FROM users")[0]["n"] == 0


# --- Register ---------------------------------------------------------------

def test_register_page_renders(client):
    response = client.get("/register")
    assert response.status_code == 200
    assert 'name="confirmation"' in response.get_data(as_text=True)


def test_register_creates_student_and_logs_in(client):
    response = register(client, email="  New@Example.com ")
    assert response.status_code == 302
    assert response.headers["Location"] == "/"

    rows = db.execute("SELECT id, email, hash, role FROM users")
    assert len(rows) == 1
    user = rows[0]
    assert user["email"] == "new@example.com"  # trimmed and lower-cased
    assert user["role"] == "student"
    assert user["hash"] != PASSWORD  # stored hashed, never as typed
    assert check_password_hash(user["hash"], PASSWORD)
    assert logged_in_id(client) == user["id"]


def test_navbar_shows_email_after_register(client):
    register(client)
    page = client.get("/").get_data(as_text=True)
    assert "new@example.com" in page
    assert "Log out" in page


def test_register_rejects_duplicate_email(client):
    add_user("taken@example.com")
    response = register(client, email="TAKEN@example.com")
    assert response.status_code == 400
    assert "already exists" in response.get_data(as_text=True)
    assert db.execute("SELECT COUNT(*) AS n FROM users")[0]["n"] == 1


def test_register_rejects_mismatched_confirmation(client):
    response = register(client, confirmation="something-else")
    assert response.status_code == 400
    page = response.get_data(as_text=True)
    assert "don&#39;t match" in page  # Jinja escapes the apostrophe
    assert 'value="new@example.com"' in page  # email is kept in the form


def test_register_rejects_short_password(client):
    response = register(client, password="short")
    assert response.status_code == 400
    assert "at least 8 characters" in response.get_data(as_text=True)


def test_register_rejects_missing_fields(client):
    response = client.post("/register", data={"email": "new@example.com"})
    assert response.status_code == 400
    assert db.execute("SELECT COUNT(*) AS n FROM users")[0]["n"] == 0


def test_register_rejects_email_without_at_sign(client):
    assert register(client, email="not-an-email").status_code == 400


# --- Login and logout -------------------------------------------------------

def test_login_page_renders(client):
    assert client.get("/login").status_code == 200


def test_login_with_correct_password(client):
    user_id = add_user()
    response = client.post("/login", data={"email": "Student@Example.com", "password": PASSWORD})
    assert response.status_code == 302
    assert logged_in_id(client) == user_id


def test_login_with_wrong_password(client):
    add_user()
    response = client.post("/login", data={"email": "student@example.com", "password": "nope-nope"})
    assert response.status_code == 403
    assert "Wrong email or password" in response.get_data(as_text=True)
    assert logged_in_id(client) is None


def test_login_with_unknown_email_gives_same_message(client):
    response = client.post("/login", data={"email": "nobody@example.com", "password": PASSWORD})
    assert response.status_code == 403
    assert "Wrong email or password" in response.get_data(as_text=True)


def test_logout_clears_session(client):
    register(client)
    assert logged_in_id(client) is not None
    response = client.get("/logout")
    assert response.status_code == 302
    assert logged_in_id(client) is None
    assert "Log in" in client.get("/").get_data(as_text=True)


# --- Browsing: home, search, dorm, room type --------------------------------

@pytest.fixture
def drafts():
    """Add a draft room type to Demo Hall, and a dorm whose only type is a draft.

    Both reuse the sample single's geometry. Returns their ids.
    """
    single = db.execute("SELECT dorm_id, geometry FROM room_types WHERE name = 'Single (sample)'")[0]
    draft_id = db.execute(
        "INSERT INTO room_types (dorm_id, name, geometry, status) VALUES (?, 'Secret triple', ?, 'draft')",
        single["dorm_id"], single["geometry"],
    )
    hidden_dorm_id = db.execute("INSERT INTO dorms (name) VALUES ('Hidden House')")
    db.execute(
        "INSERT INTO room_types (dorm_id, name, geometry, status) VALUES (?, 'Quad', ?, 'draft')",
        hidden_dorm_id, single["geometry"],
    )
    return {"type": draft_id, "dorm_id": single["dorm_id"], "hidden_dorm": hidden_dorm_id}


def as_admin(client):
    """Log the client in as a newly created admin."""
    admin_id = db.execute("INSERT INTO users (email, hash, role) VALUES ('a@example.com', 'x', 'admin')")
    log_in(client, admin_id)


def test_feet_inches_filter():
    assert feet_inches(114) == "9′ 6″"
    assert feet_inches(144) == "12′ 0″"
    assert feet_inches(11) == "0′ 11″"
    assert feet_inches(100.6) == "8′ 5″"  # diagonal walls round to the nearest inch


def test_like_pattern_escapes_wildcards():
    assert like_pattern("double") == "%double%"
    assert like_pattern("100%_") == "%100\\%\\_%"


def test_home_links_to_dorm_page(client):
    page = client.get("/").get_data(as_text=True)
    dorm_id = db.execute("SELECT id FROM dorms WHERE name = 'Demo Hall'")[0]["id"]
    assert f'href="/dorms/{dorm_id}"' in page


def test_search_finds_room_type(client):
    page = client.get("/?q=DOUBLE").get_data(as_text=True)
    assert "Double (sample)" in page
    assert "Single (sample)" not in page


def test_search_finds_dorm(client):
    page = client.get("/?q=demo").get_data(as_text=True)
    assert "Demo Hall" in page


def test_search_with_no_matches(client):
    response = client.get("/?q=zzzz")
    assert response.status_code == 200
    assert "Nothing matches" in response.get_data(as_text=True)


def test_search_percent_sign_is_literal(client):
    # Unescaped, "%" would match every name.
    assert "Nothing matches" in client.get("/?q=%25").get_data(as_text=True)


def test_dorm_page_lists_room_types(client):
    dorm_id = db.execute("SELECT id FROM dorms WHERE name = 'Demo Hall'")[0]["id"]
    response = client.get(f"/dorms/{dorm_id}")
    assert response.status_code == 200
    page = response.get_data(as_text=True)
    assert "Single (sample)" in page
    assert "Double (sample)" in page
    assert "9′ 6″ × 12′ 6″" in page
    assert f'href="/plan/{type_id("Single (sample)")}"' in page


def test_missing_dorm_is_404(client):
    assert client.get("/dorms/9999").status_code == 404


def test_room_type_facts(client):
    response = client.get(f"/types/{type_id('Single (sample)')}")
    assert response.status_code == 200
    page = response.get_data(as_text=True)
    assert "9′ 6″ × 12′ 6″" in page
    assert "(114 × 150 in)" in page
    assert "118.8 sq ft" in page          # 114 × 150 / 144 = 118.75
    assert "8′ 6″" in page                # ceiling 102 in
    assert "Shared hallway bathroom" in page
    assert "Built-in closet" in page
    assert "Measured by Sample data, not a real room." in page   # no date recorded
    assert "measure big purchases against your own room" in page


def test_room_without_closet_mentions_wardrobe(client):
    page = client.get(f"/types/{type_id('Double (sample)')}").get_data(as_text=True)
    assert "Harvard provides a wardrobe" in page
    assert "192.0 sq ft" in page          # 144 × 192 / 144


def test_missing_room_type_is_404(client):
    assert client.get("/types/9999").status_code == 404


def test_drafts_hidden_from_visitors(client, drafts):
    assert client.get(f"/types/{drafts['type']}").status_code == 404
    assert "Secret triple" not in client.get(f"/dorms/{drafts['dorm_id']}").get_data(as_text=True)
    assert "Secret triple" not in client.get("/?q=secret").get_data(as_text=True)
    assert "Hidden House" not in client.get("/").get_data(as_text=True)


def test_drafts_hidden_from_students(client, drafts):
    log_in(client, add_user())
    assert client.get(f"/types/{drafts['type']}").status_code == 404
    assert "Secret triple" not in client.get(f"/dorms/{drafts['dorm_id']}").get_data(as_text=True)


def test_drafts_visible_to_admins(client, drafts):
    as_admin(client)
    response = client.get(f"/types/{drafts['type']}")
    assert response.status_code == 200
    assert "This room type is a draft" in response.get_data(as_text=True)
    dorm_page = client.get(f"/dorms/{drafts['dorm_id']}").get_data(as_text=True)
    assert "Secret triple" in dorm_page and "Draft" in dorm_page
    assert "Secret triple" in client.get("/?q=secret").get_data(as_text=True)
    assert "Hidden House" in client.get("/").get_data(as_text=True)


# --- Student pages: my room, my layouts (S6) --------------------------------

def assign_room(user_id, type_name="Single (sample)", number="B-21"):
    """Create a room of this type in its dorm and assign it to the user."""
    room_type = db.execute("SELECT id, dorm_id FROM room_types WHERE name = ?", type_name)[0]
    room_id = db.execute(
        "INSERT INTO rooms (dorm_id, number, room_type_id) VALUES (?, ?, ?)",
        room_type["dorm_id"], number, room_type["id"],
    )
    db.execute("INSERT INTO assignments (user_id, room_id) VALUES (?, ?)", user_id, room_id)
    return room_type["id"]


def add_layout(user_id, type_name, name, placements=1):
    """Insert a layout with this many beds and return its id."""
    layout_id = db.execute(
        "INSERT INTO layouts (user_id, room_type_id, name) VALUES (?, ?, ?)",
        user_id, type_id(type_name), name,
    )
    for _ in range(placements):
        db.execute(
            "INSERT INTO placements (layout_id, furniture_id, x, y) VALUES (?, 1, 20, 42)", layout_id
        )
    return layout_id


def test_my_room_needs_login(client):
    response = client.get("/my-room")
    assert response.status_code == 302
    assert response.headers["Location"] == "/login"


def test_my_room_without_assignment(client):
    log_in(client, add_user())
    response = client.get("/my-room")
    assert response.status_code == 200
    assert "No room has been assigned" in response.get_data(as_text=True)


def test_assigned_student_lands_on_their_planner(client):
    user_id = add_user()
    room_type_id = assign_room(user_id)
    log_in(client, user_id)
    response = client.get("/my-room")
    assert response.status_code == 302
    assert response.headers["Location"] == f"/plan/{room_type_id}"


def test_my_room_with_draft_type_explains(client):
    user_id = add_user()
    room_type_id = assign_room(user_id)
    db.execute("UPDATE room_types SET status = 'draft' WHERE id = ?", room_type_id)
    log_in(client, user_id)
    response = client.get("/my-room")
    assert response.status_code == 200
    page = response.get_data(as_text=True)
    assert "Demo Hall B-21" in page
    assert "isn't published yet" in page


def test_navbar_shows_my_room_only_when_assigned(client):
    user_id = add_user()
    log_in(client, user_id)
    page = client.get("/").get_data(as_text=True)
    assert "My layouts" in page
    assert "My room" not in page

    assign_room(user_id)
    assert "My room" in client.get("/").get_data(as_text=True)


def test_navbar_hides_student_links_when_logged_out(client):
    page = client.get("/").get_data(as_text=True)
    assert "My layouts" not in page and "My room" not in page


def test_my_layouts_needs_login(client):
    response = client.get("/layouts")
    assert response.status_code == 302
    assert response.headers["Location"] == "/login"


def test_my_layouts_empty(client):
    log_in(client, add_user())
    page = client.get("/layouts").get_data(as_text=True)
    assert "haven't saved any layouts" in page
    assert 'id="layouts-table"' not in page


def test_my_layouts_lists_own_layouts_across_rooms(client):
    me = add_user("me@example.com")
    other = add_user("other@example.com")
    single_layout = add_layout(me, "Single (sample)", "Cozy corner", placements=3)
    double_layout = add_layout(me, "Double (sample)", "Bunk-free")
    add_layout(other, "Single (sample)", "Not mine")

    log_in(client, me)
    page = client.get("/layouts").get_data(as_text=True)
    assert "Cozy corner" in page and "Bunk-free" in page
    assert "Not mine" not in page
    assert "Demo Hall · Single (sample)" in page
    assert f'href="/plan/{type_id("Single (sample)")}?layout={single_layout}"' in page
    assert f'data-layout-id="{double_layout}"' in page
    assert '<td class="text-end">3</td>' in page          # item count
    assert "/static/js/layouts.js" in page


def test_my_layouts_hides_layouts_of_draft_rooms(client):
    me = add_user()
    add_layout(me, "Single (sample)", "Hidden for now")
    db.execute("UPDATE room_types SET status = 'draft' WHERE name = 'Single (sample)'")
    log_in(client, me)
    assert "Hidden for now" not in client.get("/layouts").get_data(as_text=True)


# --- Planner page (P1) -------------------------------------------------------

def test_plan_page_passes_settings_as_data_attributes(client):
    single = type_id("Single (sample)")
    response = client.get(f"/plan/{single}")
    assert response.status_code == 200
    page = response.get_data(as_text=True)
    assert f'data-type-id="{single}"' in page
    assert 'data-layout-id=""' in page
    assert 'data-mode="edit"' in page
    assert 'data-logged-in="false"' in page
    assert '<canvas id="scene"' in page
    assert "/static/js/planner/main.js" in page
    assert "/static/css/planner.css" in page
    assert '"three": "/static/vendor/three/three.module.js"' in page   # import map


def test_plan_page_knows_when_logged_in(client):
    log_in(client, add_user())
    page = client.get(f"/plan/{type_id('Single (sample)')}").get_data(as_text=True)
    assert 'data-logged-in="true"' in page


def test_plan_page_404s(client):
    assert client.get("/plan/9999").status_code == 404
    single = type_id("Single (sample)")
    db.execute("UPDATE room_types SET status = 'draft' WHERE id = ?", single)
    assert client.get(f"/plan/{single}").status_code == 404


def test_plan_page_shows_drafts_to_admins(client):
    single = type_id("Single (sample)")
    db.execute("UPDATE room_types SET status = 'draft' WHERE id = ?", single)
    admin_id = db.execute("INSERT INTO users (email, hash, role) VALUES ('a@example.com', 'x', 'admin')")
    log_in(client, admin_id)
    assert client.get(f"/plan/{single}").status_code == 200


def test_other_pages_keep_the_container(client):
    assert '<main class="container py-4 flex-grow-1">' in client.get("/").get_data(as_text=True)
