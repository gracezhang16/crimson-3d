"""Tests for helpers.py (milestone S1): foreign keys, apology, current_user,
login_required and admin_required.

There are no real login or admin routes yet, so the decorators are tested on
a small throwaway Flask app with two fake routes. It uses the project's
templates and the "pages" blueprint, because apology.html extends layout.html,
which links to pages.index.
"""

from pathlib import Path

import pytest
from flask import Flask
from werkzeug.security import generate_password_hash

from helpers import admin_required, apology, current_user, db, login_required
from pages import pages

PROJECT_ROOT = Path(__file__).resolve().parent.parent


@pytest.fixture
def users():
    """Insert one student and one admin; delete them after the test.

    The test database is shared by every test in the run (see conftest.py),
    so we clean up to leave it as we found it.
    """
    student_id = db.execute(
        "INSERT INTO users (email, hash, role) VALUES (?, ?, 'student')",
        "student@example.com", generate_password_hash("test-password"),
    )
    admin_id = db.execute(
        "INSERT INTO users (email, hash, role) VALUES (?, ?, 'admin')",
        "admin@example.com", generate_password_hash("test-password"),
    )
    yield {"student": student_id, "admin": admin_id}
    db.execute("DELETE FROM users WHERE id IN (?, ?)", student_id, admin_id)


@pytest.fixture
def guard_client():
    """A test client for a throwaway app with one route behind each decorator."""
    # root_path makes Flask find templates/ and static/ in the project folder.
    test_app = Flask(__name__, root_path=str(PROJECT_ROOT))
    test_app.config.update(SECRET_KEY="test-only", TESTING=True)
    test_app.register_blueprint(pages)

    @test_app.route("/needs-login")
    @login_required
    def needs_login():
        return "student content"

    @test_app.route("/needs-admin")
    @admin_required
    def needs_admin():
        return "admin content"

    @test_app.route("/whoami")
    def whoami():
        user = current_user()
        return user["email"] if user else "nobody"

    @test_app.route("/oops")
    def oops():
        return apology("Something went wrong.", 418)

    with test_app.test_client() as client:
        yield client


def log_in(client, user_id):
    """Pretend to log in by writing user_id straight into the session cookie."""
    with client.session_transaction() as session:
        session["user_id"] = user_id


# --- Foreign keys -----------------------------------------------------------

def test_bad_foreign_key_is_rejected():
    # We can't read "PRAGMA foreign_keys" back to check it: cs50.SQL returns
    # True for PRAGMA statements, not rows. So we prove it by behaviour.
    # There is no dorm 9999 and no room type 9999, so SQLite must refuse the
    # row. cs50.SQL turns SQLite's IntegrityError into a ValueError.
    with pytest.raises(ValueError):
        db.execute(
            "INSERT INTO rooms (dorm_id, number, room_type_id) VALUES (?, ?, ?)",
            9999, "Z-99", 9999,
        )
    assert db.execute("SELECT COUNT(*) AS n FROM rooms WHERE number = 'Z-99'")[0]["n"] == 0


# --- apology ----------------------------------------------------------------

def test_apology_shows_message_and_status(guard_client):
    response = guard_client.get("/oops")
    assert response.status_code == 418
    page = response.get_data(as_text=True)
    assert "Something went wrong." in page
    assert "not affiliated with Harvard University" in page  # uses layout.html


# --- current_user -----------------------------------------------------------

def test_current_user_is_none_when_logged_out(guard_client):
    assert guard_client.get("/whoami").get_data(as_text=True) == "nobody"


def test_current_user_returns_the_logged_in_user(guard_client, users):
    log_in(guard_client, users["student"])
    assert guard_client.get("/whoami").get_data(as_text=True) == "student@example.com"


def test_current_user_is_none_for_a_deleted_user(guard_client):
    log_in(guard_client, 9999)
    assert guard_client.get("/whoami").get_data(as_text=True) == "nobody"


def test_current_user_leaves_out_the_password_hash(guard_client, users):
    with guard_client.application.test_request_context():
        from flask import session
        session["user_id"] = users["student"]
        assert "hash" not in current_user()


# --- login_required ---------------------------------------------------------

def test_login_required_redirects_logged_out_visitor(guard_client):
    response = guard_client.get("/needs-login")
    assert response.status_code == 302
    assert response.headers["Location"] == "/login"


def test_login_required_lets_student_in(guard_client, users):
    log_in(guard_client, users["student"])
    response = guard_client.get("/needs-login")
    assert response.status_code == 200
    assert response.get_data(as_text=True) == "student content"


# --- admin_required ---------------------------------------------------------

def test_admin_required_rejects_logged_out_visitor(guard_client):
    assert guard_client.get("/needs-admin").status_code == 403


def test_admin_required_rejects_student(guard_client, users):
    log_in(guard_client, users["student"])
    response = guard_client.get("/needs-admin")
    assert response.status_code == 403
    assert "Only admins" in response.get_data(as_text=True)


def test_admin_required_lets_admin_in(guard_client, users):
    log_in(guard_client, users["admin"])
    response = guard_client.get("/needs-admin")
    assert response.status_code == 200
    assert response.get_data(as_text=True) == "admin content"
