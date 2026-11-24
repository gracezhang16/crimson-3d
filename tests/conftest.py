"""Shared pytest setup: point the app at a throwaway database.

helpers.py reads CRIMSON3D_DB when it is first imported, so we set it here,
before any test imports app.py. For M0 the database is built once per test
run; S-track tests that write data should rebuild it per test (SPEC.md 11).
"""

import os
import tempfile
from pathlib import Path

import pytest

TEST_DB_URL = "sqlite:///" + str(Path(tempfile.mkdtemp()) / "test.db")
os.environ["CRIMSON3D_DB"] = TEST_DB_URL

from init_db import build_database  # noqa: E402  (must come after setting the env var)

build_database(TEST_DB_URL)


@pytest.fixture
def client():
    """A Flask test client: makes requests to the app without running a server."""
    from app import app
    app.config["TESTING"] = True
    with app.test_client() as test_client:
        yield test_client
