"""Tests for the admin blueprint (Hannah): A1 admin home and room types list.

The guard tests don't list admin URLs by hand. They read Flask's route table
(app.url_map) and try every /admin route with every method it accepts, so a
route added later without @admin_required fails these tests straight away.
"""

import re

import pytest

from app import app
from helpers import db


def admin_routes():
    """Yield (method, url) for every /admin route, with 1 for each <id> part."""
    for rule in app.url_map.iter_rules():
        if rule.rule.startswith("/admin"):
            url = re.sub(r"<[^>]+>", "1", rule.rule)   # /admin/types/<int:type_id> -> /admin/types/1
            for method in sorted(rule.methods - {"HEAD", "OPTIONS"}):
                yield method, url


ADMIN_ROUTES = list(admin_routes())


def log_in(client, role):
    """Create a user with this role and log the client in as them."""
    user_id = db.execute(
        "INSERT INTO users (email, hash, role) VALUES (?, 'x', ?)", f"{role}@example.com", role
    )
    with client.session_transaction() as session:
        session["user_id"] = user_id


def test_admin_routes_were_found():
    # Guards against the tests below passing because they found nothing to test.
    assert ("GET", "/admin") in ADMIN_ROUTES
    assert ("GET", "/admin/types") in ADMIN_ROUTES


@pytest.mark.parametrize("method, url", ADMIN_ROUTES)
def test_visitor_gets_403_on_every_admin_route(client, method, url):
    assert client.open(url, method=method).status_code == 403


@pytest.mark.parametrize("method, url", ADMIN_ROUTES)
def test_student_gets_403_on_every_admin_route(client, method, url):
    log_in(client, "student")
    response = client.open(url, method=method)
    assert response.status_code == 403
    assert "Only admins" in response.get_data(as_text=True)


def test_admin_home_shows_counts(client):
    log_in(client, "admin")
    response = client.get("/admin")
    assert response.status_code == 200
    page = response.get_data(as_text=True)
    assert "Published room types" in page
    assert '<div class="fs-3 fw-semibold">2</div>' in page   # the two Demo Hall rooms
    assert 'href="/admin/types"' in page


def test_room_types_list_includes_drafts(client):
    db.execute("UPDATE room_types SET status = 'draft' WHERE name = 'Single (sample)'")
    log_in(client, "admin")
    response = client.get("/admin/types")
    assert response.status_code == 200
    page = response.get_data(as_text=True)
    assert "Single (sample)" in page and "Double (sample)" in page
    assert ">Draft<" in page and ">Published<" in page


def test_navbar_admin_link_only_for_admins(client):
    log_in(client, "student")
    assert 'href="/admin"' not in client.get("/").get_data(as_text=True)


def test_navbar_admin_link_for_admin(client):
    log_in(client, "admin")
    assert 'href="/admin"' in client.get("/").get_data(as_text=True)
