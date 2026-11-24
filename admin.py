"""Blueprint "admin": admin pages and admin JSON (Hannah). Routes: SPEC.md 7.3.

Registered at /admin in app.py, so "/types" here is served at /admin/types.
Every route must use @admin_required (helpers.py): anyone who isn't a
logged-in admin gets a 403 page. tests/test_admin.py checks this for every
/admin route automatically, including ones added later.
"""

import json
from datetime import date

from flask import Blueprint, flash, jsonify, redirect, render_template, request, session, url_for

from geometry import validate_room
from helpers import (admin_required, apology, db, insert_placements, json_error, normalize_email,
                     placements_error, run_in_transaction)

admin = Blueprint("admin", __name__)

# Limits for dorm fields (the spec gives none; these keep pages tidy).
MAX_DORM_NAME = 60
MAX_YARD = 60
MAX_DESCRIPTION = 500

# Room type fields (SPEC.md 5 and 9.1). Lengths are ours; the spec gives none.
ROOM_TYPE_FIELDS = ("dorm_id", "name", "capacity", "bathroom", "measured_by", "measured_on", "notes")
BATHROOMS = ("en-suite", "hallway", "shared-suite")
MAX_TYPE_NAME = 60
MAX_MEASURED_BY = 60
MAX_NOTES = 500
MAX_ROOM_NUMBER = 20


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


# ---------------------------------------------------------------------------
# Room builder: new, edit, publish (SPEC.md 7.3, 9.1)
# ---------------------------------------------------------------------------

def read_room_type_form(form, type_id=None):
    """Read and check the builder form. `type_id` is the room type being
    edited (so its own name doesn't count as a duplicate), or None.

    Returns (values, geometry_text, geometry, errors): the trimmed text
    fields (to show again if there are errors), the raw geometry JSON, the
    parsed geometry (or None), and a list of problems written for a person.
    The geometry is checked with geometry.validate_room(), the same rules the
    builder's preview applies, because a browser can always be bypassed.
    """
    values = {field: (form.get(field) or "").strip() for field in ROOM_TYPE_FIELDS}
    geometry_text = (form.get("geometry") or "").strip()
    errors = []

    if not values["dorm_id"].isdigit() or not db.execute(
        "SELECT id FROM dorms WHERE id = ?", int(values["dorm_id"])
    ):
        errors.append("Pick a dorm.")
    if not 1 <= len(values["name"]) <= MAX_TYPE_NAME:
        errors.append(f"Give the room type a name of 1 to {MAX_TYPE_NAME} characters.")
    elif not errors and db.execute(
        "SELECT id FROM room_types WHERE dorm_id = ? AND name = ? AND id != ?",
        int(values["dorm_id"]), values["name"], type_id or 0,
    ):
        # Checked here so every problem shows at once; the UNIQUE constraint
        # still catches two saves arriving at the same moment.
        errors.append(duplicate_name_error(values))
    if not values["capacity"].isdigit() or not 1 <= int(values["capacity"]) <= 6:
        errors.append("Capacity must be a whole number from 1 to 6.")
    if values["bathroom"] and values["bathroom"] not in BATHROOMS:
        errors.append("Pick a bathroom option from the list.")
    if len(values["measured_by"]) > MAX_MEASURED_BY:
        errors.append(f"Measured by can be at most {MAX_MEASURED_BY} characters.")
    if values["measured_on"] and not is_iso_date(values["measured_on"]):
        errors.append("Measured on must be a real date.")
    if len(values["notes"]) > MAX_NOTES:
        errors.append(f"Notes can be at most {MAX_NOTES} characters.")

    geometry = None
    if not geometry_text:
        errors.append("The room's shape is missing. Fix the problems shown under the preview.")
    else:
        try:
            geometry = json.loads(geometry_text)
        except ValueError:
            errors.append("The room's shape couldn't be read. Reload the page and try again.")
        else:
            errors.extend(validate_room(geometry))
    return values, geometry_text, geometry, errors


def is_iso_date(text):
    """True if text is a real date written as YYYY-MM-DD (what <input type=date> sends)."""
    try:
        date.fromisoformat(text)
    except ValueError:
        return False
    return True


def room_type_params(values, geometry):
    """The column values to store, in ROOM_TYPE_FIELDS order plus geometry."""
    return (
        int(values["dorm_id"]), values["name"], int(values["capacity"]),
        values["bathroom"] or None, values["measured_by"] or None,
        values["measured_on"] or None, values["notes"] or None,
        json.dumps(geometry),
    )


def duplicate_name_error(values):
    """The message for a name already used in that dorm (UNIQUE (dorm_id, name))."""
    dorm = db.execute("SELECT name FROM dorms WHERE id = ?", int(values["dorm_id"]))[0]["name"]
    return f"{dorm} already has a room type called {values['name']}."


def render_builder(room_type, values, geometry_text, errors=(), status=200):
    """Show the builder form, empty, filled from the database, or re-filled after errors."""
    dorms = db.execute("SELECT id, name FROM dorms ORDER BY name")
    return render_template(
        "admin/room_type_form.html", dorms=dorms, room_type=room_type,
        values=values, geometry_text=geometry_text, errors=errors,
    ), status


def find_room_type(type_id):
    """Return the room_types row with this id, or None."""
    rows = db.execute("SELECT * FROM room_types WHERE id = ?", type_id)
    return rows[0] if rows else None


@admin.route("/types/new", methods=["GET", "POST"])
@admin_required
def new_room_type():
    """The empty builder form; on POST, save it as a new draft room type.

    builder/main.js draws the live preview and fills the hidden "geometry"
    field; the browser won't submit while the preview shows problems.
    """
    if request.method == "GET":
        values = dict.fromkeys(ROOM_TYPE_FIELDS, "") | {"capacity": "1"}
        return render_builder(None, values, "")

    values, geometry_text, geometry, errors = read_room_type_form(request.form)
    if not errors:
        try:
            type_id = db.execute(
                "INSERT INTO room_types (dorm_id, name, capacity, bathroom, measured_by, "
                "measured_on, notes, geometry, status, created_by) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?)",
                *room_type_params(values, geometry), session["user_id"],
            )
        except ValueError:  # UNIQUE (dorm_id, name) failed
            errors.append(duplicate_name_error(values))
        else:
            flash("Saved draft. Use Preview in 3D to check it, then Publish.")
            return redirect(url_for("admin.edit_room_type", type_id=type_id))
    return render_builder(None, values, geometry_text, errors, 400)


@admin.route("/types/<int:type_id>/edit", methods=["GET", "POST"])
@admin_required
def edit_room_type(type_id):
    """The builder form filled in from the database; on POST, save the changes.

    A published room type stays published, so saved changes go live at once
    (the page warns about this).
    """
    room_type = find_room_type(type_id)
    if room_type is None:
        return apology("We couldn't find that room type.", 404)

    if request.method == "GET":
        values = {field: "" if room_type[field] is None else str(room_type[field])
                  for field in ROOM_TYPE_FIELDS}
        return render_builder(room_type, values, room_type["geometry"])

    values, geometry_text, geometry, errors = read_room_type_form(request.form, type_id)
    if not errors:
        try:
            db.execute(
                "UPDATE room_types SET dorm_id = ?, name = ?, capacity = ?, bathroom = ?, "
                "measured_by = ?, measured_on = ?, notes = ?, geometry = ?, "
                "updated = CURRENT_TIMESTAMP WHERE id = ?",
                *room_type_params(values, geometry), type_id,
            )
        except ValueError:  # UNIQUE (dorm_id, name) failed
            errors.append(duplicate_name_error(values))
        else:
            flash("Saved changes." + (" Students see them now." if room_type["status"] == "published" else ""))
            return redirect(url_for("admin.edit_room_type", type_id=type_id))
    return render_builder(room_type, values, geometry_text, errors, 400)


@admin.route("/types/<int:type_id>/publish", methods=["POST"])
@admin_required
def publish_room_type(type_id):
    """Publish a room type, but only if its saved geometry is valid (SPEC.md 7.3)."""
    room_type = find_room_type(type_id)
    if room_type is None:
        return apology("We couldn't find that room type.", 404)
    errors = validate_room(json.loads(room_type["geometry"]))
    if errors:
        flash(f"Can't publish {room_type['name']} yet: {errors[0]}")
    else:
        db.execute(
            "UPDATE room_types SET status = 'published', updated = CURRENT_TIMESTAMP WHERE id = ?",
            type_id,
        )
        flash(f"Published {room_type['name']}. Students can now find it.")
    return redirect(url_for("admin.edit_room_type", type_id=type_id))


@admin.route("/types/<int:type_id>/unpublish", methods=["POST"])
@admin_required
def unpublish_room_type(type_id):
    """Put a room type back to draft, hiding it (and its layouts) from students."""
    room_type = find_room_type(type_id)
    if room_type is None:
        return apology("We couldn't find that room type.", 404)
    db.execute(
        "UPDATE room_types SET status = 'draft', updated = CURRENT_TIMESTAMP WHERE id = ?",
        type_id,
    )
    flash(f"{room_type['name']} is a draft again. Only admins can see it.")
    return redirect(url_for("admin.edit_room_type", type_id=type_id))


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


# ---------------------------------------------------------------------------
# Default layout (SPEC.md 7.3, 9.3): what visitors see first in a room
# ---------------------------------------------------------------------------

@admin.route("/types/<int:type_id>/default-layout")
@admin_required
def default_layout(type_id):
    """The planner in admin-default mode: Save writes the room's default layout.

    Works for drafts too, so a room can be furnished before it's published.
    The planner loads the current default from /api/types/<id> as usual.
    """
    rows = db.execute(
        "SELECT room_types.id, room_types.name, room_types.status, "
        "dorms.id AS dorm_id, dorms.name AS dorm_name "
        "FROM room_types JOIN dorms ON dorms.id = room_types.dorm_id WHERE room_types.id = ?",
        type_id,
    )
    if not rows:
        return apology("We couldn't find that room type.", 404)
    return render_template("plan.html", room_type=rows[0], layout_id="", mode="admin-default")


@admin.route("/api/types/<int:type_id>/default-layout", methods=["PUT"])
@admin_required
def save_default_layout(type_id):
    """Replace a room type's default layout: {placements} -> {ok, updated}.

    The default layout is the layouts row with no owner and is_default = 1
    (SPEC.md 5). It is created if the room has none, so there is always at
    most one per room type. Placements are checked with
    geometry.validate_placements, as for students' layouts.
    """
    room_type = find_room_type(type_id)
    if room_type is None:
        return json_error("We couldn't find that room type.", 404)
    body = request.get_json(silent=True) if request.is_json else None
    if not isinstance(body, dict) or "placements" not in body:
        return json_error("Send {\"placements\": [...]} as JSON.", 400)
    placements = body["placements"]
    error = placements_error(placements, json.loads(room_type["geometry"]))
    if error:
        return json_error(error, 400)

    def save():
        rows = db.execute(
            "SELECT id FROM layouts WHERE room_type_id = ? AND user_id IS NULL AND is_default = 1",
            type_id,
        )
        if rows:
            layout_id = rows[0]["id"]
            db.execute("UPDATE layouts SET updated = CURRENT_TIMESTAMP WHERE id = ?", layout_id)
            db.execute("DELETE FROM placements WHERE layout_id = ?", layout_id)
        else:
            layout_id = db.execute(
                "INSERT INTO layouts (user_id, room_type_id, name, is_default) "
                "VALUES (NULL, ?, 'Default layout', 1)",
                type_id,
            )
        insert_placements(layout_id, placements)
        return layout_id

    layout_id = run_in_transaction(save)
    updated = db.execute("SELECT updated FROM layouts WHERE id = ?", layout_id)[0]["updated"]
    return jsonify({"ok": True, "updated": updated})


# ---------------------------------------------------------------------------
# Rooms and assignments (SPEC.md 7.3, 9.3)
# ---------------------------------------------------------------------------

@admin.route("/rooms", methods=["GET", "POST"])
@admin_required
def rooms():
    """List rooms with their students; on POST, add a room.

    A room is a thin record pointing at a room type (SPEC.md 1). Its dorm is
    taken from the room type, so the two can never disagree.
    """
    if request.method == "POST":
        add_room(request.form)
        return redirect(url_for("admin.rooms"))

    room_rows = db.execute(
        "SELECT rooms.id, rooms.number, dorms.name AS dorm_name, "
        "room_types.id AS type_id, room_types.name AS type_name, room_types.capacity "
        "FROM rooms JOIN dorms ON dorms.id = rooms.dorm_id "
        "JOIN room_types ON room_types.id = rooms.room_type_id "
        "ORDER BY dorms.name, rooms.number"
    )
    students = db.execute(
        "SELECT assignments.room_id, users.id, users.email FROM assignments "
        "JOIN users ON users.id = assignments.user_id ORDER BY users.email"
    )
    for room in room_rows:
        room["students"] = [s for s in students if s["room_id"] == room["id"]]
    types = db.execute(
        "SELECT room_types.id, room_types.name, room_types.status, dorms.name AS dorm_name "
        "FROM room_types JOIN dorms ON dorms.id = room_types.dorm_id "
        "ORDER BY dorms.name, room_types.name"
    )
    return render_template("admin/rooms.html", rooms=room_rows, types=types)


def add_room(form):
    """Add a room from the form, flashing what happened."""
    number = (form.get("number") or "").strip()
    type_id = form.get("room_type_id") or ""
    types = db.execute("SELECT id, dorm_id FROM room_types WHERE id = ?", int(type_id)) if type_id.isdigit() else []
    if not 1 <= len(number) <= MAX_ROOM_NUMBER:
        flash(f"Give the room a number of 1 to {MAX_ROOM_NUMBER} characters, like B-21.")
    elif not types:
        flash("Pick a room type for the room.")
    else:
        try:
            db.execute(
                "INSERT INTO rooms (dorm_id, number, room_type_id) VALUES (?, ?, ?)",
                types[0]["dorm_id"], number, types[0]["id"],
            )
        except ValueError:  # UNIQUE (dorm_id, number)
            flash(f"That dorm already has a room {number}.")
        else:
            flash(f"Added room {number}.")


def find_room(room_id):
    """Return the room with its dorm name and capacity, or None."""
    rows = db.execute(
        "SELECT rooms.id, rooms.number, dorms.name AS dorm_name, room_types.capacity "
        "FROM rooms JOIN dorms ON dorms.id = rooms.dorm_id "
        "JOIN room_types ON room_types.id = rooms.room_type_id WHERE rooms.id = ?",
        room_id,
    )
    return rows[0] if rows else None


@admin.route("/rooms/<int:room_id>/assign", methods=["POST"])
@admin_required
def assign_room(room_id):
    """Link a registered student (form field `email`) to this room.

    A student has at most one room (assignments.user_id is the primary key),
    so assigning someone who already has a room moves them. A room holds at
    most its room type's capacity.
    """
    room = find_room(room_id)
    if room is None:
        return apology("We couldn't find that room.", 404)
    email = normalize_email(request.form.get("email"))
    users = db.execute("SELECT id FROM users WHERE email = ?", email)
    label = f"{room['dorm_name']} {room['number']}"

    if not users:
        flash(f"No account with the email {email or '(blank)'}. Ask the student to register first.")
        return redirect(url_for("admin.rooms"))
    user_id = users[0]["id"]
    current = db.execute(
        "SELECT rooms.id, rooms.number, dorms.name AS dorm_name FROM assignments "
        "JOIN rooms ON rooms.id = assignments.room_id JOIN dorms ON dorms.id = rooms.dorm_id "
        "WHERE assignments.user_id = ?",
        user_id,
    )
    if current and current[0]["id"] == room_id:
        flash(f"{email} is already assigned to {label}.")
        return redirect(url_for("admin.rooms"))
    occupants = db.execute("SELECT COUNT(*) AS n FROM assignments WHERE room_id = ?", room_id)[0]["n"]
    if occupants >= room["capacity"]:
        flash(f"{label} is full (capacity {room['capacity']}). Unassign someone first.")
        return redirect(url_for("admin.rooms"))

    # INSERT OR REPLACE: if the student already has a row (a room), replace it.
    db.execute("INSERT OR REPLACE INTO assignments (user_id, room_id) VALUES (?, ?)", user_id, room_id)
    moved = f" (moved from {current[0]['dorm_name']} {current[0]['number']})" if current else ""
    flash(f"Assigned {email} to {label}{moved}.")
    return redirect(url_for("admin.rooms"))


@admin.route("/rooms/<int:room_id>/unassign", methods=["POST"])
@admin_required
def unassign_room(room_id):
    """Remove one student (form field `user_id`) from this room.

    SPEC.md 7.3 lists no field here; a double can have two students, so the
    form says which one.
    """
    room = find_room(room_id)
    if room is None:
        return apology("We couldn't find that room.", 404)
    user_id = request.form.get("user_id") or ""
    removed = db.execute(
        "DELETE FROM assignments WHERE room_id = ? AND user_id = ?",
        room_id, int(user_id) if user_id.isdigit() else -1,
    )
    if removed:
        flash(f"Unassigned from {room['dorm_name']} {room['number']}.")
    else:
        flash("That student isn't assigned to this room.")
    return redirect(url_for("admin.rooms"))
