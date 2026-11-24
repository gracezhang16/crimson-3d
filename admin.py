"""Blueprint "admin": admin pages and admin JSON (Hannah). Routes: SPEC.md 7.3.

Registered at /admin in app.py, so "/types" here is served at /admin/types.
Every route must use @admin_required (helpers.py): anyone who isn't a
logged-in admin gets a 403 page. tests/test_admin.py checks this for every
/admin route automatically, including ones added later.
"""

from flask import Blueprint, render_template

from helpers import admin_required, db

admin = Blueprint("admin", __name__)


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
