"""Shared helpers for every blueprint.

M0 only needs the database handle. Milestone S1 adds login_required,
admin_required, apology and current_user here.
"""

import os

from cs50 import SQL

# Tests point CRIMSON3D_DB at a temporary file so they never touch the real
# database (SPEC.md section 6).
DATABASE_URL = os.environ.get("CRIMSON3D_DB", "sqlite:///crimson3d.db")

if not os.path.isfile(DATABASE_URL.removeprefix("sqlite:///")):
    raise RuntimeError(f"No database at {DATABASE_URL}. Run `python init_db.py` first.")

# cs50.SQL already runs "PRAGMA foreign_keys = ON" on every new connection
# (checked in cs50 9.5.0, cs50/sql.py), so we don't repeat it here. S1 adds a
# test that proves a bad foreign key is rejected.
db = SQL(DATABASE_URL)
