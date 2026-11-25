"""Blueprint "api": JSON for the planner and layouts (Grace). Routes: SPEC.md 7.2.

Registered at /api in app.py, so a route written here as "/furniture" is
served at /api/furniture. The planner's JavaScript calls these with fetch()
and gets JSON back instead of an HTML page.
"""

import json
import secrets

from flask import Blueprint, jsonify, request, session, url_for

from helpers import (VISIBLE_TYPE, api_login_required, db, insert_placements, json_error,
                     placements_error, run_in_transaction, viewer_is_admin)

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
    """Return a suite type with its geometry and default layout.

    Drafts are visible to admins only; anyone else gets the same 404 as for a
    missing suite type.
    """
    rows = db.execute(
        "SELECT suite_types.id, suite_types.name, suite_types.capacity, suite_types.geometry, "
        "dorms.id AS dorm_id, dorms.name AS dorm_name "
        "FROM suite_types JOIN dorms ON dorms.id = suite_types.dorm_id "
        f"WHERE suite_types.id = ? AND {VISIBLE_TYPE}",
        type_id, int(viewer_is_admin()),
    )
    if not rows:
        return json_error("We couldn't find that suite type.", 404)
    suite_type = rows[0]

    # The default layout is the one with no owner (SPEC.md 5). A suite type
    # may not have one yet, in which case the planner starts empty.
    defaults = db.execute(
        "SELECT id FROM layouts WHERE suite_type_id = ? AND user_id IS NULL AND is_default = 1",
        type_id,
    )
    placements = layout_placements(defaults[0]["id"]) if defaults else []

    return jsonify({
        "id": suite_type["id"],
        "name": suite_type["name"],
        "dorm": {"id": suite_type["dorm_id"], "name": suite_type["dorm_name"]},
        "capacity": suite_type["capacity"],
        # Stored as JSON text; parse it so the client gets an object, not a string.
        "geometry": json.loads(suite_type["geometry"]),
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
    """Return the geometry dict of a suite type the viewer may see, or None."""
    rows = db.execute(
        f"SELECT geometry FROM suite_types WHERE id = ? AND {VISIBLE_TYPE}",
        type_id, int(viewer_is_admin()),
    )
    return json.loads(rows[0]["geometry"]) if rows else None


def clean_layout_name(name):
    """Return (trimmed name, None) if the name is fine, else (None, error message)."""
    if not isinstance(name, str) or not 1 <= len(name.strip()) <= MAX_LAYOUT_NAME:
        return None, f"Give the layout a name of 1 to {MAX_LAYOUT_NAME} characters."
    return name.strip(), None


def owned_layout(layout_id):
    """Look up a layout the logged-in user owns.

    Returns (layout row, None) if found, or (None, JSON error response):
    404 if there is no such layout, or its suite type isn't visible to the
    viewer; 403 if it belongs to someone else. A suite type's default layout
    has no owner, so it is 403 here too; admins save it through /admin/api.
    """
    rows = db.execute(
        "SELECT layouts.id, layouts.user_id, layouts.suite_type_id, layouts.name, "
        "layouts.share_token, suite_types.geometry "
        "FROM layouts JOIN suite_types ON suite_types.id = layouts.suite_type_id "
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

    _external=True makes url_for() include the scheme and host
    ("http://127.0.0.1:5000/share/..."), so the link works when pasted anywhere.
    """
    return url_for("pages.share", token=token, _external=True) if token else None


@api.route("/layouts")
@api_login_required
def list_layouts():
    """List the logged-in student's layouts for one suite type, newest first."""
    # type=int makes Flask return None if type_id is missing or not a number.
    type_id = request.args.get("type_id", type=int)
    if type_id is None:
        return json_error("Add ?type_id= with a suite type id.", 400)
    if visible_room_geometry(type_id) is None:
        return json_error("We couldn't find that suite type.", 404)
    return jsonify(db.execute(
        "SELECT id, name, updated FROM layouts WHERE user_id = ? AND suite_type_id = ? "
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
        return json_error("type_id must be a suite type id.", 400)
    geometry = visible_room_geometry(type_id)
    if geometry is None:
        return json_error("We couldn't find that suite type.", 404)

    name, error = clean_layout_name(body.get("name"))
    placements = body.get("placements")
    error = error or placements_error(placements, geometry)
    if error:
        return json_error(error, 400)

    count = db.execute(
        "SELECT COUNT(*) AS n FROM layouts WHERE user_id = ? AND suite_type_id = ?",
        session["user_id"], type_id,
    )[0]["n"]
    if count >= MAX_LAYOUTS_PER_TYPE:
        return json_error(
            f"You can save at most {MAX_LAYOUTS_PER_TYPE} layouts for one room. "
            "Delete one you don't need first.", 400,
        )

    def save():
        layout_id = db.execute(
            "INSERT INTO layouts (user_id, suite_type_id, name) VALUES (?, ?, ?)",
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
        "type_id": layout["suite_type_id"],
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


# ---------------------------------------------------------------------------
# Sharing (S7): a read-only link anyone can open, until the owner stops it
# ---------------------------------------------------------------------------

@api.route("/layouts/<int:layout_id>/share", methods=["POST"])
@api_login_required
def share_layout(layout_id):
    """Turn sharing on: create the layout's share token if it has none.

    The token comes from secrets.token_urlsafe(16): 16 random bytes, about
    22 characters, far too many to guess (SPEC.md 12). Sharing again returns
    the same link. There is no request body, so no JSON is required.
    """
    layout, error = owned_layout(layout_id)
    if error:
        return error
    token = layout["share_token"]
    if not token:
        token = secrets.token_urlsafe(16)
        db.execute("UPDATE layouts SET share_token = ? WHERE id = ?", token, layout_id)
    return jsonify({"share_url": share_url(token)})


@api.route("/layouts/<int:layout_id>/share", methods=["DELETE"])
@api_login_required
def stop_sharing(layout_id):
    """Turn sharing off: forget the token, so the old link stops working."""
    layout, error = owned_layout(layout_id)
    if error:
        return error
    db.execute("UPDATE layouts SET share_token = NULL WHERE id = ?", layout_id)
    return jsonify({"ok": True})


@api.route("/share/<token>")
def get_shared_layout(token):
    """A shared layout, for anyone with the link: {name, type_id, geometry, placements}.

    A link to a suite type that has gone back to draft gives the same 404 as
    an unknown or withdrawn link.
    """
    rows = db.execute(
        "SELECT layouts.id, layouts.name, layouts.suite_type_id, suite_types.geometry "
        "FROM layouts JOIN suite_types ON suite_types.id = layouts.suite_type_id "
        "WHERE layouts.share_token = ? AND suite_types.status = 'published'",
        token,
    )
    if not rows:
        return json_error("This share link doesn't work any more.", 404)
    layout = rows[0]
    return jsonify({
        "name": layout["name"],
        "type_id": layout["suite_type_id"],
        "geometry": json.loads(layout["geometry"]),
        "placements": layout_placements(layout["id"]),
    })
