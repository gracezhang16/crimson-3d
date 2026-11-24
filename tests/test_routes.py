"""Route tests (Grace). M0 has one smoke test; S1 to S8 add auth, ownership,
admin guard, draft visibility and the layout save round trip (SPEC.md 11)."""


def test_home_page_lists_demo_hall(client):
    response = client.get("/")
    assert response.status_code == 200
    page = response.get_data(as_text=True)
    assert "Demo Hall" in page
    assert "2 room types" in page
    assert "not affiliated with Harvard University" in page
