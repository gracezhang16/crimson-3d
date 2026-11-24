"""Tests for geometry.py. The wall-helper tests mirror tests/geometry.test.mjs.

Validation tests: valid rooms pass, and each rule in SPEC.md 4.2 has at
least one failing case. The same for placements (SPEC.md 4.4 and 7.2).
"""

import copy
import json
from pathlib import Path

import pytest

from geometry import (
    feature_span,
    inward_normal,
    point_along_wall,
    signed_area,
    validate_placements,
    validate_room,
    validate_suite,
    wall_length,
    wall_letter,
    walls,
)

# A 114 x 150 rectangle, drawn clockwise from the top-left corner.
RECT = [[0, 0], [114, 0], [114, 150], [0, 150]]

# An L-shape: a 120-wide top bar and a 60-wide leg going down on the left.
L_SHAPE = [[0, 0], [120, 0], [120, 60], [60, 60], [60, 150], [0, 150]]

SEED_SUITES = sorted((Path(__file__).parent.parent / "seed" / "suites").glob("*.json"))


def make_room(**changes):
    """Return a valid one-room suite (the SPEC.md 4.2 example) with some fields
    replaced. outline, features, name and kind go to the room; anything else
    (version, units, ceiling, rooms) to the suite."""
    room = {
        "name": "Room",
        "kind": "bedroom",
        "outline": copy.deepcopy(RECT),
        "features": [
            {"kind": "door", "wall": 3, "offset": 8, "width": 34, "height": 80},
            {"kind": "window", "wall": 0, "offset": 36, "width": 42, "height": 54, "sill": 30},
            {"kind": "closet", "wall": 1, "offset": 0, "width": 60, "height": 84},
            {"kind": "radiator", "wall": 0, "offset": 42, "width": 30, "height": 24, "depth": 6},
            {"kind": "outlet", "wall": 2, "offset": 20},
        ],
    }
    suite = {"version": 2, "units": "in", "ceiling": 102, "rooms": [room]}
    for key, value in changes.items():
        (room if key in ("outline", "features", "name", "kind") else suite)[key] = value
    return suite


def room_with_feature(feature):
    """Return a valid room whose only feature is `feature`."""
    return make_room(features=[feature])


# ---------------------------------------------------------------------------
# Wall helpers
# ---------------------------------------------------------------------------

def test_walls_close_the_shape():
    result = walls(RECT)
    assert len(result) == 4
    assert result[0] == ((0, 0), (114, 0))
    assert result[3] == ((0, 150), (0, 0))


def test_wall_lengths():
    assert [wall_length(RECT, i) for i in range(4)] == [114, 150, 114, 150]
    assert wall_length([[0, 0], [30, 0], [0, 40]], 1) == 50  # 3-4-5 triangle


def test_wall_letters():
    assert wall_letter(0) == "A"
    assert wall_letter(3) == "D"


def test_signed_area_is_positive_for_clockwise():
    assert signed_area(RECT) == 114 * 150
    assert signed_area(L_SHAPE) == 120 * 60 + 60 * 90
    assert signed_area(list(reversed(RECT))) == -114 * 150


def test_inward_normals_of_rectangle():
    assert inward_normal(RECT, 0) == (0, 1)    # top wall -> down
    assert inward_normal(RECT, 1) == (-1, 0)   # right wall -> left
    assert inward_normal(RECT, 2) == (0, -1)   # bottom wall -> up
    assert inward_normal(RECT, 3) == (1, 0)    # left wall -> right


def test_inward_normals_at_inner_corner_of_l_shape():
    assert inward_normal(L_SHAPE, 2) == (0, -1)  # inner horizontal wall faces up
    assert inward_normal(L_SHAPE, 3) == (-1, 0)  # inner vertical wall faces left


def test_inward_normals_do_not_depend_on_drawing_order():
    # Original wall i (corner i to i+1) is reversed wall (n - 2 - i) mod n.
    n = len(RECT)
    reversed_rect = list(reversed(RECT))
    for i in range(n):
        assert inward_normal(reversed_rect, (2 * n - 2 - i) % n) == inward_normal(RECT, i)


@pytest.mark.parametrize("outline", [RECT, L_SHAPE], ids=["rectangle", "l-shape"])
def test_start_corner_is_on_the_left_from_inside(outline):
    for i, (start, end) in enumerate(walls(outline)):
        nx, ny = inward_normal(outline, i)
        facing = (-nx, -ny)                 # looking at the wall from inside
        left = (facing[1], -facing[0])      # with y down, left of (fx, fy) is (fy, -fx)
        middle = ((start[0] + end[0]) / 2, (start[1] + end[1]) / 2)
        to_start = (start[0] - middle[0], start[1] - middle[1])
        assert to_start[0] * left[0] + to_start[1] * left[1] > 0, f"wall {wall_letter(i)}"


def test_point_along_wall():
    assert point_along_wall(RECT, 0, 36) == (36, 0)
    assert point_along_wall(RECT, 3, 8) == (0, 142)  # left wall runs upward
    x, y = point_along_wall([[0, 0], [30, 0], [0, 40]], 1, 25)
    assert x == pytest.approx(15) and y == pytest.approx(20)


def test_feature_span():
    window = {"kind": "window", "wall": 0, "offset": 36, "width": 42, "height": 54, "sill": 30}
    assert feature_span(RECT, window) == ((36, 0), (78, 0))
    door = {"kind": "door", "wall": 2, "offset": 10, "width": 34, "height": 80}
    assert feature_span(RECT, door) == ((104, 150), (70, 150))
    outlet = {"kind": "outlet", "wall": 1, "offset": 20}
    assert feature_span(RECT, outlet) == ((114, 20), (114, 20))


# ---------------------------------------------------------------------------
# validate_room: valid rooms
# ---------------------------------------------------------------------------

def test_spec_example_is_valid():
    assert validate_suite(make_room()) == []


def test_l_shape_and_triangle_are_valid():
    assert validate_suite(make_room(outline=L_SHAPE, features=[])) == []
    assert validate_suite(make_room(outline=[[0, 0], [100, 0], [0, 100]], features=[])) == []


@pytest.mark.parametrize("path", SEED_SUITES, ids=lambda p: p.name)
def test_seed_suites_are_valid(path):
    assert validate_suite(json.loads(path.read_text())["geometry"]) == []


def test_feature_exactly_filling_a_wall_is_valid():
    feature = {"kind": "closet", "wall": 0, "offset": 0, "width": 114, "height": 84}
    assert validate_suite(room_with_feature(feature)) == []


def test_radiator_without_height_or_depth_is_valid():
    feature = {"kind": "radiator", "wall": 0, "offset": 0, "width": 30}
    assert validate_suite(room_with_feature(feature)) == []


# ---------------------------------------------------------------------------
# validate_room: one failing case per rule
# ---------------------------------------------------------------------------

def assert_one_error(room, fragment):
    """Assert validation fails with exactly one error containing `fragment`."""
    errors = validate_suite(room)
    assert len(errors) == 1, errors
    assert fragment in errors[0], errors


def test_suite_must_be_an_object():
    assert validate_suite([1, 2, 3]) == ["The suite must be a JSON object."]


@pytest.mark.parametrize("version", [1, "2", True, None])
def test_version_must_be_2(version):
    assert_one_error(make_room(version=version), "Version")


def test_units_must_be_inches():
    assert_one_error(make_room(units="cm"), "Units")


@pytest.mark.parametrize("ceiling", [71, 241, 100.5, "102"])
def test_ceiling_range(ceiling):
    assert_one_error(make_room(ceiling=ceiling), "Ceiling")


@pytest.mark.parametrize("outline", [
    [[0, 0], [10, 0]],                    # too few corners
    [[i, 0] for i in range(13)],          # too many corners
    "square",                             # not a list
])
def test_corner_count(outline):
    assert_one_error(make_room(outline=outline, features=[]), "3 to 12 corners")


@pytest.mark.parametrize("corner", [[1201, 0], [-1, 0], [1.5, 0], [0], "00"])
def test_corner_values(corner):
    outline = [corner, [114, 0], [114, 150], [0, 150]]
    assert_one_error(make_room(outline=outline, features=[]), "Corner 1")


def test_consecutive_corners_must_differ():
    outline = [[0, 0], [114, 0], [114, 0], [114, 150], [0, 150]]
    assert_one_error(make_room(outline=outline, features=[]), "zero length")


def test_outline_must_have_area():
    outline = [[0, 0], [50, 0], [100, 0]]
    assert_one_error(make_room(outline=outline, features=[]), "no area")


def test_edges_must_not_cross():
    # Lopsided on purpose: a symmetric bow tie has a net signed area of zero
    # and would be caught by the "no area" rule first.
    bow_tie = [[0, 0], [120, 0], [0, 60], [100, 100]]
    assert_one_error(make_room(outline=bow_tie, features=[]), "cross")


def test_edges_must_not_touch():
    # Two squares meeting at one corner, [50, 50], traced as one outline.
    figure_eight = [[0, 0], [50, 0], [50, 50], [100, 50], [100, 100], [50, 100], [50, 50], [0, 50]]
    errors = validate_suite(make_room(outline=figure_eight, features=[]))
    assert errors and "cross" in errors[0]


def test_wall_must_not_double_back():
    outline = [[0, 0], [100, 0], [100, 100], [100, 50], [0, 100]]
    assert_one_error(make_room(outline=outline, features=[]), "double back")


def test_features_must_be_a_list():
    assert_one_error(make_room(features="door"), "Features")


def test_at_most_40_features():
    outlet = {"kind": "outlet", "wall": 0, "offset": 1}
    assert validate_suite(make_room(features=[outlet] * 40)) == []
    assert_one_error(make_room(features=[outlet] * 41), "at most 40")


def test_feature_kind():
    assert_one_error(room_with_feature({"kind": "fireplace", "wall": 0, "offset": 0}), "fireplace")


@pytest.mark.parametrize("wall", [-1, 4, "A", None])
def test_feature_wall(wall):
    assert_one_error(room_with_feature({"kind": "outlet", "wall": wall, "offset": 0}), "from A to D")


@pytest.mark.parametrize("offset", [-1, 2.5, None])
def test_feature_offset(offset):
    assert_one_error(room_with_feature({"kind": "outlet", "wall": 0, "offset": offset}), "distance")


def test_outlet_past_end_of_wall():
    assert_one_error(room_with_feature({"kind": "outlet", "wall": 0, "offset": 115}), "past the end")


def test_width_required_except_outlet():
    feature = {"kind": "closet", "wall": 0, "offset": 0, "height": 84}
    assert_one_error(room_with_feature(feature), "width")


def test_feature_wider_than_wall():
    window = {"kind": "window", "wall": 0, "offset": 0, "width": 120, "height": 54, "sill": 30}
    errors = validate_suite(room_with_feature(window))
    assert errors == ["Room: Window 1 is wider than wall A (120 in on a 114 in wall)."]


def test_feature_runs_past_end_of_wall():
    door = {"kind": "door", "wall": 0, "offset": 90, "width": 34, "height": 80}
    assert_one_error(room_with_feature(door), "runs past the end of wall A")


def test_messages_number_features_per_kind():
    good = {"kind": "window", "wall": 0, "offset": 0, "width": 30, "height": 54, "sill": 30}
    bad = {"kind": "window", "wall": 1, "offset": 0, "width": 200, "height": 54, "sill": 30}
    assert_one_error(make_room(features=[good, bad]), "Window 2 is wider than wall B")


@pytest.mark.parametrize("kind", ["door", "window", "closet"])
def test_height_required(kind):
    feature = {"kind": kind, "wall": 0, "offset": 0, "width": 30, "sill": 30}
    assert_one_error(room_with_feature(feature), "height")


def test_height_at_most_ceiling():
    door = {"kind": "door", "wall": 0, "offset": 0, "width": 34, "height": 103}
    assert_one_error(room_with_feature(door), "taller than the ceiling")


def test_window_needs_sill():
    window = {"kind": "window", "wall": 0, "offset": 0, "width": 30, "height": 54}
    assert_one_error(room_with_feature(window), "sill")


def test_window_sill_plus_height_at_most_ceiling():
    window = {"kind": "window", "wall": 0, "offset": 0, "width": 30, "height": 60, "sill": 43}
    assert_one_error(room_with_feature(window), "above the ceiling")


def test_radiator_depth_must_be_positive():
    radiator = {"kind": "radiator", "wall": 0, "offset": 0, "width": 30, "depth": 0}
    assert_one_error(room_with_feature(radiator), "depth")


# ---------------------------------------------------------------------------
# validate_suite: rooms (format version 2)
# ---------------------------------------------------------------------------

BEDROOM = {"name": "Bedroom A", "kind": "bedroom", "outline": [[0, 0], [120, 0], [120, 144], [0, 144]], "features": []}


def suite_of(*rooms):
    return {"version": 2, "units": "in", "ceiling": 102, "rooms": list(rooms)}


def room_at(name, x, y, width, length, kind="common"):
    """A rectangular room whose north-west corner is at (x, y)."""
    return {"name": name, "kind": kind, "features": [],
            "outline": [[x, y], [x + width, y], [x + width, y + length], [x, y + length]]}


def test_a_suite_with_a_gap_between_rooms_is_valid():
    assert validate_suite(suite_of(BEDROOM, room_at("Common room", 125, 0, 180, 293))) == []


def test_rooms_may_share_a_wall():
    assert validate_suite(suite_of(BEDROOM, room_at("Common room", 120, 0, 180, 144))) == []


def test_rooms_may_touch_at_a_corner():
    assert validate_suite(suite_of(BEDROOM, room_at("Closet room", 120, 144, 40, 40))) == []


def test_overlapping_rooms_are_rejected():
    errors = validate_suite(suite_of(BEDROOM, room_at("Common room", 100, 20, 180, 144)))
    assert errors == ["Bedroom A and Common room overlap. Rooms may share a wall but not floor space."]


def test_a_room_inside_another_is_rejected():
    errors = validate_suite(suite_of(BEDROOM, room_at("Nook", 20, 20, 30, 30)))
    assert len(errors) == 1 and "overlap" in errors[0]


def test_a_suite_needs_1_to_8_rooms():
    assert validate_suite(suite_of()) == ["A suite needs 1 to 8 rooms."]
    many = [room_at(f"Room {i}", i * 50, 0, 40, 40) for i in range(9)]
    assert validate_suite(suite_of(*many)) == ["A suite needs 1 to 8 rooms."]
    assert validate_suite({**suite_of(BEDROOM), "rooms": "Bedroom"}) == ["A suite needs 1 to 8 rooms."]


@pytest.mark.parametrize("name", ["", "   ", "x" * 41, None])
def test_room_names(name):
    errors = validate_suite(suite_of({**BEDROOM, "name": name}))
    assert errors == ["Room 1: Give the room a name of 1 to 40 characters."]


def test_room_kind():
    assert validate_suite(suite_of({**BEDROOM, "kind": "kitchen"})) == ["Bedroom A: Room kind must be bedroom or common."]


def test_messages_name_the_room():
    window = {"kind": "window", "wall": 1, "offset": 0, "width": 300, "height": 50, "sill": 30}
    common = room_at("Common room", 125, 0, 180, 293)
    errors = validate_suite(suite_of(BEDROOM, {**common, "features": [window]}))
    assert errors == ["Common room: Window 1 is wider than wall B (300 in on a 293 in wall)."]


def test_suites_can_be_up_to_1200_inches():
    assert validate_suite(suite_of(room_at("Big", 0, 0, 1200, 1200))) == []


def test_placements_may_be_anywhere_in_the_suite():
    suite = suite_of(BEDROOM, room_at("Common room", 125, 0, 180, 293))
    bed_in_common_room = {"furniture_id": 1, "x": 250, "y": 250, "rotation": 0}
    assert validate_placements([bed_in_common_room], suite, {1}) == []
    assert "outside the room" in validate_placements([{**bed_in_common_room, "x": 400}], suite, {1})[0]


# ---------------------------------------------------------------------------
# validate_placements (SPEC.md 4.4, 7.2)
# ---------------------------------------------------------------------------

PLACEMENT_ROOM = {"version": 2, "units": "in", "ceiling": 102,
                  "rooms": [{"name": "Room", "kind": "bedroom", "outline": RECT, "features": []}]}
CATALOG_IDS = {1, 2, 3}
BED = {"furniture_id": 1, "x": 20, "y": 42, "rotation": 0}
BEAN_BAG = {"furniture_id": None, "label": "Bean bag chair", "width": 36, "depth": 36,
            "height": 28, "x": 60.5, "y": 80, "rotation": 90}


def placement_errors(*placements):
    """Validate these placements in the 114 x 150 rectangle."""
    return validate_placements(list(placements), PLACEMENT_ROOM, CATALOG_IDS)


def test_valid_placements_pass():
    assert placement_errors(BED, BEAN_BAG) == []


def test_empty_layout_passes():
    assert placement_errors() == []


def test_placements_must_be_a_list():
    assert validate_placements({"x": 1}, PLACEMENT_ROOM, CATALOG_IDS) == ["Placements must be a list."]


def test_at_most_100_placements():
    assert placement_errors(*[BED] * 100) == []
    assert "at most 100" in placement_errors(*[BED] * 101)[0]


def test_placement_must_be_an_object():
    assert placement_errors("bed") == ["Item 1 must be a JSON object."]


def test_unknown_furniture_id():
    errors = placement_errors(BED, {**BED, "furniture_id": 99})
    assert len(errors) == 1 and errors[0].startswith("Item 2 refers to furniture")


@pytest.mark.parametrize("bad_id", ["1", 1.0, True])
def test_furniture_id_must_be_an_int(bad_id):
    assert "isn't in the catalog" in placement_errors({**BED, "furniture_id": bad_id})[0]


@pytest.mark.parametrize("rotation", [45, 360, -90, "90", 90.0, None, False])
def test_bad_rotation(rotation):
    errors = placement_errors({**BED, "rotation": rotation})
    assert len(errors) == 1 and "0, 90, 180 or 270" in errors[0]


@pytest.mark.parametrize("x, y", [(-1, 10), (115, 10), (10, 151), (10, -0.5)])
def test_centre_outside_bounding_box(x, y):
    assert "outside the room" in placement_errors({**BED, "x": x, "y": y})[0]


def test_centre_on_the_edge_is_inside():
    assert placement_errors({**BED, "x": 0, "y": 150}) == []


@pytest.mark.parametrize("x", [float("nan"), float("inf")])
def test_nan_and_infinity_positions_fail(x):
    assert "outside the room" in placement_errors({**BED, "x": x})[0]


@pytest.mark.parametrize("x", ["10", None, True])
def test_position_must_be_a_number(x):
    assert "needs numbers" in placement_errors({**BED, "x": x})[0]


def test_custom_item_needs_a_label():
    for label in (None, "", "   ", "x" * 61):
        assert "needs a name" in placement_errors({**BEAN_BAG, "label": label})[0]
    assert placement_errors({**BEAN_BAG, "label": "x" * 60}) == []


@pytest.mark.parametrize("field, value", [
    ("width", 0), ("width", 201), ("depth", None), ("depth", 36.5),
    ("height", 121), ("height", 0),
])
def test_custom_item_size_limits(field, value):
    errors = placement_errors({**BEAN_BAG, field: value})
    assert len(errors) == 1 and f"needs a {field}" in errors[0]


def test_custom_item_size_at_the_limits_passes():
    assert placement_errors({**BEAN_BAG, "width": 200, "depth": 1, "height": 120}) == []


def test_every_problem_is_reported():
    errors = placement_errors({"furniture_id": 99, "x": 999, "y": 0, "rotation": 45})
    assert len(errors) == 3


# ---------------------------------------------------------------------------
# Shared feature cases: the same file is checked against builder/state.js in
# tests/builder.test.mjs, so the builder's inline errors match the server's.
# ---------------------------------------------------------------------------

FEATURE_CASES = json.loads(
    (Path(__file__).parent / "fixtures" / "feature_cases.json").read_text()
)["cases"]


@pytest.mark.parametrize("case", FEATURE_CASES, ids=lambda case: case["name"])
def test_shared_feature_cases(case):
    features = case["features"]
    if features == "41 outlets":
        features = [{"kind": "outlet", "wall": 0, "offset": 1}] * 41
    room = {"name": "Room", "kind": "bedroom", "outline": case.get("outline", RECT), "features": features}
    assert validate_room(room, 102) == case["expected"]
