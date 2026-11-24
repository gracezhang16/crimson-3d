"""Blueprint "api": JSON for the planner and layouts (Grace). Routes: SPEC.md 7.2.

Registered at /api in app.py, so a route written here as "/furniture" is
served at /api/furniture. Routes arrive in milestones S4, S5 and S7.
"""

from flask import Blueprint

api = Blueprint("api", __name__)
