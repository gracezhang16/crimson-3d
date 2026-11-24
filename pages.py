"""Blueprint "pages": public and student HTML pages (Grace). Routes: SPEC.md 7.1."""

from flask import Blueprint, render_template

from helpers import db

pages = Blueprint("pages", __name__)


@pages.route("/")
def index():
    """List every dorm that has at least one published room type.

    S3 adds the search box and links to each dorm's page.
    """
    dorms = db.execute(
        "SELECT dorms.id, dorms.name, dorms.yard, COUNT(room_types.id) AS type_count "
        "FROM dorms JOIN room_types ON room_types.dorm_id = dorms.id "
        "WHERE room_types.status = 'published' "
        "GROUP BY dorms.id ORDER BY dorms.name"
    )
    return render_template("index.html", dorms=dorms)
