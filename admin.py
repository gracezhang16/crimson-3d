"""Blueprint "admin": admin pages and admin JSON (Hannah). Routes: SPEC.md 7.3.

Registered at /admin in app.py, so "/types" here is served at /admin/types.
Every route must use @admin_required (helpers.py): anyone who isn't a
logged-in admin gets a 403 page. tests/test_admin.py checks this for every
/admin route automatically, including ones added later.
"""

from flask import Blueprint, flash, redirect, render_template, request, url_for

from helpers import admin_required, db

admin = Blueprint("admin", __name__)

# Limits for dorm fields (the spec gives none; these keep pages tidy).
MAX_DORM_NAME = 60
MAX_YARD = 60
MAX_DESCRIPTION = 500


def count(sql, *args):
    """Run a SELECT COUNT(*) AS n query and return the number."""
    return db.execute(sql, *args)[0]["n"]


@admin.route("")
@admin_required
def index():
    """Admin home: a few counts and links to each admin page.

    The route is "" rather than "/" so the page is at /admin, not /admin/.
    """
    counts = {
        "published": count("SELECT COUNT(*) AS n FROM room_types WHERE status = 'published'"),
        "drafts": count("SELECT COUNT(*) AS n FROM room_types WHERE status = 'draft'"),
        "dorms": count("SELECT COUNT(*) AS n FROM dorms"),
        "rooms": count("SELECT COUNT(*) AS n FROM rooms"),
        "students": count("SELECT COUNT(*) AS n FROM users WHERE role = 'student'"),
        "assigned": count("SELECT COUNT(*) AS n FROM assignments"),
        "furniture": count("SELECT COUNT(*) AS n FROM furniture"),
    }
    return render_template("admin/index.html", counts=counts)


@admin.route("/types")
@admin_required
def room_types():
    """List every room type, drafts included, grouped by dorm."""
    types = db.execute(
        "SELECT room_types.id, room_types.name, room_types.status, room_types.capacity, "
        "room_types.updated, dorms.name AS dorm_name, "
        "(SELECT COUNT(*) FROM rooms WHERE rooms.room_type_id = room_types.id) AS room_count "
        "FROM room_types JOIN dorms ON dorms.id = room_types.dorm_id "
        "ORDER BY dorms.name, room_types.name"
    )
    return render_template("admin/room_types.html", types=types)


@admin.route("/types/new")
@admin_required
def new_room_type():
    """The room builder form, empty (SPEC.md 9.1).

    builder/main.js draws the live preview and fills the hidden "geometry"
    field. Saving (POST) arrives in A4, the features table in A3.
    """
    dorms = db.execute("SELECT id, name FROM dorms ORDER BY name")
    return render_template("admin/room_type_form.html", dorms=dorms)


@admin.route("/dorms", methods=["GET", "POST"])
@admin_required
def dorms():
    """List dorms, and add one.

    Pulled forward from A7 so that real dorms can be added before the builder
    is used (see docs/decisions.md, A2).
    """
    form = {"name": "", "yard": "", "description": ""}
    error = None
    if request.method == "POST":
        form = {field: (request.form.get(field) or "").strip() for field in form}
        error = dorm_problem(form)
        if not error:
            try:
                db.execute(
                    "INSERT INTO dorms (name, yard, description) VALUES (?, ?, ?)",
                    form["name"], form["yard"] or None, form["description"] or None,
                )
            except ValueError:  # UNIQUE (name) failed
                error = f"There is already a dorm called {form['name']}."
            else:
                flash(f"Added {form['name']}.")
                # Redirect after a successful POST, so reloading the page
                # doesn't submit the form again.
                return redirect(url_for("admin.dorms"))

    rows = db.execute(
        "SELECT dorms.id, dorms.name, dorms.yard, COUNT(room_types.id) AS type_count "
        "FROM dorms LEFT JOIN room_types ON room_types.dorm_id = dorms.id "
        "GROUP BY dorms.id ORDER BY dorms.name"
    )
    status = 400 if error else 200
    return render_template("admin/dorms.html", dorms=rows, form=form, error=error), status


def dorm_problem(form):
    """Return what is wrong with a new dorm's (trimmed) fields, or None."""
    if not 1 <= len(form["name"]) <= MAX_DORM_NAME:
        return f"Give the dorm a name of 1 to {MAX_DORM_NAME} characters."
    if len(form["yard"]) > MAX_YARD:
        return f"The yard can be at most {MAX_YARD} characters."
    if len(form["description"]) > MAX_DESCRIPTION:
        return f"The description can be at most {MAX_DESCRIPTION} characters."
    return None
