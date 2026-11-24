"""Create the Crimson3D Flask app: configuration plus the three blueprints.

A blueprint is a bundle of routes in its own file. Flask merges them into one
app here. We use three so each teammate edits a different file:
    pages.py  public and student HTML pages   (Grace)
    api.py    JSON for the planner, at /api    (Grace)
    admin.py  admin pages and JSON, at /admin  (Hannah)
"""

import os

from flask import Flask, request
from flask_session import Session

from admin import admin
from api import api
from helpers import current_user, json_error
from pages import pages

app = Flask(__name__)

# Sessions are stored on disk (in flask_session/), as in CS50 Finance.
# SECRET_KEY signs the session cookie; set a real one in the environment for
# anything public. The fallback is only for development.
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "dev-only-not-secret")
app.config["SESSION_PERMANENT"] = False
app.config["SESSION_TYPE"] = "filesystem"
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
Session(app)

app.register_blueprint(pages)
app.register_blueprint(api, url_prefix="/api")
app.register_blueprint(admin, url_prefix="/admin")


@app.context_processor
def inject_user():
    """Make `user` (the logged-in user's row, or None) available in every template.

    A context processor runs before each template is rendered; the dict it
    returns is added to the template's variables. layout.html uses `user` to
    show Log in / Register or the user's email and Log out.
    """
    return {"user": current_user()}


# Error handlers run when Flask can't serve a request normally. Requests that
# match no route never reach a blueprint, so these must live on the app. Under
# /api we answer in JSON, because the planner's fetch() calls expect JSON
# (SPEC.md 7.2); everywhere else we return Flask's usual error page unchanged.

@app.errorhandler(404)
def not_found(error):
    """Answer an unknown /api address with JSON; leave other 404s as they are."""
    if request.path.startswith("/api/"):
        return json_error("There is no such API address.", 404)
    return error


@app.errorhandler(405)
def method_not_allowed(error):
    """Answer a wrong HTTP method under /api with JSON (e.g. DELETE /api/furniture)."""
    if request.path.startswith("/api/"):
        return json_error(f"{request.method} is not allowed here.", 405)
    return error
