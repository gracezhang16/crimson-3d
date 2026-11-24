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

## 2026-11-24 (S1)

- **`current_user()` returns the user row without the password hash** (`SELECT id, email, role, created`). The row is meant to be passed to templates, so leaving the hash out means it can never leak into a page by accident. Alternative: `SELECT *`, as the spec's wording ("the users row") might suggest.
- **`admin_required` reads the role from the database on every request**, not from the session. One extra small query per admin page, but a role change takes effect at once. Alternative: store `role` in the session at login (faster, but stale until the admin logs out).
- **`admin_required` gives a 403 to logged-out visitors too**, not a redirect to `/login`, following SPEC.md 7.4 literally.
- **Foreign keys are proved by behaviour, not by reading the setting.** `cs50.SQL` returns `True` for `PRAGMA` statements instead of rows, so the test inserts a room pointing at a dorm that doesn't exist and expects a `ValueError` (cs50's wrapper for SQLite's IntegrityError).
- **The decorators are tested on a throwaway Flask app** in `tests/test_helpers.py`, with fake routes, because `/login` and `/admin` don't exist yet. It reuses the project's templates and the `pages` blueprint so `apology.html` renders exactly as on the real site.
- **`apology.html` is a plain page with the status code and message**, not CS50 Finance's meme image, which loads from an outside website and would break offline.

## 2026-11-24 (S2)

Product choices confirmed by Grace before building:

- **Passwords need at least 8 characters** (CS50 Finance has no minimum). Checked on the server; the form's `minlength="8"` is only a convenience.
- **Registering logs you in straight away**, as in CS50 Finance.
- **`create_admin.py` with an already-registered email promotes that account** and keeps its password, so you can register on the site and then make yourself an admin. A new email is asked for a password twice with `getpass` (never shown, never in shell history).
- **Bad register/login input re-shows the form with the reason and the email filled in** (status 400, or 403 for a wrong password), instead of CS50 Finance's separate apology page.

Technical choices:

- **Emails are trimmed and lower-cased** on register, login and in `create_admin.py` (`helpers.normalize_email`), so `Foo@x.com` and `foo@x.com` are one account.
- **The duplicate-email check is the database's UNIQUE constraint**, caught as `ValueError`, not a `SELECT` first. A `SELECT` could miss two sign-ups arriving at the same moment.
- **Login says "Wrong email or password" for both an unknown email and a wrong password**, so the form doesn't reveal who has an account.
- **The new-account rules live in `helpers.check_new_account`**, so the website and `create_admin.py` can't drift apart.
- **`user` reaches every template through a context processor** (`inject_user` in `app.py`). That's one small query per page; the alternative, passing `user=` in every `render_template` call, is easy to forget.
- **Tests now get a fresh database each** (`tests/conftest.py`). A clean copy is built once per run and copied over the test database before every test with SQLite's backup API. Deleting and rebuilding the file would break `helpers.db`, which keeps its connection open. Two tests in `test_routes.py` prove the reset works.
- **No CSRF tokens on forms** (same as CS50 Finance). `SESSION_COOKIE_SAMESITE = "Lax"` stops other sites from submitting our forms with the user's cookie. Adding Flask-WTF would be a new dependency.

## 2026-11-24 (S3)

Product choices confirmed by Grace before building:

- **Admins see draft room types on dorm pages and in search, with a "Draft" badge**, and a banner on the draft's facts page. Visitors and students get the same 404 for a draft as for a missing room type, so they can't tell drafts exist.
- **The accuracy note leaves out "on {date}" when no date was recorded** (the sample rooms have none), instead of printing "on None".
- **Search is a plain GET form** (`/?q=...`) handled on the server, so it works without JavaScript and results can be bookmarked. Live filter-as-you-type is a possible Better-tier change.

Technical choices:

- **Room facts are computed in `pages.py` (`room_facts`), not in `geometry.py`**, so the shared contract file is unchanged. They use `geometry.signed_area` for the area. "Size" is the outline's bounding box; non-rectangular rooms are labelled "overall".
- **"Storage" says "Built-in closet" if the room has a closet feature, otherwise "No closet; Harvard provides a wardrobe"**, following Harvard's furniture list (SPEC.md 5).
- **Search escapes `%` and `_`** (`like_pattern`, with `ESCAPE '\'`) so typing them searches for them literally instead of matching everything.
- **One SQL condition decides what a viewer may see**: `VISIBLE_TYPE = "(room_types.status = 'published' OR ?)"`, with `?` = 1 for admins. Every browsing query uses it, so the draft rule lives in one place.
- **`feet_inches` is a Jinja filter registered from the pages blueprint** (`app_template_filter`), so `app.py` didn't change. Other teammates' templates can use it too.
- **"Open in 3D" is a plain `/plan/<id>` link**, not `url_for`, because that route arrives with the planner (P1). Switch it to `url_for` then.
