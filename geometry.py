"""Room-format helpers and validation (the contract, SPEC.md section 4).

THIS FILE IS SHARED. static/js/shared/geometry.js holds the same wall helpers
in JavaScript; any change here needs the matching change there, and all three
teammates must agree before the room format itself changes.

Coordinates are plan-view inches: x grows to the right (east), y grows
downward (south), exactly like SVG. Outlines are listed clockwise as seen on
screen. Points are (x, y) tuples.
"""

import math

# Feature kinds the planner knows how to draw (SPEC.md 4.3).
FEATURE_KINDS = ("door", "window", "closet", "radiator", "outlet")

# Limits from the table in SPEC.md 4.2.
MIN_CEILING, MAX_CEILING = 72, 240
MIN_CORNERS, MAX_CORNERS = 3, 12
MAX_COORDINATE = 600
MAX_FEATURES = 40

# Tolerance for comparing an integer offset with a possibly non-integer wall
# length (a diagonal wall's length is a square root).
EPSILON = 1e-9


# ---------------------------------------------------------------------------
# Wall helpers
# ---------------------------------------------------------------------------

def walls(outline):
    """Return the walls of an outline as a list of (start, end) point pairs.

    Wall i runs from outline[i] to outline[(i + 1) % n], so the last wall
    closes the shape back to the first corner.
    """
    n = len(outline)
    return [(tuple(outline[i]), tuple(outline[(i + 1) % n])) for i in range(n)]


def wall_length(outline, i):
    """Return the length of wall i in inches (a float)."""
    (x1, y1), (x2, y2) = walls(outline)[i]
    return math.hypot(x2 - x1, y2 - y1)


def wall_letter(i):
    """Return the letter people see for wall i: 0 -> "A", 1 -> "B", ..."""
    return chr(ord("A") + i)


def signed_area(outline):
    """Return the polygon's signed area using the shoelace formula.

    With y pointing down (screen coordinates), an outline listed clockwise on
    screen has a POSITIVE signed area; counter-clockwise gives a negative one.
    """
    total = 0
    n = len(outline)
    for i in range(n):
        x1, y1 = outline[i]
        x2, y2 = outline[(i + 1) % n]
        total += x1 * y2 - x2 * y1
    return total / 2


def inward_normal(outline, i):
    """Return the unit vector (nx, ny) pointing from wall i into the room.

    We never assume the interior side from the corner order: the sign of the
    signed area tells us which way the outline winds. For a positive area
    (clockwise on screen), turning the wall's direction (dx, dy) into
    (-dy, dx) points inside. For a negative area, the opposite vector does.

    Example: the top wall of a rectangle runs from (0, 0) to (114, 0), so its
    direction is (1, 0) and its inward normal is (0, 1): straight down the
    screen, into the room.
    """
    (x1, y1), (x2, y2) = walls(outline)[i]
    length = math.hypot(x2 - x1, y2 - y1)
    dx, dy = (x2 - x1) / length, (y2 - y1) / length
    sign = 1 if signed_area(outline) > 0 else -1
    # "+ 0.0" turns -0.0 into 0.0 so results print and compare cleanly.
    return (-dy * sign + 0.0, dx * sign + 0.0)


def point_along_wall(outline, i, distance):
    """Return the point `distance` inches along wall i from its start corner."""
    (x1, y1), (x2, y2) = walls(outline)[i]
    length = math.hypot(x2 - x1, y2 - y1)
    t = distance / length
    return (x1 + (x2 - x1) * t, y1 + (y2 - y1) * t)


def feature_span(outline, feature):
    """Return (start, end): where a wall feature begins and ends on its wall.

    `start` is `offset` inches from the wall's start corner (the corner on
    your left when you stand inside the room facing the wall), and `end` is
    `width` inches further along. An outlet has no width, so start == end.
    """
    offset = feature["offset"]
    width = feature.get("width", 0) if feature["kind"] != "outlet" else 0
    start = point_along_wall(outline, feature["wall"], offset)
    end = point_along_wall(outline, feature["wall"], offset + width)
    return start, end


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

def validate_room(room):
    """Check a room-format dict against every rule in SPEC.md 4.2.

    Returns a list of error messages written for a person (empty when the
    room is valid), so the admin builder can show them next to the form.
    """
    if not isinstance(room, dict):
        return ["The room must be a JSON object."]

    errors = []
    if room.get("version") != 1 or not _is_int(room.get("version")):
        errors.append("Version must be 1.")
    if room.get("units") != "in":
        errors.append('Units must be "in".')

    ceiling = room.get("ceiling")
    ceiling_ok = _is_int(ceiling) and MIN_CEILING <= ceiling <= MAX_CEILING
    if not ceiling_ok:
        errors.append(
            f"Ceiling must be a whole number of inches from {MIN_CEILING} "
            f"to {MAX_CEILING} (got {ceiling!r})."
        )

    outline_errors = _validate_outline(room.get("outline"))
    errors.extend(outline_errors)

    features = room.get("features")
    if not isinstance(features, list):
        errors.append("Features must be a list.")
    elif len(features) > MAX_FEATURES:
        errors.append(f"A room can have at most {MAX_FEATURES} features.")
    elif not outline_errors:
        # Feature checks need wall lengths, so they only run on a good outline.
        # Without a valid ceiling, height checks fall back to the maximum.
        limit = ceiling if ceiling_ok else MAX_CEILING
        errors.extend(_validate_features(room["outline"], features, limit))
    return errors


def _is_int(value):
    """True for a real int. (In Python, True and False count as ints; we exclude them.)"""
    return isinstance(value, int) and not isinstance(value, bool)


def _validate_outline(outline):
    """Return error messages for the outline (corner list) of a room."""
    if not isinstance(outline, list) or not MIN_CORNERS <= len(outline) <= MAX_CORNERS:
        return [f"The outline must list {MIN_CORNERS} to {MAX_CORNERS} corners."]

    for number, corner in enumerate(outline, start=1):
        if (
            not isinstance(corner, list)
            or len(corner) != 2
            or not all(_is_int(c) and 0 <= c <= MAX_COORDINATE for c in corner)
        ):
            return [
                f"Corner {number} must be a pair of whole numbers from 0 to "
                f"{MAX_COORDINATE} (got {corner!r})."
            ]

    n = len(outline)
    for i in range(n):
        if outline[i] == outline[(i + 1) % n]:
            return [f"Wall {wall_letter(i)} has zero length (two corners are the same)."]

    if signed_area(outline) == 0:
        return ["The outline has no area."]

    crossing = _find_crossing(outline)
    if crossing:
        return [crossing]
    return []


def _find_crossing(outline):
    """Return a message if any two walls cross or touch, else None.

    Walls that are next to each other always share one corner, so for them we
    only reject a wall that doubles straight back over its neighbour. Walls
    that are not neighbours must not meet at all.
    """
    edges = walls(outline)
    n = len(edges)
    for i in range(n):
        for j in range(i + 1, n):
            neighbours = j == i + 1 or (i == 0 and j == n - 1)
            if neighbours:
                # Order the pair so the first wall's end is the shared corner.
                first, second = (edges[i], edges[j]) if j == i + 1 else (edges[j], edges[i])
                if _folds_back(first, second):
                    return (
                        f"Walls {wall_letter(i)} and {wall_letter(j)} "
                        "double back over each other."
                    )
            elif _segments_meet(*edges[i], *edges[j]):
                return f"Walls {wall_letter(i)} and {wall_letter(j)} cross each other."
    return None


def _orientation(p, q, r):
    """Cross product sign: >0 if p->q->r turns one way, <0 the other, 0 if in a line."""
    return (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])


def _on_segment(p, q, r):
    """True if point q lies on segment pr, given that p, q, r are in a line."""
    return min(p[0], r[0]) <= q[0] <= max(p[0], r[0]) and min(p[1], r[1]) <= q[1] <= max(p[1], r[1])


def _segments_meet(p1, p2, p3, p4):
    """True if segment p1p2 and segment p3p4 share at least one point.

    Standard orientation test: the segments cross when each one's endpoints
    lie on opposite sides of the other. The collinear cases catch segments
    that touch or overlap along a line.
    """
    d1 = _orientation(p3, p4, p1)
    d2 = _orientation(p3, p4, p2)
    d3 = _orientation(p1, p2, p3)
    d4 = _orientation(p1, p2, p4)
    if ((d1 > 0 > d2) or (d1 < 0 < d2)) and ((d3 > 0 > d4) or (d3 < 0 < d4)):
        return True
    return (
        (d1 == 0 and _on_segment(p3, p1, p4))
        or (d2 == 0 and _on_segment(p3, p2, p4))
        or (d3 == 0 and _on_segment(p1, p3, p2))
        or (d4 == 0 and _on_segment(p1, p4, p2))
    )


def _folds_back(first, second):
    """True if `second` starts where `first` ends and heads straight back along it."""
    (p, q), (_, r) = first, second
    in_line = _orientation(p, q, r) == 0
    # A negative dot product means the two directions point opposite ways.
    backwards = (q[0] - p[0]) * (r[0] - q[0]) + (q[1] - p[1]) * (r[1] - q[1]) < 0
    return in_line and backwards


def _validate_features(outline, features, ceiling):
    """Return error messages for the features list, given a valid outline."""
    errors = []
    counts = {}  # numbers features per kind, so messages say "Window 2"
    for feature in features:
        if not isinstance(feature, dict) or feature.get("kind") not in FEATURE_KINDS:
            kind = feature.get("kind") if isinstance(feature, dict) else feature
            errors.append(
                f"Unknown feature kind {kind!r}; use one of {', '.join(FEATURE_KINDS)}."
            )
            continue
        kind = feature["kind"]
        counts[kind] = counts.get(kind, 0) + 1
        name = f"{kind.capitalize()} {counts[kind]}"
        errors.extend(_validate_feature(outline, feature, name, ceiling))
    return errors


def _validate_feature(outline, feature, name, ceiling):
    """Return error messages for one feature. `name` is e.g. "Window 2"."""
    kind = feature["kind"]
    n = len(outline)

    wall = feature.get("wall")
    if not _is_int(wall) or not 0 <= wall < n:
        return [f"{name} must be on a wall from A to {wall_letter(n - 1)}."]
    letter = wall_letter(wall)
    length = wall_length(outline, wall)

    offset = feature.get("offset")
    if not _is_int(offset) or offset < 0:
        return [f"{name} needs a distance from the corner of 0 in or more."]

    errors = []
    if kind == "outlet":
        if offset > length + EPSILON:
            errors.append(
                f"{name} is past the end of wall {letter} "
                f"({offset} in on a {_inches(length)} wall)."
            )
    else:
        width = feature.get("width")
        if not _is_int(width) or width < 1:
            errors.append(f"{name} needs a width of 1 in or more.")
        elif offset + width > length + EPSILON:
            if width > length + EPSILON:
                errors.append(
                    f"{name} is wider than wall {letter} "
                    f"({width} in on a {_inches(length)} wall)."
                )
            else:
                errors.append(
                    f"{name} runs past the end of wall {letter} "
                    f"({offset} + {width} in on a {_inches(length)} wall)."
                )

    errors.extend(_validate_heights(feature, name, ceiling))

    if kind == "radiator" and "depth" in feature:
        depth = feature["depth"]
        if not _is_int(depth) or depth < 1:
            errors.append(f"{name} needs a depth of 1 in or more.")
    return errors


def _validate_heights(feature, name, ceiling):
    """Return error messages for a feature's height and (for windows) sill."""
    kind = feature["kind"]
    if kind == "outlet":
        return []  # outlets are always drawn at 12 in; no height to check
    height_required = kind in ("door", "window", "closet")
    if "height" not in feature and not height_required:
        return []  # a radiator may leave out its height

    height = feature.get("height")
    if not _is_int(height) or height < 1:
        return [f"{name} needs a height of 1 in or more."]

    if kind != "window":
        if height > ceiling:
            return [f"{name} is taller than the ceiling ({height} in under a {ceiling} in ceiling)."]
        return []

    sill = feature.get("sill")
    if not _is_int(sill) or sill < 0:
        return [f"{name} needs a sill height of 0 in or more."]
    if sill + height > ceiling:
        return [
            f"{name} reaches above the ceiling "
            f"(sill {sill} in + height {height} in under a {ceiling} in ceiling)."
        ]
    return []


def _inches(length):
    """Format a wall length for a message: whole numbers without decimals."""
    return f"{length:g} in" if length == int(length) else f"{length:.1f} in"
