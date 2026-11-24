"""Blueprint "api": JSON for the planner and layouts (Grace). Routes: SPEC.md 7.2.

Registered at /api in app.py, so a route written here as "/furniture" is
served at /api/furniture. The planner's JavaScript calls these with fetch()
and gets JSON back instead of an HTML page.
"""

import json

from flask import Blueprint, jsonify, request, session

from geometry import validate_placements
from helpers import VISIBLE_TYPE, api_login_required, db, json_error, viewer_is_admin

api = Blueprint("api", __name__)

# Limits from SPEC.md 7.2.
MAX_LAYOUTS_PER_TYPE = 20
MAX_LAYOUT_NAME = 60

# Columns of the furniture catalog, in the order SPEC.md 7.2 lists them.
FURNITURE_FIELDS = "id, slug, name, category, width, depth, height, clearance, color, note"


def whole_if_possible(number):
    """Return 94.0 as 94 and leave 94.5 alone.

    Placement x and y are stored as REAL (they may be fractional while
    dragging) but are whole inches once saved, so the JSON reads 94, not 94.0.
    """
    return int(number) if float(number).is_integer() else number


def placement_to_json(row):
    """Turn one `placements` row into the placement format of SPEC.md 4.4.

    A catalog item takes its size from the catalog, so it only needs
    furniture_id. A custom "will it fit" item (furniture_id NULL) carries its
    own label and size.
    """
    placement = {
        "furniture_id": row["furniture_id"],
        "x": whole_if_possible(row["x"]),
        "y": whole_if_possible(row["y"]),
        "rotation": row["rotation"],
    }
    if row["furniture_id"] is None:
        for field in ("label", "width", "depth", "height"):
            placement[field] = row[field]
    return placement


def layout_placements(layout_id):
    """Return a layout's placements as a list in the SPEC.md 4.4 format."""
    rows = db.execute(
        "SELECT furniture_id, label, width, depth, height, x, y, rotation "
        "FROM placements WHERE layout_id = ? ORDER BY id",
        layout_id,
    )
    return [placement_to_json(row) for row in rows]


@api.route("/types/<int:type_id>")
def get_type(type_id):
    """Return a room type with its geometry and default layout.

    Drafts are visible to admins only; anyone else gets the same 404 as for a
    missing room type.
    """
    rows = db.execute(
        "SELECT room_types.id, room_types.name, room_types.capacity, room_types.geometry, "
        "dorms.id AS dorm_id, dorms.name AS dorm_name "
        "FROM room_types JOIN dorms ON dorms.id = room_types.dorm_id "
        f"WHERE room_types.id = ? AND {VISIBLE_TYPE}",
        type_id, int(viewer_is_admin()),
    )
    if not rows:
        return json_error("We couldn't find that room type.", 404)
    room_type = rows[0]

    # The default layout is the one with no owner (SPEC.md 5). A room type
    # may not have one yet, in which case the planner starts empty.
    defaults = db.execute(
        "SELECT id FROM layouts WHERE room_type_id = ? AND user_id IS NULL AND is_default = 1",
        type_id,
    )
    placements = layout_placements(defaults[0]["id"]) if defaults else []

    return jsonify({
        "id": room_type["id"],
        "name": room_type["name"],
        "dorm": {"id": room_type["dorm_id"], "name": room_type["dorm_name"]},
        "capacity": room_type["capacity"],
        # Stored as JSON text; parse it so the client gets an object, not a string.
        "geometry": json.loads(room_type["geometry"]),
        "default_layout": {"placements": placements},
    })


@api.route("/furniture")
def get_furniture():
    """Return the whole furniture catalog: Harvard items first, then things to buy."""
    return jsonify(db.execute(
        f"SELECT {FURNITURE_FIELDS} FROM furniture "
        "ORDER BY category = 'purchase', id"
    ))


# ---------------------------------------------------------------------------
# Layouts (S5). Every route needs a logged-in user, and every route that takes
# a layout id checks that the layout belongs to them (SPEC.md 12).
# ---------------------------------------------------------------------------

def read_json_body():
    """Return the request body as a dict, or None unless it is a JSON object.

    request.is_json checks the Content-Type header is application/json.
    silent=True makes get_json() return None for broken JSON instead of
    raising an error.
    """
    if not request.is_json:
        return None
    body = request.get_json(silent=True)
    return body if isinstance(body, dict) else None


def visible_room_geometry(type_id):
    """Return the geometry dict of a room type the viewer may see, or None."""
    rows = db.execute(
        f"SELECT geometry FROM room_types WHERE id = ? AND {VISIBLE_TYPE}",
        type_id, int(viewer_is_admin()),
    )
    return json.loads(rows[0]["geometry"]) if rows else None


def clean_layout_name(name):
    """Return (trimmed name, None) if the name is fine, else (None, error message)."""
    if not isinstance(name, str) or not 1 <= len(name.strip()) <= MAX_LAYOUT_NAME:
        return None, f"Give the layout a name of 1 to {MAX_LAYOUT_NAME} characters."
    return name.strip(), None


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


def owned_layout(layout_id):
    """Look up a layout the logged-in user owns.

    Returns (layout row, None) if found, or (None, JSON error response):
    404 if there is no such layout, or its room type isn't visible to the
    viewer; 403 if it belongs to someone else. A room type's default layout
    has no owner, so it is 403 here too; admins save it through /admin/api.
    """
    rows = db.execute(
        "SELECT layouts.id, layouts.user_id, layouts.room_type_id, layouts.name, "
        "layouts.share_token, room_types.geometry "
        "FROM layouts JOIN room_types ON room_types.id = layouts.room_type_id "
        f"WHERE layouts.id = ? AND {VISIBLE_TYPE}",
        layout_id, int(viewer_is_admin()),
    )
    if not rows:
        return None, json_error("We couldn't find that layout.", 404)
    if rows[0]["user_id"] != session["user_id"]:
        return None, json_error("That layout belongs to someone else.", 403)
    return rows[0], None


def share_url(token):
    """Return the full share link for a token, or None if the layout isn't shared.

    S7 adds the /share/<token> page and switches this to url_for().
    """
    return f"{request.host_url}share/{token}" if token else None


@api.route("/layouts")
@api_login_required
def list_layouts():
    """List the logged-in student's layouts for one room type, newest first."""
    # type=int makes Flask return None if type_id is missing or not a number.
    type_id = request.args.get("type_id", type=int)
    if type_id is None:
        return json_error("Add ?type_id= with a room type id.", 400)
    if visible_room_geometry(type_id) is None:
        return json_error("We couldn't find that room type.", 404)
    return jsonify(db.execute(
        "SELECT id, name, updated FROM layouts WHERE user_id = ? AND room_type_id = ? "
        "ORDER BY updated DESC, id DESC",
        session["user_id"], type_id,
    ))


@api.route("/layouts", methods=["POST"])
@api_login_required
def create_layout():
    """Save a new layout: {type_id, name, placements} -> 201 {id}."""
    body = read_json_body()
    if body is None:
        return json_error("Send the layout as a JSON object.", 400)

    type_id = body.get("type_id")
    if not isinstance(type_id, int) or isinstance(type_id, bool):
        return json_error("type_id must be a room type id.", 400)
    geometry = visible_room_geometry(type_id)
    if geometry is None:
        return json_error("We couldn't find that room type.", 404)

    name, error = clean_layout_name(body.get("name"))
    placements = body.get("placements")
    error = error or placements_error(placements, geometry)
    if error:
        return json_error(error, 400)

    count = db.execute(
        "SELECT COUNT(*) AS n FROM layouts WHERE user_id = ? AND room_type_id = ?",
        session["user_id"], type_id,
    )[0]["n"]
    if count >= MAX_LAYOUTS_PER_TYPE:
        return json_error(
            f"You can save at most {MAX_LAYOUTS_PER_TYPE} layouts for one room. "
            "Delete one you don't need first.", 400,
        )

    def save():
        layout_id = db.execute(
            "INSERT INTO layouts (user_id, room_type_id, name) VALUES (?, ?, ?)",
            session["user_id"], type_id, name,
        )
        insert_placements(layout_id, placements)
        return layout_id

    return jsonify({"id": run_in_transaction(save)}), 201


@api.route("/layouts/<int:layout_id>")
@api_login_required
def get_layout(layout_id):
    """Return one of the student's layouts with its placements."""
    layout, error = owned_layout(layout_id)
    if error:
        return error
    return jsonify({
        "id": layout["id"],
        "name": layout["name"],
        "type_id": layout["room_type_id"],
        "placements": layout_placements(layout_id),
        "share_url": share_url(layout["share_token"]),
    })


@api.route("/layouts/<int:layout_id>", methods=["PUT"])
@api_login_required
def update_layout(layout_id):
    """Rename a layout, replace its placements, or both: {name?, placements?}."""
    layout, error = owned_layout(layout_id)
    if error:
        return error
    body = read_json_body()
    if body is None:
        return json_error("Send the changes as a JSON object.", 400)
    if "name" not in body and "placements" not in body:
        return json_error("Send a new name, new placements, or both.", 400)

    name = layout["name"]
    if "name" in body:
        name, error = clean_layout_name(body["name"])
        if error:
            return json_error(error, 400)
    if "placements" in body:
        error = placements_error(body["placements"], json.loads(layout["geometry"]))
        if error:
            return json_error(error, 400)

    def save():
        db.execute(
            "UPDATE layouts SET name = ?, updated = CURRENT_TIMESTAMP WHERE id = ?",
            name, layout_id,
        )
        if "placements" in body:
            # Saving replaces all placements: delete the old rows, insert the new (SPEC.md 5).
            db.execute("DELETE FROM placements WHERE layout_id = ?", layout_id)
            insert_placements(layout_id, body["placements"])

    run_in_transaction(save)
    updated = db.execute("SELECT updated FROM layouts WHERE id = ?", layout_id)[0]["updated"]
    return jsonify({"ok": True, "updated": updated})


@api.route("/layouts/<int:layout_id>", methods=["DELETE"])
@api_login_required
def delete_layout(layout_id):
    """Delete one of the student's layouts. Its placements go too (ON DELETE CASCADE)."""
    layout, error = owned_layout(layout_id)
    if error:
        return error
    db.execute("DELETE FROM layouts WHERE id = ?", layout_id)
    return jsonify({"ok": True})
