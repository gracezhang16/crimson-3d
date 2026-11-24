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

## 2026-11-24 (S4)

- **Unknown `/api/...` addresses and wrong methods return JSON** (`{"error"}` with 404 or 405) through two error handlers in `app.py`. SPEC.md 7.2 says all API responses are JSON, and a request that matches no route never reaches the api blueprint, so the handler has to be on the app. Every other 404/405 keeps Flask's normal error page.
- **`json_error(message, code)` lives in `helpers.py`** next to `apology()`, so Hannah's `/admin/api/...` endpoints can return the same error shape.
- **`viewer_is_admin()` and the `VISIBLE_TYPE` SQL condition moved from `pages.py` to `helpers.py`**, because the API needs the same draft rule. The draft rule now lives in one place for pages and API. `VISIBLE_TYPE` is a fixed string pasted into queries with an f-string; every value still goes through a `?` placeholder.
- **Placement `x`/`y` come back as `94`, not `94.0`** (`whole_if_possible`). They're stored as REAL because they may be fractional while dragging, but they're whole inches once saved (SPEC.md 4.4).
- **Custom placements include `label`, `width`, `depth`, `height`; catalog placements don't** (`placement_to_json`), matching the two examples in SPEC.md 4.4. S5's layout endpoints reuse the same function.
- **A room type with no default layout returns `"placements": []`** rather than an error, so the planner can open a freshly built room before an admin has furnished it.
- **`/api/furniture` lists Harvard items first, then purchases, each in catalog order** (`ORDER BY category = 'purchase', id`), matching the side panel's sections (SPEC.md 8.6).

## 2026-11-24 (S5)

Product choices confirmed by Grace before building:

- **A student may have several layouts with the same name for the same room.** Layouts are told apart by id, and "Save as new" doesn't have to invent a unique name. Alternative: reject duplicates with a message.
- **If a room type goes back to draft, its students' layouts are kept but unreachable** (404, like the room itself) until it is published again. The planner couldn't draw the room anyway, since `/api/types/<id>` also returns 404.

Technical choices:

- **CONTRACT: added `validate_placements(placements, room, furniture_ids)` to `geometry.py`** (SPEC.md 6 and 7.2 already place it there). The room format (SPEC.md 4) is unchanged. No JavaScript twin: it's a server-side check, and the planner's own checks are the collision rules in `rules.js`. Hannah's default-layout endpoint (A6) should call it too.
- **`validate_placements` gets the set of catalog ids as an argument** instead of querying the database, so `geometry.py` stays pure and the tests need no database.
- **Custom item labels are limited to 1–60 characters**, the same as layout names. The spec requires a label but gives no length.
- **Position checks are written as "inside the box"**, because every comparison with NaN is False; Python's JSON parser accepts `NaN` and `Infinity`, and this way they fail. Tested.
- **Validation errors are summarised as one message**: the first problem plus "(and N more problems)", keeping the `{"error": "..."}` shape from SPEC.md 7.2.
- **`api_login_required` checks the user still exists**, not just that the session has an id. A stale session after a database rebuild gets a clean 401 instead of a foreign-key error on save.
- **Ownership order: 404, then 403.** A layout that doesn't exist, or whose room the viewer can't see, gives 404. Someone else's layout gives 403, as SPEC.md 7.2 asks. That includes default layouts (no owner), even for admins, who save those through `/admin/api/types/<id>/default-layout`.
- **Saves run inside a transaction** (`run_in_transaction`: `BEGIN` ... `COMMIT`, `ROLLBACK` on any error). A test simulates a crash halfway through inserting placements and checks nothing was left behind.
- **Catalog placements ignore any `label`/size sent with them**; only custom items store those columns.
- **`updated` is SQLite's `CURRENT_TIMESTAMP`, which is UTC** (`2026-11-24 07:37:33`). The layouts page (S6) should present it in a friendlier way.
- **`share_url` is built by hand from `request.host_url`** until S7 adds the `/share/<token>` route; it is always `null` until then.

## 2026-11-24 (S6)

Product choices confirmed by Grace before building:

- **Rename and Delete on My layouts call the S5 API from JavaScript** (`static/js/layouts.js`), instead of HTML forms posting to new `POST /layouts/<id>/rename` and `/delete` routes. That reuses the API's validation and ownership checks and adds no routes beyond SPEC.md 7.1. The cost: those two buttons need JavaScript.
- **No Share buttons until S7**, when share links exist.
- **My layouts hides layouts whose room type went back to draft**, consistent with the API (S5). Alternative: show them greyed out.
- **`/my-room` for a room whose type is still a draft shows "You're assigned to {dorm} {number}, but its 3D model isn't published yet"** instead of redirecting to a planner that would 404. Admins are redirected anyway, since they can see drafts.

Technical choices:

- **CONTRACT (new shared file): `static/js/shared/api.js` with `apiFetch(url, {method, body})`**, the "fetch wrappers with error handling" listed in SPEC.md 6. It returns parsed JSON or throws an `Error` whose message is the server's `{"error"}` text (or a readable fallback) with `error.status` set (0 = no answer). Claire's planner can use it for P4 and P6. Tested in `tests/api.test.mjs` with a fake `fetch`.
- **`current_user()` now includes `room_id`** (LEFT JOIN on `assignments`), so the navbar shows "My room" only to assigned students (SPEC.md 1) without a second query per page.
- **"Last saved" is sent as UTC in `<time datetime="...Z">` and shown in the viewer's time zone by JavaScript** (`toLocaleString`). Without JavaScript the UTC date is shown. Alternative: format on the server, which can't know the viewer's time zone.
- **layouts.js builds messages with `textContent`, never `innerHTML`**, so a layout named `<script>` is shown as text, not run.
- **The rename form's flex layout sits on an inner `<div>`**: Bootstrap's `.d-flex` uses `display: flex !important`, which would override the `hidden` attribute on the form itself.

## 2026-11-24 (P1, built for Claire with the team's agreement)

- **`/plan/<id>` lives in `pages.py`** (SPEC.md 7.1 lists it there); the template, CSS and JavaScript are Claire's. Drafts 404 for non-admins, like the facts page. The "Open in 3D" links now use `url_for('pages.plan', ...)`.
- **`layout.html` gained a `main_class` block** (default `container py-4`) so the planner can use the full window width. Other pages are unchanged; a test checks the home page still has the container.
- **Planner layout follows `docs/demo-reference.html`**: a 318 px tool panel on the left and the room filling the rest. Below 768 px the room goes on top (60% of the screen height) with the panel underneath.
- **WebGL check looks for WebGL 2 only**, because three.js 0.170 dropped WebGL 1. If creating the renderer still fails, the same SPEC.md 8.8 message is shown.
- **Render on demand**: a frame is drawn only when OrbitControls fires `change` (including while damping glides to a stop) or another module calls `requestRender()`. The scene costs nothing while idle.
- **Panning is allowed but clamped**: the orbit centre can slide over the floor's bounding box and no further; target and camera move back together so the view angle doesn't jump (SPEC.md 8.2: "disable panning beyond the room"). Panning moves along the floor (`screenSpacePanning = false`), never up through the ceiling.
- **`fitCamera(box)` backs the camera off until the box's bounding sphere fits in the 35° field of view** (+10%), viewing from the south-east and above so the north wall is at the back. It also sets the zoom limits and near/far planes from the room's size.
- **The camera stops 0.05 rad above the horizon** (`maxPolarAngle`), so it can't look up from under the floor.
- **Checked in headless Chrome** (screenshots at 1280 px and phone width). Headless Chrome won't make its window narrower than about 500 px, so the exact phone fit still needs a real browser's device mode.
