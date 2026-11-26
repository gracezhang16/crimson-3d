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

## 2026-11-24 (A3, built for Hannah with the team's agreement)

- **Feature validation now exists in JavaScript too** (`builder/state.js: featureProblems`), mirroring `geometry.py`'s `_validate_features` message for message, because A3 needs inline errors as you type. This contradicts the `geometry.js` header note that "validation lives only in Python". The server remains the gatekeeper and checks again on save (A4). The JS copy lives in the builder, not in the shared contract file.
- **One fixture file keeps the two copies identical**: `tests/fixtures/feature_cases.json` lists 19 cases with their exact expected messages. `tests/test_geometry.py` checks `validate_room` against it and `tests/builder.test.mjs` checks `featureProblems`. A wording change on one side fails the other side's tests.
- **Features are only checked once the outline is valid, and against 240 in while the ceiling is invalid**, the same as `validate_room`.
- **`featureFromValues` keeps only the keys each kind uses** (an outlet has no width; only windows have a sill). A radiator's empty height and depth are left out rather than sent as blanks, because both are optional in SPEC.md 4.2.
- **Each feature row is its own `<tbody>`** holding the inputs row and a hidden error row, so a row's problems sit directly under it and the two stay together when removed. Rows with problems are tinted red (Bootstrap `table-danger`) and the reason is shown as text, so colour isn't the only signal.
- **A wall deleted from the shape stays selected as "F (removed)"** in its features' dropdowns, so the row shows an error rather than quietly moving the door to a different wall.
- **The preview draws features in the planner's colours**: door = brown stretch of wall plus its faint door zone, window = blue double line, closet = dashed 24 in box, radiator = grey box, outlet = dot. Features with problems aren't drawn. Positions come from `featureSpan()`, shared with the planner.
- **Red arrows mark each wall's left corner** (SPEC.md 9.1 item 4). Outlines are clockwise, so that's simply each wall's start corner. The arrowhead is an SVG `<marker>` sized in inches (`markerUnits="userSpaceOnUse"`).
- **The form column is now 7 of 12 Bootstrap columns (preview 5)** so the eight-column features table fits without hiding the dropdown text.
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

## 2026-11-24 (P2, built for Claire with the team's agreement)

- **P2 loads the room from `/api/types/<id>`, not the static seed file** SPEC.md 10 mentions. Flask doesn't serve `seed/`, and the API (S4) already existed. Furniture from the same response is used from P4.
- **SPEC.md 8.3 wording, to fix:** it says a wall becomes a stub when "its inward normal points toward the camera". The wall that hides the room is the one with the camera on its *outer* side, i.e. its inward normal points *away* from the camera. We implemented the intended behaviour (`roomMath.cameraOutsideWall`, tested from four viewpoints including an L-shape). The team should correct the spec sentence; it wasn't edited here.
- **Walls are extended by their thickness only at outer (convex) corners** (`roomMath.isConvexCorner`). Extending at the inner corner of an L-shape would push the wall box into the room.
- **Walls are built 1 unit tall and stretched with `scale.y`**, with the box's origin at its bottom, so switching between full height and a 4 in stub is a single property change per frame.
- **Floor grid is a 64 px canvas texture repeated every 12 in.** `ShapeGeometry` uses the shape's own coordinates (inches) as texture coordinates, so `repeat = 1/12` gives one grid square per foot with no extra maths.
- **New pure module `static/js/planner/roomMath.js`** (no three.js or DOM) holds the corner and dollhouse maths, so `node --test` covers them. `rules.js` (P7) will follow the same pattern.
- **New shared file `static/js/shared/units.js`** with `formatFeetInches`, used by the planner labels and (from A2) the builder preview. The identical file is added on both branches, so they merge cleanly. Its Python twin is the `feet_inches` filter.
- **Wall labels go on the two full-height walls farthest from the camera**, as HTML positioned by projecting each wall's top centre each frame. They are hidden when the point is behind the camera, and the 3D area clips them (`overflow: hidden`).
- **The camera now orbits the centre of the room's box (half the ceiling height), not the floor.** Aiming at the floor cut off the top of the walls; panning keeps that height.
- **`scene.js` gained `addFrameCallback(fn)`** so modules can update things that depend on the camera (stubs, labels) right before each frame.

## 2026-11-24 (P3, built for Claire with the team's agreement)

- **Zones live in `rules.js` from P3** (`zones(geometry)`: corners plus bounding box plus issue text) even though the rest of `rules.js` is P7. P3 draws door zones, and P7 checks furniture against the same zones, so there is one definition. Each zone is a rectangle against the wall, as wide as the feature: door = width deep, closet = 24 in, radiator = its depth (default 6 in), per SPEC.md 4.3.
- **Features are placed with `featureSpan()` from `shared/geometry.js`**, the same function the builder preview uses (A3), so "offset from the left corner as seen from inside" is computed in exactly one place.
- **Each feature is built in its own space** (x along the wall, y up, z into the room), then turned with `rotation.y = atan2(nx, ny)` so its z axis follows the wall's inward normal. One placement function serves every kind of feature and every wall angle.
- **Doors, windows, closets and outlets hide with their wall when it drops to a stub**; radiators and door zones stay because they're on the floor and affect furniture. Alternative: show features on stubs, which would leave doors floating in mid-air.
- **Only door zones are tinted for now** (SPEC.md 4.3 asks for that one). Closet and radiator zones are computed and will matter in P7.
- **No door-swing arcs**: the room format has no hinge side, so neither the planner nor the builder draws one. Adding a hinge would change SPEC.md 4 and needs all three teammates.
- **Checked with a scratch "Feature test" room** (door, window, radiator and outlet on the north wall, closet on the west wall), because both sample rooms put their door on the south wall, which is a stub from the default view.

## 2026-11-24 (dev branch)

- **`planner` and `admin` were merged into one shared branch, `dev`**, before A4, because A4's "done when" (a room built in the form opens in the planner) needs both tracks. Work continues on `dev`, one commit per milestone, so each teammate can still review their own commits. The merge was clean (the `.gitattributes` union driver handled `decisions.md`).

## 2026-11-24 (A4, built for Hannah with the team's agreement)

Product choices confirmed by Grace:

- **Editing a published room type keeps it published**; changes go live on save, and the edit page warns about that. Alternative: every edit sends it back to draft.
- **After saving, the admin stays on the edit page** with a "Saved draft" / "Saved changes" message. Alternative: go back to the room types list.

Technical choices:

- **The server checks everything again** (`read_room_type_form`): dorm exists, name 1–60 and unique in the dorm, capacity 1–6, bathroom from the list, a real date, notes ≤ 500, and the geometry through `validate_room()`. Errors re-show the form with what was typed, the shape included, as a list of readable messages (SPEC.md 7.3).
- **The browser won't submit while the preview lists problems** ("Fix the problems listed under the preview before saving"). So the hidden `geometry` field only ever carries a shape the page accepted, and when the server finds a problem (e.g. a self-crossing walk, or a bad capacity) the shape comes back intact. If JavaScript is off, the field is empty and the server says the shape is missing.
- **Duplicate names are checked up front** so they're listed with other problems; the `UNIQUE (dorm_id, name)` constraint still catches two saves arriving at the same moment.
- **Saved rooms reach the page through `data-geometry`** on the form (no inline script data, SPEC.md 11). `builder/state.js: geometryToForm` turns them back into form values: a rectangle starting at (0, 0) opens as Rectangle; any other right-angled outline opens as walked walls from its first corner (round trip tested).
- **Rooms with angled walls can't be shown in the form, so saving is turned off for them**, with an explanation. Otherwise the form would fall back to a default rectangle and Save would overwrite the real shape. No such rooms exist yet.
- **Publish re-validates the saved geometry** and refuses with the first problem if it fails (SPEC.md 7.3). Publish and Unpublish are small POST forms outside the builder form, because forms can't be nested, and they act on the last *saved* version (the page says so).
- **Preview in 3D opens `/plan/<id>` in a new tab**, which admins can see for drafts.
- **A radiator's height placeholder says 24** (the default height), not a door's 80.

## 2026-11-24 (P4, built for Claire with the team's agreement)

- **The room type and the furniture catalog load together** (`Promise.all`), so the planner waits for one round trip, not two. The catalog is kept as a `Map` by id.
- **Item sizes come from `rules.itemDimensions()`**: the catalog for catalog items, the placement itself for custom "will it fit" items (grey, no clearance). It's pure, in `rules.js`, because P7's collision rules need the same sizes. `footprint()` (SPEC.md 4.5 rule 1) and `footprintBox()` are there too, tested at all four rotations.
- **Each item is a `THREE.Group` with its origin at the footprint's centre on the floor** (SPEC.md 8.4): moving it later only changes `position.x` and `position.z`. The placement and its size are kept on `group.userData` so P5 can find them from a click.
- **Plan rotation is clockwise but three.js turns anticlockwise**, seen from above, so `rotation.y = -angle`. At rotation 0, width runs along plan x and depth along plan y, with the front facing south (SPEC.md 4.4).
- **Labels are canvas textures laid on top of each box, along its longer side, with the text shrunk to fit.** They turn with their item but get an extra half turn when they'd otherwise read upside down from the usual south-east view (the double's wardrobes face north). They use a basic material, so lighting doesn't dim them, and don't write depth, so their transparent parts can't hide anything.
- **A placement whose catalog item no longer exists is skipped with a console warning.** The server checks ids on save, so this only happens if an admin deletes a catalog item later.

## 2026-11-24 (A5, built for Hannah with the team's agreement)

Product choices confirmed by Grace:

- **Assigning a student who already has a room moves them**, and the message says where from ("moved from Demo Hall C-3"). The schema allows one room per student (`assignments.user_id` is the primary key). Alternative: refuse until they're unassigned.
- **A room holds at most its room type's capacity**: a third student in a double is refused with "Demo Hall B-21 is full (capacity 2)". Alternative: allow it with a warning.

Technical choices:

- **A room's dorm comes from its room type** (the form asks for number and type only), so `rooms.dorm_id` can never disagree with the type's dorm. The type list is grouped by dorm with `<optgroup>`.
- **Unassign takes a hidden `user_id` field**, which SPEC.md 7.3 doesn't list: a double can hold two students, so the form must say which one to remove.
- **Moving uses `INSERT OR REPLACE`**: because `user_id` is the primary key of `assignments`, the student's old row is replaced by the new one in a single statement.
- **The rooms page reports outcomes with flash messages and redirects after every POST** (add, assign, unassign), so reloading never repeats an action. Emails are trimmed and lower-cased with `normalize_email`, as at registration.
- **Room numbers are 1–20 characters, unique per dorm** (`UNIQUE (dorm_id, number)`).

## 2026-11-24 (P5, built for Claire with the team's agreement)

Product choice confirmed by Grace:

- **Arrow keys move items relative to the camera**: ↑ moves along whichever wall direction points most "away" on screen (`roomMath.arrowDirection`, tested from four viewpoints). Alternative: fixed directions (↑ = north), which feel backwards when looking from the north.

Technical choices:

- **`layout.js` is the single source of truth** for the placed items and the selection. Every change goes through it and then notifies listeners (the panel now; "Unsaved changes" in P6).
- **Picking uses a `Raycaster`; dragging intersects the pointer's ray with a horizontal plane at the grab height**, keeping the grab offset, so items slide along the floor (SPEC.md 8.5). Pointer capture keeps a drag going outside the canvas.
- **The pointer-down listener runs in the capture phase**, before OrbitControls' own listener, so a press on furniture switches the camera controls off before they start turning the view. Right- and middle-drag always go to the camera.
- **Wall-flush snapping applies to dragging only** (SPEC.md 4.5 rule 7 says "on drag"). Arrow keys and turning only round and keep the item inside the room's box (`snap(..., { flush: false })`); otherwise nudging 1 in away from a wall would snap straight back.
- **`overlaps`, `insideRoom` (with `pointInPolygon`) and `findFreeSpot` came forward from P7** because adding from the catalog needs a free spot. `insideRoom` checks corners and also that no wall crosses the footprint; the second check matters for notched rooms (tested with a U-shape). P7 adds flat items' and clearance rules to the issues list.
- **New items avoid door, closet and radiator zones as well as other items**, except flat items (rugs), which never collide (rule 3). A screenshot showed a new fridge landing against the radiator before this.
- **The selected item gets a flat crimson frame on the floor**, not a line: WebGL draws lines 1 pixel wide whatever the zoom.
- **The planner now has a fixed height** (window minus the navbar) and its panel scrolls inside. Before, the long panel stretched the page, so the 3D canvas resized, and the view jumped, every time the selection card appeared or disappeared. Found with real mouse events in headless Chrome.
- **"In this room" lists every item as a button**, so items can be selected without a mouse (then R, arrows and Delete work). The selected one is marked with `aria-pressed`, a crimson edge and bold text, not colour alone.
- **The tab icon is an inline SVG in `layout.html`** (shared), so browsers stop requesting `/favicon.ico`, whose 404 showed as a console error.
- **Interaction was tested end to end with real mouse and keyboard events**, using a scratch script that drives headless Chrome over the DevTools protocol with Node's built-in WebSocket (not part of the project, no new dependency): find the bed by clicking, drag it, R, Shift + arrows, add a mini fridge, Delete, Escape, then check the panel and the console.

## 2026-11-24 (P6, built for Claire with the team's agreement)

Product choices confirmed by Grace:

- **"Save as new" uses the name box, adding " (copy)" if the name wasn't changed**, so the two don't look identical in the list (`saving.nameForCopy`, tested). Alternative: a pop-up asking for a name.
- **Logged-out visitors get no "Leave site?" warning.** They can't save, and the warning would also fire on clicking "Log in". The panel says "Log in to save this layout". Keeping their changes across login (in browser storage) is a possible later improvement.

Technical choices:

- **`/plan/<id>?layout=<id>` checks ownership on the server** (SPEC.md 7.1, 12): logged out → `/login`, another student's layout (including a default layout) → 403, missing or for another room → 404. The JavaScript then loads it from `GET /api/layouts/<id>`, which checks ownership again.
- **One Save button covers saving and renaming**: an open layout is updated with `PUT` (name and placements together); a new one is created with `POST`. After the first save, the address becomes `?layout=<id>` via `history.replaceState` (no reload), so reloading or bookmarking reopens it.
- **"Unsaved changes" follows furniture changes and name edits, not selection.** `layout.js` now tells listeners `{ content: true | false }`, so clicking an item doesn't mark the layout unsaved. While it shows, `beforeunload` makes the browser ask before leaving.
- **The layout controls sit near the top of the panel**, not after the catalogue as SPEC.md 8.6 lists them, because the panel now scrolls and Save would otherwise be out of sight.
- **Placements are sent in the SPEC.md 4.4 shape** (`placementForSaving`): catalog items send id, centre and rotation; custom items also send label and size; positions are whole inches.
- **Tested end to end in headless Chrome with real input**: register, drag the bed, Save (URL changes, database has the new position), reload (bed comes back), rename, Save as new, then a change plus navigation triggers the browser's leave warning.

## 2026-11-24 (A6, built for Hannah with the team's agreement)

- **The default-layout page reuses the planner** (`plan.html` with `data-mode="admin-default"`). The panel shows "Save default layout" and "Visitors see this arrangement first" instead of the student's name box and saved-layout list. It works for drafts, so a room can be furnished before it's published.
- **`PUT /admin/api/types/<id>/default-layout` validates with `geometry.validate_placements`** (as noted when S5 added it) and replaces the placements in a transaction. If the room has no default layout yet, one is created; the code looks up the existing `user_id IS NULL AND is_default = 1` row first, so there is never more than one per room type (SPEC.md 5; tested by saving twice).
- **`insert_placements`, `run_in_transaction` and `placements_error` moved from `api.py` to `helpers.py`**, since both the layouts API and the admin endpoint use them. `api.py` behaves exactly as before; all its tests still pass, including the rollback test.
- **The endpoint uses `@admin_required` like every admin route** (SPEC.md 7.3), so a student's request gets the HTML 403 page rather than JSON. The planner's `apiFetch` still shows a readable message ("Something went wrong (error 403)"), and only admins reach this page anyway.
- **Tested end to end in headless Chrome**: an admin drags the bed on the default-layout page and saves; logged out, `/api/types/<id>` and the planner show the new position.

## 2026-11-24 (P7, built for Claire with the team's agreement)

- **"Too big for this room" means the item doesn't fit inside the room's bounding box turned either way**, so no amount of moving or turning helps. An item that would fit if turned gets "Outside the room" instead. The spec names the issue but doesn't define it.
- **`rules.evaluate(geometry, entries)` gives each item at most one issue in SPEC.md's order** (too big, outside, door, closet, radiator, overlap), as rule 8 asks. Both items in an overlap get an issue naming the other ("Overlaps the bed, twin XL"); only the first letter of the name is lower-cased, so "XL" stays.
- **Rule 3 (flat items):** a rug (height ≤ 1 in) skips zones and overlaps entirely, but can still be "Too big" or "Outside the room", since those aren't collisions.
- **Rule 4 (clearance):** two items may overlap if either fits under the other (`height ≤ clearance`), checked both ways (`mayOverlap`).
- **Zones are compared by bounding box**: exact for walls running north-south or east-west (all our rooms), slightly generous for angled walls.
- **The rules re-run after every change inside `layout.js`**, so tints, the pill, the selection card and the item list always agree. At most 100 items, so checking every pair each time is cheap.
- **Issues are shown in words as well as orange**: the selection card and each "In this room" entry show "⚠ Blocks the door", and the status pill uses ✓ / ⚠ plus text, so colour is never the only signal (SPEC.md 11). The pill is `role="status"`, so screen readers announce changes.
- **A node test runs both sample rooms' default layouts through `evaluate`** and expects no issues, so a seed edit that creates a clash fails the tests.
- **Wall snapping (rule 7) was already done in P5.**

## 2026-11-24 (Visual redesign, asked for by Grace)

- **Look: near-black and crimson** (chosen over a crimson banner or an all-crimson background, which is tiring to read and clashes with the orange issue tints). Bootstrap runs in its built-in dark mode (`data-bs-theme="dark"` on `<html>`) and `style.css` overrides its colour variables, so forms, tables, cards, lists and alerts follow without per-component CSS.
- **Contrast rule:** deep crimson `#a51c30` is only for fills, borders and buttons (white text on it is about 7:1). As text on the dark page it's too dark (about 2.6:1), so links and crimson text use `--crimson-bright` `#e2566b` (about 5:1). Muted text is `#a8a09c` (about 7:1).
- **Fonts: Fraunces (headings) and Inter (text), vendored** in `static/vendor/fonts/` as variable `.woff2` files (about 130 KB total) with their SIL Open Font Licence files, like three.js and Bootstrap. Chosen over a Google Fonts link (a CDN, against CLAUDE.md, and broken offline at the showcase) and over system fonts (less distinctive, and they vary between Mac and Windows). Downloaded once from the `@fontsource-variable` packages on jsDelivr.
- **The planner and builder follow the theme**: the 3D background is near-black (`scene.js` `BACKGROUND`), so the light room stands out; wall labels are dark chips; the builder's SVG preview is a dark drawing with light walls. The orange issue text was lightened to stay readable on the dark panel.
- **The navbar height is now a token** (`--c3-nav-height`, 3.75rem), and the planner's fixed height uses it, so the two can't drift apart (the new navbar is taller than Bootstrap's default, which briefly made the planner run 3 px past the window).
- **Home page**: a large serif headline, a big search box and dorm cards, plus a decorative isometric room drawing (inline SVG, `aria-hidden`, hidden below 992 px). The eyebrow says "For incoming first-years", not anything that could read as official.
- **The current page is marked in the navbar** (underline plus `aria-current="page"`), using `request.endpoint` in `layout.html`.

## 2026-11-24 (White theme and furniture shapes, asked for by Grace)

- **Back to a white page, keeping the redesign's character**: same fonts (Fraunces, Inter), crimson accents, cube mark, home hero and cards, now on white, framed by a black navbar and footer with crimson rules. This replaces the near-black look above. On white the main crimson `#a51c30` reads well as text (about 7:1), so it's used for links too; the black navbar uses a brighter crimson for its accents. Only the navbar keeps `data-bs-theme="dark"`, so Bootstrap draws its menu button light-on-black. The planner background, wall labels, status pill and builder preview went back to light colours.
- **Catalog furniture is drawn as what it is** (`static/js/planner/shapes.js`, SPEC.md 8.4's composite-shapes option, built from boxes and cylinders, no model files): a bed on legs (up to its clearance, so the space for under-bed storage is visible) with frame, mattress, pillow, crimson throw and headboard; a desk with a drawer pedestal; a desk chair on a spoked base; a dresser with five drawers and knobs; a bookcase with shelves and books; a wardrobe with doors; a floor lamp with a glowing shade; a rug, mini fridge, futon and storage bin. Shapes are chosen by catalog `slug` (now part of `rules.itemDimensions`); anything without a shape (custom items, new catalog entries) stays a box.
- **Every shape stays inside its item's width × depth × height** and faces +z as its front (SPEC.md 4.4), so the placement rules, which only use the footprint, are unchanged. The catalog colour is each piece's main material, so editing it later (A7) still shows.
- **Each part has its own material and remembers its colour**, so the orange issue tint applies to every part of one item (`setIssueTint` walks the group) without touching others.
- **Name labels now show only on the selected item.** Names painted across realistic furniture looked odd; every item is still listed by name in the panel's "In this room" list, and the selection card names the selected one.

## 2026-11-24 (Suites, step U1a: rename)

- **The team decided to organise by suite instead of room type** (Grace, with Claire and Hannah's agreement): Harvard assigns first-years to suites, which may hold several bedrooms and a common room, and furniture should move between rooms. Approach chosen: one connected floor plan per suite (the whole suite in one 3D view, furniture dragged between rooms). Alternatives considered: rooms shown one at a time with a "Move to…" button (about half the work), or keeping room types until after the deadline. This revisits a SPEC.md section 1 "already made" decision and changes the section 4 contract, which SPEC.md says needs all three teammates; they agreed. SPEC.md is updated in U4.
- **U1a is a pure rename, done first and on its own** so the test suite could prove nothing else changed: tables `room_types` → `suite_types` and `rooms` → `suites`, columns `room_type_id` → `suite_type_id` and `assignments.room_id` → `suite_id`, matching Python names, templates and endpoints, admin `/admin/rooms` → `/admin/suites`, `/my-room` → `/my-suite`, and "room type" / "My room" → "suite type" / "My suite" in the interface. Public addresses `/types/<id>` and `/plan/<id>` stay the same so links keep working.

## 2026-11-24 (Suites, step U1b: format version 2)

- **CONTRACT: format version 2.** A suite is `{"version": 2, "units": "in", "ceiling", "rooms": [{"name", "kind", "outline", "features"}, ...]}`: 1–8 rooms (`kind` bedroom or common) in one shared plan, coordinates 0–1200 in (up from 600, so a whole suite fits), one ceiling for the suite. Each room's outline and features keep every version 1 rule. SPEC.md section 4 is updated with a dated note; `shared/geometry.js` only gained a header note (its helpers already work per outline, so callers loop over `geometry.rooms`). Alternatives: a ceiling per room (rarely differs within a suite), or keeping version 1 alongside (two formats to support everywhere).
- **Validation is two levels**: `validate_room(room, ceiling)` checks one room and returns plain messages (so the shared feature cases still match the builder's JavaScript word for word); `validate_suite(suite)` checks the suite, prefixes each room's messages with its name ("Bedroom A: Window 1 is wider than…"), and checks rooms don't overlap.
- **Rooms may share a wall or have a gap, but not overlap**: two outlines overlap if any walls properly cross, or a point just inside any wall of one lies strictly inside the other (which also catches a room drawn inside another). Touching along a wall or at a corner is allowed. Tested with a gap, a shared wall, a corner touch, an overlap and a nested room.
- **Rules work on the whole suite**: an item is fine anywhere inside any one room; zones come from every room; snapping flushes against any room's walls and keeps items in the suite's bounding box; a new item takes the first free 6 in grid spot in any room. An item in the gap between rooms is "Outside the room" for now; U2 adds "Crosses a wall".
- **Seed files moved to `seed/suites/`.** The single and double became one-room suites ("Bedroom"), and a new **"Two-bedroom suite (sample)"** has two 10 × 12 ft bedrooms opening onto a 15 × 24 ft common room with 5 in walls, invented and laid out so its default furniture has no issues (checked by the existing node test over all seed suites).
- **The facts page lists each room** (size, area, storage, windows) with the suite's total area, ceiling, capacity and bathroom; dorm cards show the size of a one-room suite or "2 bedrooms + common room".
- **The builder saves a one-room suite ("Main room", a bedroom) until U3**, and turns saving off with an explanation for suites it can't show yet (several rooms, or angled walls), so it can't overwrite them.

## 2026-11-24 (Suites, step U2: the planner for suites)

- **Walls between rooms are found automatically** (`roomMath.insideWalls`): a wall is "inside" if, along at least 80% of its length, it faces a wall of another room running the opposite way across a gap of at most 12 in. Nothing extra is stored in the suite format, so admins don't have to mark them. Tested on the sample suite (A's east and south walls, B's north and east, the common room's west), on rooms sharing a wall with no gap, and on rooms 13 in apart (not inside).
- **Inside walls stay 8 in high whatever the camera does**, so every room of a suite is visible at once; outside walls keep the dollhouse rule. Alternative: applying the dollhouse rule to inside walls too, but then the wall on the camera's side of one room hides the room behind it.
- **Each room draws half the gap's thickness**, so the two sides of a wall meet without overlapping (coplanar overlapping faces flicker in WebGL).
- **Doorways between rooms are cut out of both walls**: a door on one room's inside wall is projected onto the wall facing it, those stretches are left out (`cutIntervals`), and a wooden threshold strip covers the gap. Door panels, windows and closets on inside walls are hidden, since they'd float above an 8 in wall; the door's floor zone still shows.
- **"Crosses a wall" is a new issue**, ranked with "Outside the room": an item that isn't wholly inside one room and overlaps the strip an inside wall stands on (`insideWallBoxes`; a shared wall with no gap counts as 1 in thick) crosses a wall; anything else not inside a room is outside it. SPEC.md 4.5 rules 5 and 8 are updated with a dated note.
- **Room names lie on each room's floor** in suites with more than one room, placed at the floor's area centroid (which stays inside the bulk of an L-shaped room, unlike its bounding box's middle).
- **Known cosmetic issue:** where two rooms' outside walls are each lengthened across the gap at a corner, their top faces overlap for a few inches and can show a thin line.

## 2026-11-24 (Suites, step U3: the builder for suites)

- **One room editor with room tabs**, rather than every room's fields on the page at once: the tabs (plus "+ Add room") pick which room the editor shows, and clicking a room in the preview does the same. `main.js` keeps every room's typed values in a list and saves the editor into it before switching, so nothing typed is lost. Alternative: one long form with a section per room, which gets unwieldy at four or five rooms and repeats every field's id.
- **Rooms are stored as the text typed** (`state.newRoom`), and `parseRoom` turns that into numbers when the suite is built. This keeps half-typed values (like "12a") in their box when switching rooms, instead of silently blanking them.
- **A room's position is its north-west corner** in the suite (inches from the suite's west and north sides); the walked or rectangular shape is built from (0, 0) and moved there. Positions must be 0–1200 in.
- **"Place … east of / south of [room] with a [5] in wall"** fills in the position from the other room's bounding box (`state.positionNextTo`), and **"+ Add room"** places the new room east of the current one the same way, so admins rarely type positions. A new room is named "Common room" if there's none yet, then "Bedroom B", "Bedroom C"…
- **The ceiling moved out of the room editor** into the suite's details, since all rooms share it (format version 2).
- **`buildSuite` mirrors `validate_suite`** (names, kinds, positions, each room's shape and features, the ceiling), naming the room in each message when there are several rooms, except overlap between rooms, which only the server checks: the preview shows overlapping rooms plainly, and a rejected save keeps the suite.
- **`geometryToForm` reopens any suite of right-angled rooms** (each room's position is its outline's minimum corner); a node test round-trips the sample suite through the form and back to the identical JSON.
- **The preview draws the whole suite** (`drawSuite`): the selected room in full (features, corner arrows, wall labels), the others lighter with their names and clickable.
- **The sticky preview now sits below the sticky navbar** (and under it when they meet).

## 2026-11-24 (Suites, step U4: full-height walls, Rooms picker, SPEC, end to end)

Product choice from Grace:

- **Walls between rooms are full height again, and you turn the view to see different rooms** (U2's 8 in walls looked odd). Every wall, between rooms or outside, follows the dollhouse rule: it drops to a stub when the camera is on its outer side. Turning the view therefore opens up different rooms.

Technical choices:

- **A "Rooms" picker** in the planner panel (Whole suite, then each room, for suites with more than one room) points the camera at one room (`fitCamera` with that room's box) and lowers every other room's walls, so a room can be seen into from any side without hunting for the right angle. "Whole suite" goes back to the plain dollhouse rule.
- **Doorways between rooms are real openings**: the wall is cut out up to the door's height on both sides, a lintel (the strip of wall above the door) fills the rest up to the ceiling, and a threshold covers the gap. `insideWalls` now records each doorway's height. No door panel is drawn over the opening. Lintels are hidden when their wall drops to a stub.
- **Outside walls at a suite's corners now meet instead of overlapping**: at an outer corner next to a wall between rooms, an outside wall reaches only half way across the gap, and the next room's outside wall reaches the other half. This removes the flickering seam noted in U2.
- **Areas round halves up everywhere** (`sq_ft` filter): Python's built-in rounding sends 606.25 to 606.2 (to the even neighbour), while the builder's JavaScript shows 606.3; the facts and dorm pages now match the builder.
- **SPEC.md sections 1, 5, 6, 7, 8, 9 and 10 updated for suites**, each change marked with its date. The old milestone rows are left as the history of what was built.
- **End-to-end check in headless Chrome**: an admin adds suite B-21 of the two-bedroom type and assigns a registered student; the student's "My suite" opens that suite's planner; they move a desk from Bedroom A into the common room, save, log out, log in, and reopen the layout from My layouts with the desk where they left it.

## 2026-11-25 (P8: floor plan view and "Will it fit?")

- **Floor plan view keeps the perspective camera and looks straight down** (with a hair of tilt toward south, because OrbitControls can't tell which way is up when exactly overhead; this also puts north at the top). Turning is switched off in this view so it stays a plan; zoom and sliding still work. Every wall stands in floor plan view, since nothing can hide anything from directly above. Alternative: an orthographic camera (true plan, no perspective), which would mean a second camera and keeping the two in step.
- **The view change glides for half a second** by blending the camera's direction from the room's centre (smoothstep easing), keeping its distance; with "reduce motion" switched on in the system, it jumps instead (SPEC.md 8.7).
- **Zoom buttons** move the camera 20% closer or 25% further (so in-then-out returns to the start), within the scroll wheel's limits.
- **"Will it fit?" is checked in the browser by `rules.checkCustomItem`** with the server's limits (name 1–60 characters, width and depth 1–200 in, height 1–120 in), showing the first problem in words. The server checks again on save (`validate_placements`).
- **Custom items always show their name label**: they're plain grey boxes, so unlike shaped catalog furniture they don't show what they are.
- **Checked end to end**: a 36 × 36 × 28 in "Bean bag chair" added through the form, moved with the arrow keys, saved, and back after a reload.

## 2026-11-25 (S7 + P9: share links, shopping list, read-only view)

- **Share links are random tokens** (`secrets.token_urlsafe(16)`, about 128 bits), not layout ids, so nobody can guess someone else's link. Sharing again reuses the same token. "Stop sharing" sets it back to NULL, so the old link stops working for good. Sharing again later gives a new link.
- **Share POST and DELETE take no JSON body.** The layout id in the URL is all they need, and the server checks ownership as on every other layout route.
- **A share link to a draft (unpublished) suite gives 404**, the same as an unknown token, so drafts never show up outside the admin pages.
- **The shared view is the normal planner page with `mode="view"`**: the same scene, Rooms picker, 3D/floor-plan toggle and zoom, but no picking, dragging, catalog or saving. The panel lists the items and the shopping list. Alternative: a separate viewer page, which would have meant a second copy of the scene code.
- **The shopping list shows things to buy and custom items, grouped by name and size with a count.** Harvard furniture is left out because Harvard supplies it. It appears in two places: live in the planner panel (`rules.shoppingList`, tested under node) and on a printable page (`/layouts/<id>/shopping-list`, owner only, grouped in SQL).
- **Shopping-list ticks aren't saved**: they're a checklist for one shopping trip, and saving them would need a new table for little gain.
- **The SQL groups by column position** (`GROUP BY 1, 2, 3, 4, 5`) because `width`, `depth` and `height` exist in both `furniture` and `placements`, so naming them there is ambiguous.
- **Checked end to end**: a student saves a layout with two mini fridges and a custom floor cushion, shares it, and opens the link logged out. They see all 15 items read-only, and clicking selects nothing. After "Stop sharing" on My layouts, the old link shows "This share link doesn't work any more."

## 2026-11-26 (S8: demo users and export_rooms.py)

- **`export_rooms.py` writes exactly the JSON layout of the seed files**: `indent=2` for suites, one item per line for the catalog. Exporting a database freshly built from `seed/` gives back the same bytes (tested), so `git diff seed/` after an export shows only real changes. `seed/furniture.json` lost its column alignment once to get there; the data is unchanged.
- **Positions are written as whole numbers**: `x` and `y` are REAL columns, so SQLite returns 94.0, but positions are whole inches (SPEC.md 4.4).
- **Only published suite types are exported.** A draft is a suite still being measured, so it stays in the database. A seed file that matches no published suite type is listed in the terminal and never deleted, since deleting is the team's call.
- **An existing seed file is matched by the dorm and name inside it**, not by file name, so the Demo Hall files keep their names. A new suite gets `<dorm>-<name>.json`. Renaming a suite in the builder therefore writes a new file and lists the old one as stale. Alternative: store the file name in the database, which would mean a schema change.
- **The export also writes `seed/dorms.json` and `seed/furniture.json`.** Without them, a rebuild would lose dorm yards and descriptions (Dorms page) and catalog edits (A7). Custom items in a default layout are written with their label and size, since they have no slug. SPEC.md section 5 is updated with both.
- **Demo passwords are random (`secrets.token_urlsafe(8)`) and change on every rebuild**, printed once in the terminal. A fixed password written in the repository would be a known login on any deployed copy. The demo suites D-101 and D-201 are invented numbers in the invented Demo Hall.
- **`init_db.py` uses `argparse`** (standard library) for `--demo-users`, which also gives it `--help`.

## 2026-11-26 (A7 furniture catalog editor, A9 export button)

- **A furniture item's slug can't be changed after it's created**: the planner picks the 3D shape by slug (`shapes.js`), and seed files refer to items by slug. A new item with a slug the planner doesn't know is drawn as a box in its colour. Alternative: let slugs change and update every seed file, which isn't worth it.
- **Deleting an item is refused while any layout uses it** (saved or default), with the count shown. Deleting would break those layouts, and the foreign key would refuse it anyway. Changing the item is the way to "replace" it.
- **Size limits match the database CHECKs** (width and depth 1–200 in, height 1–120 in). Clearance must be less than the height. Colours are stored in lowercase so the export stays stable.
- **Resizing an item doesn't move anyone's furniture**: layouts keep their positions, and the planner's rules flag anything that now overlaps or no longer fits.
- **The Export button runs the same `export_seed` as `python export_rooms.py`** and writes into the `seed/` folder of the code the server runs from. It's meant for a team member's own computer, and the files still need committing. On a server where that folder can't be written, the page says so (status 500) instead of crashing. `app.config["SEED_DIR"]` lets the tests export into a temporary copy.
- **The delete confirmation uses `tojson`** to put the item's name into the inline `confirm(...)`, so an apostrophe in a name can't break the JavaScript.
