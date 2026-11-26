"""Blueprint "admin": admin pages and admin JSON (Hannah). Routes: SPEC.md 7.3.

Registered at /admin in app.py, so "/types" here is served at /admin/types.
Every route must use @admin_required (helpers.py): anyone who isn't a
logged-in admin gets a 403 page. tests/test_admin.py checks this for every
/admin route automatically, including ones added later.
"""

import json
import re
from datetime import date

from flask import (Blueprint, current_app, flash, jsonify, redirect, render_template, request, session,
                   url_for)

import export_rooms
from geometry import validate_suite
from helpers import (admin_required, apology, db, insert_placements, json_error, normalize_email,
                     placements_error, run_in_transaction)

admin = Blueprint("admin", __name__)

# Limits for dorm fields (the spec gives none; these keep pages tidy).
MAX_DORM_NAME = 60
MAX_YARD = 60
MAX_DESCRIPTION = 500

# Suite type fields (SPEC.md 5 and 9.1). Lengths are ours; the spec gives none.
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
        "published": count("SELECT COUNT(*) AS n FROM suite_types WHERE status = 'published'"),
        "drafts": count("SELECT COUNT(*) AS n FROM suite_types WHERE status = 'draft'"),
        "dorms": count("SELECT COUNT(*) AS n FROM dorms"),
        "suites": count("SELECT COUNT(*) AS n FROM suites"),
        "students": count("SELECT COUNT(*) AS n FROM users WHERE role = 'student'"),
        "assigned": count("SELECT COUNT(*) AS n FROM assignments"),
        "furniture": count("SELECT COUNT(*) AS n FROM furniture"),
    }
    return render_template("admin/index.html", counts=counts)


@admin.route("/types")
@admin_required
def suite_types():
    """List every suite type, drafts included, grouped by dorm."""
    types = db.execute(
        "SELECT suite_types.id, suite_types.name, suite_types.status, suite_types.capacity, "
        "suite_types.updated, dorms.name AS dorm_name, "
        "(SELECT COUNT(*) FROM suites WHERE suites.suite_type_id = suite_types.id) AS room_count "
        "FROM suite_types JOIN dorms ON dorms.id = suite_types.dorm_id "
        "ORDER BY dorms.name, suite_types.name"
    )
    return render_template("admin/suite_types.html", types=types)


# ---------------------------------------------------------------------------
# Room builder: new, edit, publish (SPEC.md 7.3, 9.1)
# ---------------------------------------------------------------------------

def read_suite_type_form(form, type_id=None):
    """Read and check the builder form. `type_id` is the suite type being
    edited (so its own name doesn't count as a duplicate), or None.

    Returns (values, geometry_text, geometry, errors): the trimmed text
    fields (to show again if there are errors), the raw geometry JSON, the
    parsed geometry (or None), and a list of problems written for a person.
    The geometry is checked with geometry.validate_suite(), the same rules the
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
        errors.append(f"Give the suite type a name of 1 to {MAX_TYPE_NAME} characters.")
    elif not errors and db.execute(
        "SELECT id FROM suite_types WHERE dorm_id = ? AND name = ? AND id != ?",
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
            errors.extend(validate_suite(geometry))
    return values, geometry_text, geometry, errors


def is_iso_date(text):
    """True if text is a real date written as YYYY-MM-DD (what <input type=date> sends)."""
    try:
        date.fromisoformat(text)
    except ValueError:
        return False
    return True


def suite_type_params(values, geometry):
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
    return f"{dorm} already has a suite type called {values['name']}."


def render_builder(suite_type, values, geometry_text, errors=(), status=200):
    """Show the builder form, empty, filled from the database, or re-filled after errors."""
    dorms = db.execute("SELECT id, name FROM dorms ORDER BY name")
    return render_template(
        "admin/suite_type_form.html", dorms=dorms, suite_type=suite_type,
        values=values, geometry_text=geometry_text, errors=errors,
    ), status


def find_suite_type(type_id):
    """Return the suite_types row with this id, or None."""
    rows = db.execute("SELECT * FROM suite_types WHERE id = ?", type_id)
    return rows[0] if rows else None


@admin.route("/types/new", methods=["GET", "POST"])
@admin_required
def new_suite_type():
    """The empty builder form; on POST, save it as a new draft suite type.

    builder/main.js draws the live preview and fills the hidden "geometry"
    field; the browser won't submit while the preview shows problems.
    """
    if request.method == "GET":
        values = dict.fromkeys(ROOM_TYPE_FIELDS, "") | {"capacity": "1"}
        return render_builder(None, values, "")

    values, geometry_text, geometry, errors = read_suite_type_form(request.form)
    if not errors:
        try:
            type_id = db.execute(
                "INSERT INTO suite_types (dorm_id, name, capacity, bathroom, measured_by, "
                "measured_on, notes, geometry, status, created_by) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?)",
                *suite_type_params(values, geometry), session["user_id"],
            )
        except ValueError:  # UNIQUE (dorm_id, name) failed
            errors.append(duplicate_name_error(values))
        else:
            flash("Saved draft. Use Preview in 3D to check it, then Publish.")
            return redirect(url_for("admin.edit_suite_type", type_id=type_id))
    return render_builder(None, values, geometry_text, errors, 400)


@admin.route("/types/<int:type_id>/edit", methods=["GET", "POST"])
@admin_required
def edit_suite_type(type_id):
    """The builder form filled in from the database; on POST, save the changes.

    A published suite type stays published, so saved changes go live at once
    (the page warns about this).
    """
    suite_type = find_suite_type(type_id)
    if suite_type is None:
        return apology("We couldn't find that suite type.", 404)

    if request.method == "GET":
        values = {field: "" if suite_type[field] is None else str(suite_type[field])
                  for field in ROOM_TYPE_FIELDS}
        return render_builder(suite_type, values, suite_type["geometry"])

    values, geometry_text, geometry, errors = read_suite_type_form(request.form, type_id)
    if not errors:
        try:
            db.execute(
                "UPDATE suite_types SET dorm_id = ?, name = ?, capacity = ?, bathroom = ?, "
                "measured_by = ?, measured_on = ?, notes = ?, geometry = ?, "
                "updated = CURRENT_TIMESTAMP WHERE id = ?",
                *suite_type_params(values, geometry), type_id,
            )
        except ValueError:  # UNIQUE (dorm_id, name) failed
            errors.append(duplicate_name_error(values))
        else:
            flash("Saved changes." + (" Students see them now." if suite_type["status"] == "published" else ""))
            return redirect(url_for("admin.edit_suite_type", type_id=type_id))
    return render_builder(suite_type, values, geometry_text, errors, 400)


@admin.route("/types/<int:type_id>/publish", methods=["POST"])
@admin_required
def publish_suite_type(type_id):
    """Publish a suite type, but only if its saved geometry is valid (SPEC.md 7.3)."""
    suite_type = find_suite_type(type_id)
    if suite_type is None:
        return apology("We couldn't find that suite type.", 404)
    errors = validate_suite(json.loads(suite_type["geometry"]))
    if errors:
        flash(f"Can't publish {suite_type['name']} yet: {errors[0]}")
    else:
        db.execute(
            "UPDATE suite_types SET status = 'published', updated = CURRENT_TIMESTAMP WHERE id = ?",
            type_id,
        )
        flash(f"Published {suite_type['name']}. Students can now find it.")
    return redirect(url_for("admin.edit_suite_type", type_id=type_id))


@admin.route("/types/<int:type_id>/unpublish", methods=["POST"])
@admin_required
def unpublish_suite_type(type_id):
    """Put a suite type back to draft, hiding it (and its layouts) from students."""
    suite_type = find_suite_type(type_id)
    if suite_type is None:
        return apology("We couldn't find that suite type.", 404)
    db.execute(
        "UPDATE suite_types SET status = 'draft', updated = CURRENT_TIMESTAMP WHERE id = ?",
        type_id,
    )
    flash(f"{suite_type['name']} is a draft again. Only admins can see it.")
    return redirect(url_for("admin.edit_suite_type", type_id=type_id))


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
        "SELECT dorms.id, dorms.name, dorms.yard, COUNT(suite_types.id) AS type_count "
        "FROM dorms LEFT JOIN suite_types ON suite_types.dorm_id = dorms.id "
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
        "SELECT suite_types.id, suite_types.name, suite_types.status, "
        "dorms.id AS dorm_id, dorms.name AS dorm_name "
        "FROM suite_types JOIN dorms ON dorms.id = suite_types.dorm_id WHERE suite_types.id = ?",
        type_id,
    )
    if not rows:
        return apology("We couldn't find that suite type.", 404)
    return render_template("plan.html", suite_type=rows[0], layout_id="", mode="admin-default")


@admin.route("/api/types/<int:type_id>/default-layout", methods=["PUT"])
@admin_required
def save_default_layout(type_id):
    """Replace a suite type's default layout: {placements} -> {ok, updated}.

    The default layout is the layouts row with no owner and is_default = 1
    (SPEC.md 5). It is created if the room has none, so there is always at
    most one per suite type. Placements are checked with
    geometry.validate_placements, as for students' layouts.
    """
    suite_type = find_suite_type(type_id)
    if suite_type is None:
        return json_error("We couldn't find that suite type.", 404)
    body = request.get_json(silent=True) if request.is_json else None
    if not isinstance(body, dict) or "placements" not in body:
        return json_error("Send {\"placements\": [...]} as JSON.", 400)
    placements = body["placements"]
    error = placements_error(placements, json.loads(suite_type["geometry"]))
    if error:
        return json_error(error, 400)

    def save():
        rows = db.execute(
            "SELECT id FROM layouts WHERE suite_type_id = ? AND user_id IS NULL AND is_default = 1",
            type_id,
        )
        if rows:
            layout_id = rows[0]["id"]
            db.execute("UPDATE layouts SET updated = CURRENT_TIMESTAMP WHERE id = ?", layout_id)
            db.execute("DELETE FROM placements WHERE layout_id = ?", layout_id)
        else:
            layout_id = db.execute(
                "INSERT INTO layouts (user_id, suite_type_id, name, is_default) "
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

@admin.route("/suites", methods=["GET", "POST"])
@admin_required
def suites():
    """List rooms with their students; on POST, add a room.

    A room is a thin record pointing at a suite type (SPEC.md 1). Its dorm is
    taken from the suite type, so the two can never disagree.
    """
    if request.method == "POST":
        add_suite(request.form)
        return redirect(url_for("admin.suites"))

    room_rows = db.execute(
        "SELECT suites.id, suites.number, dorms.name AS dorm_name, "
        "suite_types.id AS type_id, suite_types.name AS type_name, suite_types.capacity "
        "FROM suites JOIN dorms ON dorms.id = suites.dorm_id "
        "JOIN suite_types ON suite_types.id = suites.suite_type_id "
        "ORDER BY dorms.name, suites.number"
    )
    students = db.execute(
        "SELECT assignments.suite_id, users.id, users.email FROM assignments "
        "JOIN users ON users.id = assignments.user_id ORDER BY users.email"
    )
    for room in room_rows:
        room["students"] = [s for s in students if s["suite_id"] == room["id"]]
    types = db.execute(
        "SELECT suite_types.id, suite_types.name, suite_types.status, dorms.name AS dorm_name "
        "FROM suite_types JOIN dorms ON dorms.id = suite_types.dorm_id "
        "ORDER BY dorms.name, suite_types.name"
    )
    return render_template("admin/suites.html", suites=room_rows, types=types)


def add_suite(form):
    """Add a room from the form, flashing what happened."""
    number = (form.get("number") or "").strip()
    type_id = form.get("suite_type_id") or ""
    types = db.execute("SELECT id, dorm_id FROM suite_types WHERE id = ?", int(type_id)) if type_id.isdigit() else []
    if not 1 <= len(number) <= MAX_ROOM_NUMBER:
        flash(f"Give the suite a number of 1 to {MAX_ROOM_NUMBER} characters, like B-21.")
    elif not types:
        flash("Pick a suite type for the suite.")
    else:
        try:
            db.execute(
                "INSERT INTO suites (dorm_id, number, suite_type_id) VALUES (?, ?, ?)",
                types[0]["dorm_id"], number, types[0]["id"],
            )
        except ValueError:  # UNIQUE (dorm_id, number)
            flash(f"That dorm already has a suite {number}.")
        else:
            flash(f"Added suite {number}.")


def find_suite(suite_id):
    """Return the room with its dorm name and capacity, or None."""
    rows = db.execute(
        "SELECT suites.id, suites.number, dorms.name AS dorm_name, suite_types.capacity "
        "FROM suites JOIN dorms ON dorms.id = suites.dorm_id "
        "JOIN suite_types ON suite_types.id = suites.suite_type_id WHERE suites.id = ?",
        suite_id,
    )
    return rows[0] if rows else None


@admin.route("/suites/<int:suite_id>/assign", methods=["POST"])
@admin_required
def assign_suite(suite_id):
    """Link a registered student (form field `email`) to this room.

    A student has at most one room (assignments.user_id is the primary key),
    so assigning someone who already has a room moves them. A room holds at
    most its suite type's capacity.
    """
    room = find_suite(suite_id)
    if room is None:
        return apology("We couldn't find that suite.", 404)
    email = normalize_email(request.form.get("email"))
    users = db.execute("SELECT id FROM users WHERE email = ?", email)
    label = f"{room['dorm_name']} {room['number']}"

    if not users:
        flash(f"No account with the email {email or '(blank)'}. Ask the student to register first.")
        return redirect(url_for("admin.suites"))
    user_id = users[0]["id"]
    current = db.execute(
        "SELECT suites.id, suites.number, dorms.name AS dorm_name FROM assignments "
        "JOIN suites ON suites.id = assignments.suite_id JOIN dorms ON dorms.id = suites.dorm_id "
        "WHERE assignments.user_id = ?",
        user_id,
    )
    if current and current[0]["id"] == suite_id:
        flash(f"{email} is already assigned to {label}.")
        return redirect(url_for("admin.suites"))
    occupants = db.execute("SELECT COUNT(*) AS n FROM assignments WHERE suite_id = ?", suite_id)[0]["n"]
    if occupants >= room["capacity"]:
        flash(f"{label} is full (capacity {room['capacity']}). Unassign someone first.")
        return redirect(url_for("admin.suites"))

    # INSERT OR REPLACE: if the student already has a row (a room), replace it.
    db.execute("INSERT OR REPLACE INTO assignments (user_id, suite_id) VALUES (?, ?)", user_id, suite_id)
    moved = f" (moved from {current[0]['dorm_name']} {current[0]['number']})" if current else ""
    flash(f"Assigned {email} to {label}{moved}.")
    return redirect(url_for("admin.suites"))


@admin.route("/suites/<int:suite_id>/unassign", methods=["POST"])
@admin_required
def unassign_suite(suite_id):
    """Remove one student (form field `user_id`) from this room.

    SPEC.md 7.3 lists no field here; a double can have two students, so the
    form says which one.
    """
    room = find_suite(suite_id)
    if room is None:
        return apology("We couldn't find that suite.", 404)
    user_id = request.form.get("user_id") or ""
    removed = db.execute(
        "DELETE FROM assignments WHERE suite_id = ? AND user_id = ?",
        suite_id, int(user_id) if user_id.isdigit() else -1,
    )
    if removed:
        flash(f"Unassigned from {room['dorm_name']} {room['number']}.")
    else:
        flash("That student isn't assigned to this suite.")
    return redirect(url_for("admin.suites"))


# ---------------------------------------------------------------------------
# Furniture catalog (A7). Saved layouts store a furniture id, not a size, so
# changing an item here changes it in every planner straight away.
# ---------------------------------------------------------------------------

FURNITURE_FIELDS = ("name", "slug", "category", "width", "depth", "height", "clearance", "color", "note")
CATEGORIES = ("harvard", "purchase")
MAX_FURNITURE_NAME = 60
MAX_SLUG = 40
MAX_FURNITURE_NOTE = 200
# Limits match the CHECK constraints in schema.sql and SPEC.md 4.4.
SIZE_LIMITS = {"width": 200, "depth": 200, "height": 120}
SLUG_PATTERN = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")   # e.g. "bed-twin-xl"
COLOR_PATTERN = re.compile(r"^#[0-9a-fA-F]{6}$")          # e.g. "#b8875a"


@admin.route("/furniture")
@admin_required
def furniture():
    """The whole catalog, with how many layouts use each item."""
    items = db.execute(
        "SELECT furniture.*, COUNT(DISTINCT placements.layout_id) AS layout_count "
        "FROM furniture LEFT JOIN placements ON placements.furniture_id = furniture.id "
        "GROUP BY furniture.id ORDER BY furniture.category = 'purchase', furniture.name"
    )
    return render_template("admin/furniture.html", items=items)


@admin.route("/furniture/new", methods=["GET", "POST"])
@admin_required
def new_furniture():
    """Add a catalog item."""
    values = {field: "" for field in FURNITURE_FIELDS}
    values.update(category="purchase", clearance="0", color="#8a8f96")
    errors = []
    if request.method == "POST":
        values = furniture_form_values()
        errors, clean = furniture_problems(values, new=True)
        if not errors:
            try:
                db.execute(
                    "INSERT INTO furniture (slug, name, category, width, depth, height, clearance, color, note) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    clean["slug"], clean["name"], clean["category"], clean["width"], clean["depth"],
                    clean["height"], clean["clearance"], clean["color"], clean["note"],
                )
            except ValueError:  # UNIQUE (slug) failed
                errors = [f"Another item already uses the slug {clean['slug']}."]
            else:
                flash(f"Added {clean['name']} to the catalog.")
                return redirect(url_for("admin.furniture"))
    return render_template("admin/furniture_form.html", item=None, values=values, errors=errors), \
        400 if errors else 200


@admin.route("/furniture/<int:furniture_id>/edit", methods=["GET", "POST"])
@admin_required
def edit_furniture(furniture_id):
    """Change a catalog item's name, category, size, colour or note.

    The slug can't change: the planner picks an item's 3D shape by its slug
    (static/js/planner/shapes.js), and seed files refer to items by slug.
    """
    rows = db.execute("SELECT * FROM furniture WHERE id = ?", furniture_id)
    if not rows:
        return apology("We couldn't find that furniture item.", 404)
    item = rows[0]
    values = {field: "" if item[field] is None else str(item[field]) for field in FURNITURE_FIELDS}
    errors = []
    if request.method == "POST":
        values = furniture_form_values()
        values["slug"] = item["slug"]
        errors, clean = furniture_problems(values, new=False)
        if not errors:
            db.execute(
                "UPDATE furniture SET name = ?, category = ?, width = ?, depth = ?, height = ?, "
                "clearance = ?, color = ?, note = ? WHERE id = ?",
                clean["name"], clean["category"], clean["width"], clean["depth"], clean["height"],
                clean["clearance"], clean["color"], clean["note"], furniture_id,
            )
            flash(f"Saved {clean['name']}. Every planner uses the new details now.")
            return redirect(url_for("admin.furniture"))
    return render_template("admin/furniture_form.html", item=item, values=values, errors=errors), \
        400 if errors else 200


@admin.route("/furniture/<int:furniture_id>/delete", methods=["POST"])
@admin_required
def delete_furniture(furniture_id):
    """Delete a catalog item, but only if no layout (saved or default) uses it."""
    rows = db.execute("SELECT name FROM furniture WHERE id = ?", furniture_id)
    if not rows:
        return apology("We couldn't find that furniture item.", 404)
    name = rows[0]["name"]
    layouts = count("SELECT COUNT(DISTINCT layout_id) AS n FROM placements WHERE furniture_id = ?", furniture_id)
    if layouts:
        flash(f"Can't delete {name}: {layouts} layout{'' if layouts == 1 else 's'} use it. "
              "Remove it from them first, or change it instead.")
    else:
        db.execute("DELETE FROM furniture WHERE id = ?", furniture_id)
        flash(f"Deleted {name} from the catalog.")
    return redirect(url_for("admin.furniture"))


def furniture_form_values():
    """The submitted furniture fields as trimmed strings."""
    return {field: (request.form.get(field) or "").strip() for field in FURNITURE_FIELDS}


def furniture_problems(values, new):
    """Check a furniture form. Returns (errors, clean values ready to save).

    `new` is True when adding an item, the only time the slug is checked.
    """
    errors = []
    clean = {"name": values["name"], "slug": values["slug"], "category": values["category"],
             "color": values["color"].lower(), "note": values["note"] or None}
    if not 1 <= len(clean["name"]) <= MAX_FURNITURE_NAME:
        errors.append(f"Give the item a name of 1 to {MAX_FURNITURE_NAME} characters.")
    if new and not (len(clean["slug"]) <= MAX_SLUG and SLUG_PATTERN.match(clean["slug"])):
        errors.append(f"The slug must be up to {MAX_SLUG} lowercase letters and digits joined by hyphens, "
                      "like storage-bin.")
    if clean["category"] not in CATEGORIES:
        errors.append("Choose whether Harvard supplies it or students buy it.")
    for field, limit in SIZE_LIMITS.items():
        clean[field] = whole_number(values[field])
        if clean[field] is None or not 1 <= clean[field] <= limit:
            errors.append(f"The {field} must be a whole number of inches from 1 to {limit}.")
    clean["clearance"] = whole_number(values["clearance"] or "0")
    if clean["clearance"] is None or clean["clearance"] < 0:
        errors.append("The clearance must be a whole number of inches, 0 or more.")
    elif clean["height"] is not None and clean["clearance"] >= clean["height"]:
        errors.append(f"The clearance (space underneath) must be less than the height ({clean['height']} in).")
    if not COLOR_PATTERN.match(clean["color"]):
        errors.append("Pick a colour, written like #b8875a.")
    if len(values["note"]) > MAX_FURNITURE_NOTE:
        errors.append(f"The note can be at most {MAX_FURNITURE_NOTE} characters.")
    return errors, clean


def whole_number(text):
    """'42' -> 42; anything that isn't a whole number -> None."""
    return int(text) if text.isdigit() else None


# ---------------------------------------------------------------------------
# Export (A9): write the database back to seed/ so it can be committed
# ---------------------------------------------------------------------------

@admin.route("/export", methods=["GET", "POST"])
@admin_required
def export():
    """Explain the export (GET), or run it and show which files changed (POST).

    This runs the same code as `python export_rooms.py`. It writes into the
    seed/ folder of the copy of the code the server is running from, so it is
    meant for a team member's own computer: the files still have to be
    committed with git to reach everyone else.

    app.config["SEED_DIR"] can point somewhere else; the tests use that so
    they never write into the real seed/.
    """
    report, error = None, None
    if request.method == "POST":
        seed_dir = current_app.config.get("SEED_DIR", export_rooms.SEED_DIR)
        try:
            report = export_rooms.export_seed(db, seed_dir)
        except OSError as exception:  # e.g. a server where the code folder is read-only
            error = f"Couldn't write the seed files: {exception.strerror or exception}."
    return render_template("admin/export.html", report=report, error=error), 500 if error else 200
