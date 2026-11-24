"""Route tests (Grace): home page, register, login, logout. Later milestones
add ownership, draft visibility and the layout save round trip (SPEC.md 11)."""

from werkzeug.security import check_password_hash, generate_password_hash

from helpers import db

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
