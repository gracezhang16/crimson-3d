"""Shared helpers for every blueprint: the database handle, the error page,
the login and admin guards, and current_user() (SPEC.md 7.4).
"""

import os
from functools import wraps

from cs50 import SQL
from flask import redirect, render_template, session

# Tests point CRIMSON3D_DB at a temporary file so they never touch the real
# database (SPEC.md section 6).
DATABASE_URL = os.environ.get("CRIMSON3D_DB", "sqlite:///crimson3d.db")

if not os.path.isfile(DATABASE_URL.removeprefix("sqlite:///")):
    raise RuntimeError(f"No database at {DATABASE_URL}. Run `python init_db.py` first.")

# cs50.SQL already runs "PRAGMA foreign_keys = ON" on every new connection
# (checked in cs50 9.5.0, cs50/sql.py), so we don't repeat it here.
# tests/test_helpers.py proves a bad foreign key is rejected.
db = SQL(DATABASE_URL)


def apology(message, code=400):
    """Render an error page with a message for a person and an HTTP status code."""
    return render_template("apology.html", message=message, code=code), code


def current_user():
    """Return the logged-in user's row as a dict, or None if nobody is logged in.

    The row deliberately leaves out the password hash, so it is safe to pass
    to a template. It is also None if the session names a user who no longer
    exists (for example after the database was rebuilt).
    """
    user_id = session.get("user_id")
    if user_id is None:
        return None
    rows = db.execute(
        "SELECT id, email, role, created FROM users WHERE id = ?", user_id
    )
    return rows[0] if rows else None


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
