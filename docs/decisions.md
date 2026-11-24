# Decisions log

A running log of non-obvious choices, to help the team write DESIGN.md.
Format: date, what, why, alternatives considered.

## 2026-11-24 (M0)

- **JS test command is `node --test tests/*.test.mjs`, not `node --test tests/`.** On Node 22 and later, a folder argument is run as if it were a single test file, and that fails. The shell expands the `*` pattern before Node sees it, so this form also works on older Node versions. SPEC.md and CLAUDE.md updated. Alternative: bare `node --test`, which finds test files automatically but also searches folders we don't control.
- **`init_db.py` runs `schema.sql` through Python's built-in `sqlite3`, and everything else through `cs50.SQL`.** `cs50.SQL.execute` runs one statement per call, and splitting the schema file on `;` would break as soon as a comment contains one. `sqlite3` is in the standard library, so this adds no dependency.
- **Foreign keys: we rely on `cs50.SQL`.** cs50 9.5.0 runs `PRAGMA foreign_keys=ON` on every connection (see `cs50/sql.py`), so `helpers.py` doesn't repeat it. S1 adds a test that proves it.
- **`init_db.py` validates every seed room with `geometry.validate_room()` and stops on the first bad one.** A broken seed file should fail loudly at build time, not as a blank 3D view later.
- **Validation error messages number features per kind** ("Window 2" = the second window), matching the example in SPEC.md 7.3. Walls are named by letter (A = wall 0), the same as the builder preview.
- **Geometry helpers return points as tuples in Python and `[x, y]` arrays in JavaScript.** Arrays match the JSON format. In JS, `walls()` returns `{start, end}` objects so planner code reads clearly.
- **Demo Hall rooms: the door, window, radiator, closet and outlet positions and the default furniture layouts were invented**, laid out so nothing overlaps or blocks a door, closet or radiator. The single has a closet, so it gets no wardrobe; the double has no closet, so it gets two (following Harvard's furniture list).
- **Furniture seed colours vary slightly by item** (browns for wood, greys for purchases) so items are easy to tell apart in 3D. The spec gave sizes only.
- **`pytest.ini`** limits pytest to `tests/` and adds the project root to the import path, so tests can `import geometry` and `import app`.
- **M0 test database is built once per test run** (`tests/conftest.py`). Rebuilding it for every test is left to the S-track, when tests start writing data.
