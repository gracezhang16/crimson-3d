"""Create the Crimson3D Flask app: configuration plus the three blueprints.

A blueprint is a bundle of routes in its own file. Flask merges them into one
app here. We use three so each teammate edits a different file:
    pages.py  public and student HTML pages   (Grace)
    api.py    JSON for the planner, at /api    (Grace)
    admin.py  admin pages and JSON, at /admin  (Hannah)
"""

import os

from flask import Flask
from flask_session import Session

from admin import admin
from api import api
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
