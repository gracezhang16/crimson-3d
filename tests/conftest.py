"""Shared pytest setup: give every test a fresh throwaway database.

helpers.py reads CRIMSON3D_DB when it is first imported, so we set it here,
before any test imports app.py.

How the per-test reset works:
  1. Once per run, build a clean database (schema + seed/) in `clean.db`.
  2. Before every test, copy clean.db over `test.db` with SQLite's backup API.

Why not just call build_database() before every test? helpers.db (a cs50.SQL
object) keeps its connection to test.db open between queries. Deleting the
file underneath it would leave that connection reading the old, deleted file.
The backup API writes through SQLite's own locking instead, so every open
connection sees the fresh copy. It is also much faster than rebuilding.
"""

import os
import sqlite3
import tempfile
from pathlib import Path

import pytest

TEST_DIR = Path(tempfile.mkdtemp())
CLEAN_DB = TEST_DIR / "clean.db"
TEST_DB = TEST_DIR / "test.db"
os.environ["CRIMSON3D_DB"] = "sqlite:///" + str(TEST_DB)

from init_db import build_database  # noqa: E402  (must come after setting the env var)

build_database("sqlite:///" + str(CLEAN_DB))
build_database("sqlite:///" + str(TEST_DB))  # helpers.py refuses to start without a file


@pytest.fixture(autouse=True)
def fresh_database():
    """Reset test.db to the clean seed data before each test.

    autouse=True means pytest runs this for every test without being asked.
    """
    with sqlite3.connect(CLEAN_DB) as source, sqlite3.connect(TEST_DB) as target:
        source.backup(target)
    source.close()
    target.close()


@pytest.fixture
def client():
    """A Flask test client: makes requests to the app without running a server."""
    from app import app
    app.config["TESTING"] = True
    with app.test_client() as test_client:
        yield test_client
