"""Blueprint "pages": public and student HTML pages (Grace). Routes: SPEC.md 7.1."""

import json

from flask import Blueprint, flash, redirect, render_template, request, session
from werkzeug.security import check_password_hash, generate_password_hash

from geometry import signed_area
from helpers import (VISIBLE_TYPE, apology, check_new_account, db, login_required,
                     normalize_email, viewer_is_admin)

pages = Blueprint("pages", __name__)

# How each `room_types.bathroom` value is shown to students.
BATHROOM_LABELS = {
    "en-suite": "En-suite (in the room)",
    "hallway": "Shared hallway bathroom",
    "shared-suite": "Shared with the suite",
}

# ---------------------------------------------------------------------------
# Helpers for these pages
# ---------------------------------------------------------------------------

@pages.app_template_filter("feet_inches")
def feet_inches(inches):
    """Format a length in inches as feet and inches, e.g. 114 -> 9′ 6″.

    A Jinja filter is a function templates call with a pipe:
    {{ 114 | feet_inches }}. app_template_filter registers it for every
    template in the app, not only this blueprint's.
    """
    feet, rest = divmod(round(inches), 12)
    return f"{feet}′ {rest}″"


def room_facts(geometry):
    """Work out the numbers a student cares about from a room's geometry.

    Returns a dict with the overall width (east-west) and length
    (north-south) in inches, whether the room is a plain rectangle, the floor
    area in square feet, the ceiling height, whether there is a built-in
    closet, and how many windows there are.
    """
    outline = geometry["outline"]
    xs = [x for x, _ in outline]
    ys = [y for _, y in outline]
    width, length = max(xs) - min(xs), max(ys) - min(ys)
    area = abs(signed_area(outline))  # square inches
    kinds = [feature["kind"] for feature in geometry["features"]]
    return {
        "width": width,
        "length": length,
        # A 4-corner outline that fills its bounding box is a rectangle. For
        # any other shape, width × length is only the overall size.
        "is_rectangle": len(outline) == 4 and area == width * length,
        "area_sq_ft": area / 144,
        "ceiling": geometry["ceiling"],
        "has_closet": "closet" in kinds,
        "windows": kinds.count("window"),
    }


def with_facts(room_type):
    """Add `facts` and `bathroom_label` to a room_types row (a dict) and return it."""
    room_type["facts"] = room_facts(json.loads(room_type["geometry"]))
    room_type["bathroom_label"] = BATHROOM_LABELS.get(room_type["bathroom"], "Not recorded")
    return room_type


def like_pattern(text):
    """Turn search text into a LIKE pattern that matches it anywhere in a name.

    In LIKE, % means "any characters" and _ means "any one character". We
    escape those (and the escape character \\ itself) so that typing them
    searches for them literally. Queries using this need ESCAPE '\\'.
    """
    escaped = text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


# ---------------------------------------------------------------------------
# Browsing: home, dorm, room type
# ---------------------------------------------------------------------------

@pages.route("/")
def index():
    """List dorms, or with ?q=... show dorms and room types whose names match.

    Only dorms with at least one room type the viewer may see are listed.
    """
    query = (request.args.get("q") or "").strip()
    admin = int(viewer_is_admin())

    if not query:
        dorms = db.execute(
            "SELECT dorms.id, dorms.name, dorms.yard, COUNT(room_types.id) AS type_count "
            "FROM dorms JOIN room_types ON room_types.dorm_id = dorms.id "
            f"WHERE {VISIBLE_TYPE} "
            "GROUP BY dorms.id ORDER BY dorms.name",
            admin,
        )
        return render_template("index.html", dorms=dorms, query="")

    pattern = like_pattern(query)
    dorms = db.execute(
        "SELECT dorms.id, dorms.name, dorms.yard, COUNT(room_types.id) AS type_count "
        "FROM dorms JOIN room_types ON room_types.dorm_id = dorms.id "
        f"WHERE {VISIBLE_TYPE} AND dorms.name LIKE ? ESCAPE '\\' "
        "GROUP BY dorms.id ORDER BY dorms.name",
        admin, pattern,
    )
    room_types = db.execute(
        "SELECT room_types.id, room_types.name, room_types.status, dorms.name AS dorm_name "
        "FROM room_types JOIN dorms ON dorms.id = room_types.dorm_id "
        f"WHERE {VISIBLE_TYPE} AND room_types.name LIKE ? ESCAPE '\\' "
        "ORDER BY dorms.name, room_types.name",
        admin, pattern,
    )
    return render_template("index.html", dorms=dorms, room_types=room_types, query=query)


@pages.route("/dorms/<int:dorm_id>")
def dorm(dorm_id):
    """Show one dorm and its room types as cards (drafts only for admins)."""
    rows = db.execute("SELECT id, name, yard, description FROM dorms WHERE id = ?", dorm_id)
    if not rows:
        return apology("We couldn't find that dorm.", 404)

    room_types = db.execute(
        "SELECT id, name, capacity, bathroom, geometry, status FROM room_types "
        f"WHERE dorm_id = ? AND {VISIBLE_TYPE} ORDER BY capacity, name",
        dorm_id, int(viewer_is_admin()),
    )
    return render_template(
        "dorm.html", dorm=rows[0], room_types=[with_facts(row) for row in room_types]
    )


@pages.route("/types/<int:type_id>")
def room_type(type_id):
    """Show the facts card for one room type.

    A draft gives the same 404 as a missing room type, so visitors can't
    tell that unpublished rooms exist.
    """
    rows = db.execute(
        "SELECT room_types.*, dorms.name AS dorm_name "
        "FROM room_types JOIN dorms ON dorms.id = room_types.dorm_id "
        f"WHERE room_types.id = ? AND {VISIBLE_TYPE}",
        type_id, int(viewer_is_admin()),
    )
    if not rows:
        return apology("We couldn't find that room type.", 404)
    return render_template("room_type.html", room_type=with_facts(rows[0]))


# ---------------------------------------------------------------------------
# Student pages: my room, my layouts
# ---------------------------------------------------------------------------

@pages.route("/my-room")
@login_required
def my_room():
    """Send a student to the planner for the room an admin assigned them.

    With no assignment, or while the room's type is still a draft (and the
    viewer isn't an admin), show a page explaining that instead.
    """
    rows = db.execute(
        "SELECT rooms.number, rooms.room_type_id, room_types.status, dorms.name AS dorm_name "
        "FROM assignments "
        "JOIN rooms ON rooms.id = assignments.room_id "
        "JOIN room_types ON room_types.id = rooms.room_type_id "
        "JOIN dorms ON dorms.id = rooms.dorm_id "
        "WHERE assignments.user_id = ?",
        session["user_id"],
    )
    if not rows:
        return render_template("my_room.html", room=None)
    room = rows[0]
    if room["status"] == "published" or viewer_is_admin():
        # /plan/<id> is served once the planner route exists (Claire, P1).
        return redirect(f"/plan/{room['room_type_id']}")
    return render_template("my_room.html", room=room)


@pages.route("/layouts")
@login_required
def my_layouts():
    """List the student's saved layouts across all rooms, newest first.

    Rename and delete happen in the browser (static/js/layouts.js) through the
    layouts API, so this route only reads. Layouts whose room type has gone
    back to draft are hidden, as in the API (see docs/decisions.md, S5).
    """
    layouts = db.execute(
        "SELECT layouts.id, layouts.name, layouts.updated, layouts.room_type_id, "
        "room_types.name AS type_name, dorms.name AS dorm_name, "
        "COUNT(placements.id) AS item_count "
        "FROM layouts "
        "JOIN room_types ON room_types.id = layouts.room_type_id "
        "JOIN dorms ON dorms.id = room_types.dorm_id "
        "LEFT JOIN placements ON placements.layout_id = layouts.id "
        f"WHERE layouts.user_id = ? AND {VISIBLE_TYPE} "
        "GROUP BY layouts.id ORDER BY layouts.updated DESC, layouts.id DESC",
        session["user_id"], int(viewer_is_admin()),
    )
    return render_template("my_layouts.html", layouts=layouts)


# ---------------------------------------------------------------------------
# Accounts: register, log in, log out
# ---------------------------------------------------------------------------

@pages.route("/register", methods=["GET", "POST"])
def register():
    """Show the sign-up form, or create a student account and log it in.

    On bad input the form is shown again with the reason and the email still
    filled in (status 400), rather than a separate error page.
    """
    if request.method == "GET":
        return render_template("register.html")

    email = normalize_email(request.form.get("email"))
    error = check_new_account(
        email, request.form.get("password"), request.form.get("confirmation")
    )
    if error:
        return render_template("register.html", error=error, email=email), 400

    # The UNIQUE constraint on users.email is the real duplicate check: cs50.SQL
    # raises ValueError if the email is taken. Checking with a SELECT first
    # could miss two sign-ups arriving at the same moment.
    try:
        user_id = db.execute(
            "INSERT INTO users (email, hash) VALUES (?, ?)",
            email, generate_password_hash(request.form.get("password")),
        )
    except ValueError:
        error = "An account with that email already exists. Try logging in."
        return render_template("register.html", error=error, email=email), 400

    session.clear()
    session["user_id"] = user_id
    flash("Welcome to Crimson3D! You're registered and logged in.")
    return redirect("/")


@pages.route("/login", methods=["GET", "POST"])
def login():
    """Show the login form, or log a user in."""
    if request.method == "GET":
        return render_template("login.html")

    # Forget any previous user before checking the new one (as in CS50 Finance).
    session.clear()

    email = normalize_email(request.form.get("email"))
    password = request.form.get("password") or ""
    rows = db.execute("SELECT id, hash FROM users WHERE email = ?", email)

    # Same message whether the email or the password is wrong, so the form
    # doesn't reveal which emails have accounts.
    if len(rows) != 1 or not check_password_hash(rows[0]["hash"], password):
        error = "Wrong email or password."
        return render_template("login.html", error=error, email=email), 403

    session["user_id"] = rows[0]["id"]
    return redirect("/")


@pages.route("/logout")
def logout():
    """Log the user out and go back to the home page."""
    session.clear()
    return redirect("/")
