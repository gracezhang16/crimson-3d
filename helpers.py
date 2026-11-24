"""Shared helpers for every blueprint: the database handle, the error page,
the login and admin guards, current_user(), the new-account checks shared
by /register and create_admin.py (SPEC.md 7.4), and saving placements.
"""

import os
from functools import wraps

from cs50 import SQL
from flask import jsonify, redirect, render_template, session

from geometry import validate_placements

# Tests point CRIMSON3D_DB at a temporary file so they never touch the real
# database (SPEC.md section 6).
DATABASE_URL = os.environ.get("CRIMSON3D_DB", "sqlite:///crimson3d.db")

if not os.path.isfile(DATABASE_URL.removeprefix("sqlite:///")):
    raise RuntimeError(f"No database at {DATABASE_URL}. Run `python init_db.py` first.")

# cs50.SQL already runs "PRAGMA foreign_keys = ON" on every new connection
# (checked in cs50 9.5.0, cs50/sql.py), so we don't repeat it here.
# tests/test_helpers.py proves a bad foreign key is rejected.
db = SQL(DATABASE_URL)


MIN_PASSWORD_LENGTH = 8


def normalize_email(text):
    """Trim spaces and lower-case an email, so Foo@x.com and foo@x.com are one account."""
    return (text or "").strip().lower()


def check_new_account(email, password, confirmation):
    """Return a message explaining what is wrong with a new account, or None if it is fine.

    Used by the register page and by create_admin.py so both apply the same
    rules. `email` should already be normalized. Whether the email is already
    taken is checked separately, by the database's UNIQUE constraint.
    """
    if not email or not password or not confirmation:
        return "Please fill in your email, a password and the confirmation."
    if "@" not in email or len(email) > 254:
        return "That doesn't look like an email address."
    if len(password) < MIN_PASSWORD_LENGTH:
        return f"Your password needs at least {MIN_PASSWORD_LENGTH} characters."
    if password != confirmation:
        return "The two passwords don't match."
    return None


def apology(message, code=400):
    """Render an error page with a message for a person and an HTTP status code."""
    return render_template("apology.html", message=message, code=code), code


def json_error(message, code=400):
    """Return a JSON error, {"error": message}, with an HTTP status code.

    The JSON twin of apology(), for /api and /admin/api (SPEC.md 7.2). Use
    400 for bad input, 401 for not logged in, 403 for not yours, 404 for
    not found.
    """
    return jsonify({"error": message}), code


def current_user():
    """Return the logged-in user's row as a dict, or None if nobody is logged in.

    The row has id, email, role, created, and room_id: the id of the room an
    admin assigned them, or None. (A LEFT JOIN keeps users who have no
    assignment, filling room_id with NULL.) It deliberately leaves out the
    password hash, so it is safe to pass to a template. It is also None if the
    session names a user who no longer exists (e.g. after a database rebuild).
    """
    user_id = session.get("user_id")
    if user_id is None:
        return None
    rows = db.execute(
        "SELECT users.id, users.email, users.role, users.created, assignments.room_id "
        "FROM users LEFT JOIN assignments ON assignments.user_id = users.id "
        "WHERE users.id = ?",
        user_id,
    )
    return rows[0] if rows else None


def viewer_is_admin():
    """Return True if the logged-in user is an admin."""
    user = current_user()
    return user is not None and user["role"] == "admin"


# SQL condition for "this room type may be shown to the viewer", used by every
# query that lists or opens room types for pages and the API. The ? is 1 for
# admins (who also see drafts) and 0 for everyone else (SPEC.md 7.1). Pass
# int(viewer_is_admin()) for it.
VISIBLE_TYPE = "(room_types.status = 'published' OR ?)"


def login_required(f):
    """Decorate a route so that logged-out visitors are sent to /login.

    Same as CS50 Finance. A decorator is a function that wraps another
    function: Flask calls `decorated_function`, which checks the session and
    only then calls the real route `f`. `@wraps(f)` keeps the route's own name,
    which Flask uses to tell routes apart.
    """
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if session.get("user_id") is None:
            return redirect("/login")
        return f(*args, **kwargs)
    return decorated_function


def api_login_required(f):
    """Like login_required, but for JSON routes: answer 401 instead of redirecting.

    The planner calls the API with fetch(); a redirect to the login page would
    hand it HTML it can't use. It checks the user still exists (not just that
    the session has an id), so a stale session after a database rebuild gets a
    clean 401 instead of a foreign-key error on save.
    """
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if current_user() is None:
            return json_error("Please log in to do that.", 401)
        return f(*args, **kwargs)
    return decorated_function


def admin_required(f):
    """Decorate a route so that only logged-in admins can use it.

    Anyone else, logged in or not, gets a 403 apology (SPEC.md 7.4). The role
    is read from the database on every request rather than stored in the
    session, so removing someone's admin role takes effect immediately.
    """
    @wraps(f)
    def decorated_function(*args, **kwargs):
        user = current_user()
        if user is None or user["role"] != "admin":
            return apology("Only admins can open this page.", 403)
        return f(*args, **kwargs)
    return decorated_function


# ---------------------------------------------------------------------------
# Saving placements, shared by the layouts API (api.py) and the admin's
# default-layout endpoint (admin.py, A6).
# ---------------------------------------------------------------------------

def placements_error(placements, geometry):
    """Return one message describing what is wrong with the placements, or None."""
    furniture_ids = {row["id"] for row in db.execute("SELECT id FROM furniture")}
    errors = validate_placements(placements, geometry, furniture_ids)
    if not errors:
        return None
    if len(errors) == 1:
        return errors[0]
    return f"{errors[0]} (and {len(errors) - 1} more problem{'s' if len(errors) > 2 else ''})"


def insert_placements(layout_id, placements):
    """Insert already-validated placements for a layout.

    x and y are rounded to whole inches (SPEC.md 4.4). Only custom items
    (furniture_id null) store a label and size; catalog items get theirs from
    the furniture table, so any extra fields sent with them are ignored.
    """
    for placement in placements:
        custom = placement["furniture_id"] is None
        db.execute(
            "INSERT INTO placements (layout_id, furniture_id, label, width, depth, height, x, y, rotation) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            layout_id, placement["furniture_id"],
            placement["label"].strip() if custom else None,
            placement["width"] if custom else None,
            placement["depth"] if custom else None,
            placement["height"] if custom else None,
            round(placement["x"]), round(placement["y"]), placement["rotation"],
        )


def run_in_transaction(work):
    """Run work() inside BEGIN ... COMMIT, rolling back if anything fails.

    A transaction makes several statements succeed or fail together, so a
    layout is never left with half its placements saved (SPEC.md 5).
    """
    db.execute("BEGIN TRANSACTION")
    try:
        result = work()
    except Exception:
        db.execute("ROLLBACK")
        raise
    db.execute("COMMIT")
    return result
