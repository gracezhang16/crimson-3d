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

## 2026-11-24 (A1, built for Hannah with the team's agreement)

- **The admin guard test reads Flask's route table** (`app.url_map`) instead of listing URLs by hand, and tries every `/admin` route with every method as a visitor and as a student (both must get 403). A route added later without `@admin_required` fails the tests automatically; this was checked by temporarily removing the decorator from `/admin/types`. A separate test makes sure the route list isn't empty, so the guard tests can't pass by testing nothing.
- **The admin home route is `""`, not `"/"`**, so the page is at `/admin` (SPEC.md 7.3) rather than `/admin/`.
- **Admin home shows seven counts**: published and draft room types, dorms, rooms, students, students with a room, and furniture items. Pages from later milestones are listed greyed out with "coming in A…", so the plan is visible; each becomes a link when built.
- **The room types list links to each type's facts page**, not straight to `/plan/<id>`, because the planner route is on the `planner` branch; keeping the `admin` branch independent avoids a merge-order dependency. The facts page has "Open in 3D". Edit and Publish buttons arrive in A4.
- **"Last updated" on the room types list is labelled UTC** (it's SQLite's `CURRENT_TIMESTAMP`).
- **Navbar "Admin" link for admins only** (`layout.html`, shared).

## 2026-11-24 (A2, built for Hannah with the team's agreement)

Product choices confirmed by Grace:

- **Any-shape rooms are in the builder from A2, not A8.** Some rooms aren't rectangular, and building both modes now avoids rewriting the form later. This moves part of a Better-tier milestone (A8) into the Good tier, against the CLAUDE.md "Good first" rule, by the team's choice. The planner and the room format already handled any polygon.
- **Custom shapes are entered by "walking the walls"**: start at a corner, go clockwise (room on your right), and give each wall's direction (N/E/S/W) and tape-measured length. It matches how rooms are measured. Walls are at right angles only; angled walls (e.g. bay windows) would need the coordinate or click-to-draw approach of A8. Alternatives considered: a table of corner coordinates; click-to-draw on a grid (A8).
- **The dorms page (`/admin/dorms`, list and add) was pulled forward from A7** so real dorms can be added before rooms are built; otherwise only Demo Hall existed.

Technical choices:

- **Counter-clockwise walks are rejected with a message, not silently reversed** (SPEC.md 9.2 suggests reversing). Reversing would re-letter the walls so they no longer matched the table rows the admin typed, and A3's features refer to walls by letter.
- **Walls that don't meet are drawn open, with the gap as a dashed red line**, and the message says how far off the end is ("6 in east and 2 in south"). Drawing them closed would invent a last wall with the wrong length.
- **Walks are shifted so the smallest x and y are 0.** SPEC.md 4.2 allows coordinates 0–600 only, and a walk may head west or north of its first corner. So the first corner isn't always the origin, which differs from the SPEC.md 4.1 sentence "The origin is the room's first corner"; the team may want to update that sentence. Validation is unaffected.
- **Doubling back (a wall followed by one in the opposite direction) is rejected**, matching `validate_room`'s fold-back rule. Two walls in the same direction in a row are allowed (a straight-through corner).
- **Self-crossing outlines are caught by the server** (`validate_room`, on save in A4), not yet in the live preview.
- **The preview uses the SVG `viewBox` to scale**: corners are drawn in inches as-is, because SVG and our plan both have y pointing down. Lines use `vector-effect: non-scaling-stroke`; the 1 ft grid is clipped to the room with a `clipPath`. Side-wall labels are anchored away from the wall (`labelAnchor`).
- **Pure builder code is split into `builder/state.js`** (form values → geometry) **and the helpers in `preview.js`**, both covered by `tests/builder.test.mjs`. `main.js` only reads the form and wires things up.
- **Form fields are read with `form.elements.namedItem(name)`**, because `form.elements.length` is the number of fields, not our "length" input. That bug was caught in a screenshot.
- **Wall rows are cloned from an HTML `<template>`**, so their markup (labels included) lives in the template, not in JavaScript strings.
- **The inactive shape's fieldset is `disabled` as well as hidden**, so its fields are neither validated nor submitted.
- **Dorm fields: name 1–60 characters (unique), yard up to 60, description up to 500**; the spec gives no limits.
