"""Blueprint "admin": admin pages and admin JSON (Hannah). Routes: SPEC.md 7.3.

Registered at /admin in app.py. Every route must use @admin_required (from
helpers.py, added in S1). Routes arrive from milestone A1.
"""

from flask import Blueprint

admin = Blueprint("admin", __name__)
