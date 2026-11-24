"""Blueprint "api": JSON for the planner and layouts (Grace). Routes: SPEC.md 7.2.

Registered at /api in app.py, so a route written here as "/furniture" is
served at /api/furniture. The planner's JavaScript calls these with fetch()
and gets JSON back instead of an HTML page.
"""

import json

from flask import Blueprint, jsonify

from helpers import VISIBLE_TYPE, db, json_error, viewer_is_admin

api = Blueprint("api", __name__)

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
