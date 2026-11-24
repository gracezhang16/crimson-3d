# Crimson3D: Build Specification

This is the full specification for Crimson3D, a CS50 final project by Grace Zhang, Hannah Wang and Claire Yu (Harvard College, Fall 2026). `CLAUDE.md` holds the short working rules; this file holds everything else. When the two disagree, ask.

---

## 1. What we are building

Crimson3D is a website where an incoming Harvard first-year opens a to-scale 3D model of their dorm room, drags furniture around it, and saves the layout before they buy anything.

It has three parts that share one data format (section 4):

1. **Room library.** Measured first-year room types stored in SQLite, browsable by dorm, each with a facts page.
2. **3D planner.** Any room type opens in the browser as a 3D scene drawn with three.js. Students drag, rotate, add and remove furniture, and logged-in students save layouts.
3. **Admin builder.** An admin creates a room type in 2D from its dimensions, places doors and windows on its walls, publishes it, sets its default furniture, and assigns students to specific rooms.

### Users

| Role | Can do |
| --- | --- |
| Visitor (not logged in) | Browse dorms and room types, open any published room in the planner, move furniture. Nothing is saved. |
| Student (logged in) | Everything a visitor can, plus save named layouts, reopen them, share a read-only link, and see "My room" if an admin assigned one. |
| Admin | Everything a student can, plus create, edit and publish room types, set default furniture, edit the furniture catalog, create rooms and assign students. |

### Key product decisions (already made; do not revisit without asking)

- **Room types, not individual rooms, are the unit we measure and model.** A specific room (for example "Canaday B-21") is a thin record that points at a type. Harvard assigns first-years to suites, not bedrooms, so a type is what a student can actually know in advance.
- **3D geometric model, not panoramas.** Only a measured model supports drag-and-drop and "will it fit". A 360° photo per room is a stretch goal only.
- **Furniture turns in 90° steps only.** This keeps all collision maths to axis-aligned rectangles.
- **All lengths are whole inches.** That is what a tape measure gives us.
- **Unofficial project.** Every page footer says: "Crimson3D is an unofficial student project and is not affiliated with Harvard University." Do not use Harvard's shield or logo.

---

## 2. Constraints

### CS50 constraints

- Deadlines (11:59 PM ET): status report **Tue Nov 24, 2026**; implementation **Sun Dec 6, 2026**. Showcase Dec 7 and Dec 9. No late work is accepted.
- Graded on correctness, design and style. Clear structure, comments and consistent naming matter as much as features.
- AI tools are allowed on the final project, but **the essence of the work must be ours**. Claude Code's job is to help three students build and understand their project, not to build it for them. See the working rules in `CLAUDE.md`.
- Submission needs: all source, the SQLite database, `README.md` (user manual), `DESIGN.md` (technical decisions), and a video of 3 minutes or less. **The team writes README.md and DESIGN.md.** Claude Code may keep notes in `docs/decisions.md` to help us write them.
- It must run in the CS50 Codespace (VS Code in the browser, Python 3, `pip`, `sqlite3`, `node` available) and on a teammate's laptop.

### Technical constraints

- **No build step.** No npm bundler, no TypeScript, no React or Vue. Plain ES modules loaded by the browser.
- **No ORM.** SQL is written by hand with the `cs50` library's `SQL` class and `?` placeholders, as taught in CS50.
- **three.js is vendored**, not loaded from a CDN, so the project runs offline at the showcase and for graders.
- Bootstrap 5 for page styling, also vendored (CSS and bundle JS) for the same reason.
- Ask before adding any dependency not listed in section 3.

---

## 3. Stack

| Layer | Choice | Notes |
| --- | --- | --- |
| Server | Python 3 + Flask | Routes split into three blueprints so three people can work without merge conflicts |
| Sessions | Flask-Session (filesystem) | Same as CS50 Finance |
| Passwords | `werkzeug.security` `generate_password_hash` / `check_password_hash` | Same as CS50 Finance |
| Database | SQLite via `cs50.SQL` | One file, `crimson3d.db` |
| Templates | Jinja2, Bootstrap 5.3 (vendored) | One base template `layout.html` |
| 3D | three.js **0.170.0** (vendored ES modules) + `OrbitControls` add-on | Loaded with an import map |
| 2D builder preview | SVG drawn by plain JavaScript | |
| Tests | `pytest` (Python), `node --test` (pure JS functions) | Small, focused tests on the contract and the rules |

`requirements.txt`:

```
cs50
Flask
Flask-Session
pytest
```

### Vendoring three.js and Bootstrap (milestone M0)

```bash
mkdir -p static/vendor/three static/vendor/bootstrap
curl -L https://unpkg.com/three@0.170.0/build/three.module.js -o static/vendor/three/three.module.js
curl -L https://unpkg.com/three@0.170.0/examples/jsm/controls/OrbitControls.js -o static/vendor/three/OrbitControls.js
curl -L https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css -o static/vendor/bootstrap/bootstrap.min.css
curl -L https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js -o static/vendor/bootstrap/bootstrap.bundle.min.js
```

Open each downloaded three.js file and check its `import` lines. `OrbitControls.js` imports from `'three'`, which the import map resolves. If `three.module.js` imports another file (such as `./three.core.js`), download that file too into the same folder. Add `static/vendor/three/LICENSE` (MIT) from the same package.

Import map, placed in `layout.html` before any module script:

```html
<script type="importmap">
  { "imports": {
      "three": "/static/vendor/three/three.module.js",
      "three/addons/": "/static/vendor/three/"
  } }
</script>
```

---

## 4. The suite format (the contract)

Everything depends on this format: the builder writes it, the server validates and stores it, the planner draws it. **Changing it requires all three teammates to agree.** The files that implement it, `geometry.py` and `static/js/shared/geometry.js`, are shared and must stay in step.

> **Changed 2026-11-24 (version 2, agreed by all three):** the unit is now a **suite**: one or more rooms (bedrooms and an optional common room) laid out in one shared floor plan, so furniture can move between rooms. Each room's outline and features follow the same rules as the old single-room format. Sections 1, 5 and 7 are updated to match in milestone U4; see `docs/decisions.md`.

### 4.1 Coordinates

- **Plan view, inches.** `x` increases to the right (east), `y` increases downward (south), the same as SVG. All rooms of a suite share one plan; coordinates run from 0 to 1200.
- **3D mapping.** three.js `x` = plan `x`; three.js `z` = plan `y`; three.js `y` is up. 1 three.js unit = 1 inch. The floor is at `y = 0`.
- **Outline.** Each room's `outline` lists its floor's corners in order, **clockwise as seen on screen in plan view**. A rectangle has 4 corners; an L-shaped room has 6. Rooms may share a wall or have a gap (the wall's thickness) between them, but may not overlap.
- **Walls.** Wall `i` runs from `outline[i]` to `outline[(i + 1) % n]`. So in a rectangle drawn from the top-left corner, wall 0 is the top (north) wall, wall 1 the right, wall 2 the bottom, wall 3 the left.
- **Interior side.** Compute each wall's inward normal from the polygon's signed area; never assume it from the order. Write this once in `geometry.js` / `geometry.py` and test it.
- **Why clockwise.** With `y` pointing down and corners listed clockwise, a wall's start corner is always the one **on your left as you stand inside the room facing that wall**. So `offset` is exactly what a person with a tape measure records: "from the left corner to the edge of the window". Test this property for a rectangle and an L-shape.

### 4.2 Schema

```json
{
  "version": 2,
  "units": "in",
  "ceiling": 102,
  "rooms": [
    {
      "name": "Bedroom A",
      "kind": "bedroom",
      "outline": [[0, 0], [114, 0], [114, 150], [0, 150]],
      "features": [
        {"kind": "door",     "wall": 1, "offset": 100, "width": 34, "height": 80},
        {"kind": "window",   "wall": 0, "offset": 36,  "width": 42, "height": 54, "sill": 30},
        {"kind": "closet",   "wall": 3, "offset": 0,   "width": 60, "height": 84},
        {"kind": "radiator", "wall": 0, "offset": 42,  "width": 30, "height": 24, "depth": 6},
        {"kind": "outlet",   "wall": 2, "offset": 20}
      ]
    },
    {
      "name": "Common room",
      "kind": "common",
      "outline": [[119, 0], [299, 0], [299, 150], [119, 150]],
      "features": []
    }
  ]
}
```

The numbers above are invented examples.

| Field | Type | Rule |
| --- | --- | --- |
| `version` | int | Always `2` (version 1 was a single room) |
| `units` | string | Always `"in"` |
| `ceiling` | int | 72 to 240, shared by every room |
| `rooms` | array | 1 to 8 rooms; rooms must not overlap (they may share a wall) |
| `room.name` | string | 1 to 40 characters, e.g. "Bedroom A" |
| `room.kind` | string | `bedroom` or `common` |
| `room.outline` | array of `[x, y]` int pairs | 3 to 12 corners; each coordinate 0 to 1200; non-zero area; no two consecutive corners equal; edges must not cross each other |
| `room.features` | array | 0 to 40 items per room |
| `feature.kind` | string | One of `door`, `window`, `closet`, `radiator`, `outlet` |
| `feature.wall` | int | 0 to `n - 1`, a wall of its own room |
| `feature.offset` | int | Distance along the wall from its **start corner** to the feature's **nearer edge**; `offset >= 0` |
| `feature.width` | int | Required except for `outlet`; `offset + width <= wall length` |
| `feature.height` | int | Required for `door`, `window`, `closet`; for `window`, `sill + height <= ceiling`; otherwise `height <= ceiling` |
| `feature.sill` | int | Required for `window`; height of the sill above the floor |
| `feature.depth` | int | Optional for `radiator` (default 6) |

### 4.3 What each feature means to the planner

| Kind | Drawn as | Effect on furniture |
| --- | --- | --- |
| `door` | Brown panel with frame on the wall | Creates a **door zone**: a `width × width` square on the floor, inside the room, against the door. Furniture in it gets the issue "Blocks the door". Draw the zone as a faint tint. |
| `window` | Glass panel with frame and sill | None in the Good tier |
| `closet` | Pair of panels on the wall (recessed closet) | Creates a zone `width × 24` in front of it: "Blocks the closet" |
| `radiator` | Grey box against the wall | Floor obstacle `width × depth`: "Hits the radiator" |
| `outlet` | Small plate at 12 in height | None; shown so students can plan lamps and chargers |

### 4.4 Placements (one item in a layout)

```json
{"furniture_id": 3, "x": 37, "y": 33, "rotation": 0}
{"furniture_id": null, "label": "Bean bag chair", "width": 36, "depth": 36, "height": 28, "x": 60, "y": 80, "rotation": 90}
```

- `x`, `y`: centre of the item's footprint in plan coordinates (inches; may be non-integer while dragging, rounded to whole inches on save).
- `rotation`: 0, 90, 180 or 270 degrees, clockwise in plan view. At 0, the item's `width` runs along `x` and its `depth` along `y`, and its front faces `+y`.
- A catalog item has `furniture_id` and takes its size from the catalog. A custom "will it fit" item has `furniture_id: null` plus `label`, `width`, `depth`, `height` (each 1 to 200, height 1 to 120).

### 4.5 Placement rules (pure functions in `static/js/planner/rules.js`)

All rules work on axis-aligned footprint rectangles, because rotation is in 90° steps.

1. **Footprint.** At rotation 0 or 180 the half-extents are `(width/2, depth/2)`; at 90 or 270 they swap.
2. **Overlap.** Two rectangles overlap when they overlap on both axes by more than 0.01 in. Touching edges is fine.
3. **Flat items** (height ≤ 1, such as rugs) never collide with anything.
4. **Under-bed clearance.** A catalog item may have `clearance` (the bed has one). An item whose height is ≤ that clearance may overlap it (storage bins slide under the bed).
5. **Inside the room.** All four footprint corners are inside one room's outline (point-in-polygon; on the boundary counts as inside), **and** no edge of that outline passes through the footprint's interior. The second check catches notched rooms. In a suite, an item may be in any room, but must be wholly inside one. *(Updated 2026-11-24 for suites.)*
6. **Zones.** Overlap with a door, closet or radiator zone produces that zone's issue.
7. **Snap.** On drag, round the centre to whole inches. If a footprint edge is within 3 in of a wall that is parallel to it, move it flush. While dragging, keep the item inside the room's bounding box.
8. **Issues.** Each item gets at most one issue, in this priority: "Too big for this room", "Crosses a wall" (straddles the wall between two rooms of a suite) or "Outside the room", "Blocks the door", "Blocks the closet", "Hits the radiator", "Overlaps the {other item name}". Items with an issue are tinted orange; a status pill shows "Everything fits" or "N items don't fit". *(Updated 2026-11-24: "Crosses a wall" added for suites.)*

These are the only collision rules. Do not add physics, gravity or stacking.

---

## 5. Database

`schema.sql`:

```sql
PRAGMA foreign_keys = ON;

CREATE TABLE users (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    email    TEXT NOT NULL UNIQUE,
    hash     TEXT NOT NULL,
    role     TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'admin')),
    created  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE dorms (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL UNIQUE,
    yard        TEXT,
    description TEXT
);

CREATE TABLE room_types (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    dorm_id      INTEGER NOT NULL REFERENCES dorms(id),
    name         TEXT NOT NULL,                      -- e.g. "Single, 4th floor"
    capacity     INTEGER NOT NULL DEFAULT 1 CHECK (capacity BETWEEN 1 AND 6),
    bathroom     TEXT CHECK (bathroom IN ('en-suite', 'hallway', 'shared-suite')),
    geometry     TEXT NOT NULL,                      -- the room format (section 4) as JSON text
    status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
    measured_by  TEXT,
    measured_on  DATE,
    notes        TEXT,
    created_by   INTEGER REFERENCES users(id),
    updated      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (dorm_id, name)
);

CREATE TABLE rooms (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    dorm_id       INTEGER NOT NULL REFERENCES dorms(id),
    number        TEXT NOT NULL,                     -- e.g. "B-21"
    room_type_id  INTEGER NOT NULL REFERENCES room_types(id),
    UNIQUE (dorm_id, number)
);

CREATE TABLE assignments (
    user_id  INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    room_id  INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE
);

CREATE TABLE furniture (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    slug       TEXT NOT NULL UNIQUE,                 -- e.g. "bed-twin-xl"
    name       TEXT NOT NULL,
    category   TEXT NOT NULL CHECK (category IN ('harvard', 'purchase')),
    width      INTEGER NOT NULL CHECK (width  BETWEEN 1 AND 200),
    depth      INTEGER NOT NULL CHECK (depth  BETWEEN 1 AND 200),
    height     INTEGER NOT NULL CHECK (height BETWEEN 1 AND 120),
    clearance  INTEGER NOT NULL DEFAULT 0,           -- free height underneath (bed)
    color      TEXT NOT NULL DEFAULT '#b8875a',
    note       TEXT
);

CREATE TABLE layouts (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER REFERENCES users(id) ON DELETE CASCADE,   -- NULL for a room type's default layout
    room_type_id  INTEGER NOT NULL REFERENCES room_types(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    is_default    INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
    share_token   TEXT UNIQUE,
    updated       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE placements (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    layout_id     INTEGER NOT NULL REFERENCES layouts(id) ON DELETE CASCADE,
    furniture_id  INTEGER REFERENCES furniture(id),  -- NULL for a custom item
    label         TEXT,
    width         INTEGER,
    depth         INTEGER,
    height        INTEGER,
    x             REAL NOT NULL,
    y             REAL NOT NULL,
    rotation      INTEGER NOT NULL DEFAULT 0 CHECK (rotation IN (0, 90, 180, 270))
);

CREATE INDEX layouts_by_user ON layouts (user_id, room_type_id);
CREATE INDEX placements_by_layout ON placements (layout_id);
```

Design notes (for DESIGN.md):

- `geometry` is stored as one JSON text column because a room's shape is always read and written whole, never queried corner by corner.
- Placements are rows, not JSON, because the shopping list and catalog edits need to query them.
- A room type's default layout is a `layouts` row with `user_id IS NULL AND is_default = 1`. There is at most one per room type; enforce it in code.
- Saving a layout replaces all of its placements inside a transaction (`BEGIN` / `DELETE` / `INSERT`s / `COMMIT`).
- Make sure foreign keys are on for every connection. If `cs50.SQL` does not enable them, run `db.execute("PRAGMA foreign_keys = ON")` once after connecting, and check with a test.

### Seed data

`init_db.py` creates a fresh `crimson3d.db` from `schema.sql`, then loads:

- `seed/furniture.json`: the catalog below.
- `seed/rooms/*.json`: one file per room type, each `{dorm, name, capacity, bathroom, geometry, measured_by, measured_on, notes, status, default_layout: [placements by furniture slug]}`.
- With `--demo-users`: three invented student accounts and their passwords, printed to the terminal, for the showcase. Never real names or real room assignments.

Ship two invented sample rooms in a dorm called **"Demo Hall"** so the site works before real measurements exist: a single (114 × 150 in, ceiling 102) and a double (144 × 192 in, ceiling 102). Mark them `measured_by: "Sample data, not a real room"`. Real rooms are added through the admin builder and exported to `seed/rooms/` (see A9).

Furniture catalog seed. **Harvard dimensions are placeholders until we measure the real pieces**; mark each with `note: "Placeholder size: replace with measured"`.

| slug | name | category | w × d × h | clearance |
| --- | --- | --- | --- | --- |
| bed-twin-xl | Bed, twin XL | harvard | 40 × 84 × 36 | 14 |
| desk | Desk | harvard | 42 × 24 × 30 | 0 |
| desk-chair | Desk chair | harvard | 18 × 18 × 33 | 0 |
| dresser | Dresser, 5 drawers | harvard | 30 × 20 × 44 | 0 |
| bookcase | Bookcase | harvard | 30 × 12 × 48 | 0 |
| wardrobe | Wardrobe | harvard | 36 × 24 × 72 | 0 |
| floor-lamp | Floor lamp | harvard | 12 × 12 × 62 | 0 |
| rug-5x8 | Rug, 5 × 8 ft | purchase | 60 × 96 × 1 | 0 |
| mini-fridge | Mini fridge | purchase | 19 × 20 × 33 | 0 |
| futon | Futon | purchase | 72 × 34 × 32 | 0 |
| storage-bin | Storage bin | purchase | 24 × 16 × 13 | 0 |

Harvard's published list for every room is an extra-long twin bed (80 in mattress), desk and chair, five-drawer dresser, bookcase, floor lamp, and a wardrobe where there is no closet.

---

## 6. Project layout

```
crimson3d/
├── app.py                  # creates the Flask app, config, registers blueprints
├── helpers.py              # db handle, login_required, admin_required, apology, current_user
├── geometry.py             # CONTRACT: validate_room(), validate_placements(), wall helpers
├── pages.py                # blueprint "pages": public and student HTML pages      (Grace)
├── api.py                  # blueprint "api": JSON for the planner and layouts      (Grace)
├── admin.py                # blueprint "admin": admin pages and admin JSON          (Hannah)
├── schema.sql
├── init_db.py              # build crimson3d.db from schema.sql + seed/
├── create_admin.py         # python create_admin.py you@example.com
├── export_rooms.py         # write published room types back to seed/rooms/*.json
├── requirements.txt
├── seed/
│   ├── furniture.json
│   └── rooms/demo-hall-single.json, demo-hall-double.json, ...
├── templates/
│   ├── layout.html         # base: navbar, import map, flash messages, footer disclaimer
│   ├── apology.html
│   ├── index.html          # dorm list + search
│   ├── dorm.html           # one dorm's room types
│   ├── room_type.html      # facts card + "Open in 3D"
│   ├── plan.html           # the planner page                                     (Claire)
│   ├── share.html          # read-only planner
│   ├── my_layouts.html
│   ├── shopping_list.html
│   ├── login.html, register.html
│   └── admin/
│       ├── index.html
│       ├── room_types.html, room_type_form.html, default_layout.html
│       ├── rooms.html
│       └── furniture.html
├── static/
│   ├── css/style.css
│   ├── css/planner.css                                                            (Claire)
│   ├── vendor/three/..., vendor/bootstrap/...
│   └── js/
│       ├── shared/geometry.js   # CONTRACT: walls, inward normals, feature positions
│       ├── shared/api.js        # fetch wrappers with error handling
│       ├── planner/                                                               (Claire)
│       │   ├── main.js          # reads data-* attributes, loads data, wires modules together
│       │   ├── scene.js         # renderer, camera, lights, OrbitControls, resize, render loop
│       │   ├── room.js          # geometry → floor, walls, features, door zones
│       │   ├── furniture.js     # catalog item / custom item → three.js Group with label
│       │   ├── interaction.js   # pick, select, drag on floor, rotate, delete, keyboard
│       │   ├── rules.js         # PURE: footprint, overlap, inside, zones, snap, issues
│       │   └── panel.js         # side panel: catalog, will-it-fit form, selection card, status
│       └── builder/                                                               (Hannah)
│           ├── main.js          # form state ↔ geometry object
│           ├── preview.js       # draws geometry as SVG, labels walls A, B, C...
│           └── outline.js       # Better tier: click-to-draw outlines
├── tests/
│   ├── conftest.py          # temp database per test
│   ├── test_geometry.py
│   ├── test_routes.py
│   ├── geometry.test.mjs
│   └── rules.test.mjs
└── docs/
    ├── decisions.md         # running log of decisions, for writing DESIGN.md
    └── demo-reference.html  # standalone prototype, for look and behaviour only (section 8.8)
```

`.gitignore`: `flask_session/`, `__pycache__/`, `.pytest_cache/`, `*.db` during development. **At submission, generate `crimson3d.db` with real data and include it in the ZIP** (CS50 asks for the database).

`helpers.py` reads the database path from the environment so tests can use a temporary file:

```python
db = SQL(os.environ.get("CRIMSON3D_DB", "sqlite:///crimson3d.db"))
```

---

## 7. Routes

### 7.1 HTML pages (`pages.py`, Grace)

| Method | Route | Access | Page |
| --- | --- | --- | --- |
| GET | `/` | anyone | Dorm list with a search box (filters dorms and room types by name) |
| GET | `/dorms/<int:dorm_id>` | anyone | Dorm name, description, its published room types as cards |
| GET | `/types/<int:type_id>` | anyone | Facts card: dimensions in ft and in, area in sq ft, ceiling, bathroom, closet or wardrobe, window count, who measured it and when, accuracy note; button "Open in 3D" |
| GET | `/plan/<int:type_id>` | anyone | Planner, starting from the default layout. `?layout=<id>` opens a saved layout (owner only) |
| GET | `/my-room` | student | Redirects to the planner for the assigned room's type; if none, a page saying no room is assigned |
| GET | `/layouts` | student | The student's saved layouts with Open, Rename, Delete, Share |
| GET | `/layouts/<int:layout_id>/shopping-list` | owner | Non-Harvard items in the layout with dimensions and checkboxes |
| GET | `/share/<token>` | anyone with link | Read-only planner (camera moves, furniture does not) |
| GET, POST | `/register`, `/login` | anyone | As in CS50 Finance; email + password + confirmation |
| GET | `/logout` | anyone | Clears session |

Draft room types return 404 to everyone except admins.

The accuracy note on every facts page: "Measured by {measured_by} on {measured_on}. Rooms of the same type can differ by a few inches; measure big purchases against your own room."

### 7.2 JSON API (`api.py`, Grace)

All responses are JSON. Errors are `{"error": "message for a person"}` with status 400 (bad input), 401 (not logged in), 403 (not yours), or 404. Every write endpoint requires `Content-Type: application/json` and a logged-in session.

| Method | Route | Access | Request → Response |
| --- | --- | --- | --- |
| GET | `/api/types/<id>` | anyone (published) / admin (draft) | → `{id, name, dorm: {id, name}, capacity, geometry, default_layout: {placements: [...]}}` |
| GET | `/api/furniture` | anyone | → `[{id, slug, name, category, width, depth, height, clearance, color, note}]` |
| GET | `/api/layouts?type_id=<id>` | student | → `[{id, name, updated}]` for that student and room type |
| POST | `/api/layouts` | student | `{type_id, name, placements}` → `201 {id}` |
| GET | `/api/layouts/<id>` | owner | → `{id, name, type_id, placements, share_url}` |
| PUT | `/api/layouts/<id>` | owner | `{name?, placements?}` → `{ok: true, updated}` |
| DELETE | `/api/layouts/<id>` | owner | → `{ok: true}` |
| POST | `/api/layouts/<id>/share` | owner | → `{share_url}`; creates the token if missing (`secrets.token_urlsafe(16)`) |
| DELETE | `/api/layouts/<id>/share` | owner | → `{ok: true}`; removes the token, old link stops working |
| GET | `/api/share/<token>` | anyone | → `{name, type_id, geometry, placements}` |

Limits: a student may have at most 20 layouts per room type; a layout at most 100 placements; layout names 1 to 60 characters.

Server-side validation of placements (`geometry.validate_placements`) checks types, ranges, rotation values, that `furniture_id` exists, and that the centre lies within the room's bounding box. It does **not** check collisions; those are advice shown to the student, not errors.

### 7.3 Admin (`admin.py`, Hannah)

Every route uses `@admin_required`.

| Method | Route | What it does |
| --- | --- | --- |
| GET | `/admin` | Admin home: counts, links |
| GET | `/admin/types` | All room types with status, dorm, last updated |
| GET, POST | `/admin/types/new` | Builder form (empty) |
| GET, POST | `/admin/types/<id>/edit` | Builder form (filled) |
| POST | `/admin/types/<id>/publish` | Sets status to published (only if geometry validates) |
| POST | `/admin/types/<id>/unpublish` | Back to draft |
| GET | `/admin/types/<id>/default-layout` | Planner in admin mode |
| PUT | `/admin/api/types/<id>/default-layout` | `{placements}` → saves the default layout |
| GET, POST | `/admin/dorms` | List and add dorms |
| GET, POST | `/admin/rooms` | List rooms; add a room (dorm, number, room type) |
| POST | `/admin/rooms/<id>/assign` | Form field `email`; creates the account link in `assignments` (the student must already have registered) |
| POST | `/admin/rooms/<id>/unassign` | Removes the assignment |
| GET, POST | `/admin/furniture` | Edit catalog sizes, names, colours |

The builder form posts the geometry as a hidden JSON field built by `builder/main.js`, plus the ordinary fields (dorm, name, capacity, bathroom, measured_by, measured_on, notes). The server parses it and runs `geometry.validate_room()`. On error, re-render the form with the submitted values and a list of human-readable errors such as "Window 2 is wider than wall C (42 in on a 36 in wall)".

### 7.4 Auth helpers (`helpers.py`)

- `login_required` and `apology` as in CS50 Finance.
- `admin_required`: logged in and `role = 'admin'`, else 403 apology.
- `current_user()`: the users row for `session["user_id"]`, or `None`.
- Admins are created only by `create_admin.py`, never through the website.
- `app.config`: `SESSION_PERMANENT = False`, `SESSION_TYPE = "filesystem"`, `SESSION_COOKIE_SAMESITE = "Lax"`, and a random `SECRET_KEY` read from the environment with a development fallback.

---

## 8. The 3D planner (Claire)

### 8.1 Page contract

`templates/plan.html` renders a container and passes data through attributes only, no inline data:

```html
<div id="planner"
     data-type-id="7"
     data-layout-id=""              {# empty for the default layout #}
     data-mode="edit"               {# edit | view | admin-default #}
     data-logged-in="true">
  <canvas id="scene"></canvas>
  ...side panel...
</div>
<script type="module" src="/static/js/planner/main.js"></script>
```

- `edit`: full planner. Save buttons appear only when logged in; when logged out, show "Log in to save this layout".
- `view`: share page. Camera controls work; furniture cannot be selected or moved; side panel shows the item list and shopping list only.
- `admin-default`: like `edit`, but Save writes to the default-layout endpoint.

### 8.2 Scene

- `WebGLRenderer` with antialiasing, sized to the canvas container, device pixel ratio capped at 2, re-sized with a `ResizeObserver`.
- `PerspectiveCamera`, field of view 35°. Fit the camera distance to the room's size on load and when the room changes.
- `OrbitControls` around the room's centre. Limit the polar angle so the camera never goes below the floor; enable damping; disable panning beyond the room.
- Lighting: one `HemisphereLight` plus one `DirectionalLight` from above. No shadows in the Good tier.
- Render on demand (only when something changed or controls are moving), not a constant 60 fps loop.

### 8.3 Room

- Floor: a `ShapeGeometry` traced from `outline`, rotated flat, with a light grid texture every 12 in.
- Walls: one thin box per wall, `ceiling` tall, 5 in thick, set on the outside of the outline.
- **Dollhouse view:** each frame, a wall whose inward normal points toward the camera (so it would hide the room) is drawn as a 4 in stub instead of full height. Compute this from the normal and the camera position; do not rely on back-face culling.
- Features: coloured panels slightly in front of the wall at `offset` along it (section 4.3). No holes are cut in walls.
- Wall-length labels: HTML labels positioned by projecting the top-centre of the two visible far walls each frame, showing feet and inches (`9′ 6″`).

### 8.4 Furniture

- Each item is a `THREE.Group` whose origin is the footprint centre at floor level.
- Good tier: a box at true size in the catalog colour, with a darker top edge, and the name drawn on a small canvas texture on top.
- Better tier (optional): simple composite shapes (bed frame + mattress + pillow; desk top + legs) built from boxes. No external 3D model files.
- Selected item: a crimson outline rectangle on the floor around its footprint. Item with an issue: orange tint.

### 8.5 Interaction

- **Pick:** `Raycaster` against item groups on pointer down.
- **Drag:** on pointer down over an item, disable `OrbitControls`, record the offset between the hit point and the item centre, and on pointer move intersect the pointer ray with the horizontal plane at the hit height. Move the item to that point minus the offset, then apply `rules.snap`. Re-enable controls on pointer up.
- **Rotate:** button and the R key, 90° clockwise.
- **Delete:** button and Delete/Backspace.
- **Keyboard move:** arrow keys move the selected item 1 in, Shift + arrow 6 in.
- **Escape** clears the selection. Clicking empty floor without dragging clears it too.
- Touch works through pointer events; set `touch-action: none` on the canvas.
- After every change, run `rules.evaluate(room, items, catalog)` and update tints, the status pill, the selection card and the shopping list.
- Unsaved changes: show "Unsaved changes" next to Save; warn on leaving the page with `beforeunload`.

### 8.6 Side panel

Sections, top to bottom: room facts; Harvard furniture (add buttons); things to buy (add buttons); "Will it fit?" form (name, width, depth, height in inches, validated in the browser with a clear error message); layout controls (name, Save, Save as new, Share, list of saved layouts); shopping list.

New items appear at the first free spot found by scanning the room on a 6 in grid; if none, at the centre.

### 8.7 Views

- "3D" and "Floor plan" toggle. Floor plan animates the camera to straight overhead (respect `prefers-reduced-motion` by jumping instead).
- Zoom buttons for people without a scroll wheel.

### 8.8 If WebGL is unavailable

Show a message in place of the canvas: "This browser can't show the 3D view. Try a current version of Chrome, Safari, Firefox or Edge."

A visual reference for the intended look and behaviour is `docs/demo-reference.html` (a standalone prototype written with raw WebGL, not three.js). Use it for the UX, the rules and the panel layout. **Do not copy its rendering code**; the real planner uses three.js as specified above.

---

## 9. The admin builder (Hannah)

### 9.1 Good tier: rectangular rooms

1. Fields: dorm (select), name, capacity, bathroom, width, length, ceiling (all inches), measured by, measured on, notes.
2. Live SVG preview, redrawn on every input: room drawn to scale to fit the preview box, walls labelled **A, B, C, D** clockwise from the top (A = wall 0), each with its length in feet and inches, and a 1 ft grid.
3. Features table: add, edit, remove rows with kind, wall (A–D), distance from the wall's left corner as seen from inside the room, width, height, sill (windows). Each feature draws on the preview immediately; a row with an invalid value turns red with the reason.
4. The page builds the room-format object (section 4.2) from the form and puts it in a hidden field on submit. Because outlines are clockwise, "distance from the left corner as seen from inside" is the contract's `offset` with no conversion (section 4.1). The preview should make this obvious by marking each wall's left corner.
5. Buttons: Save draft, Preview in 3D (opens `/plan/<id>` for a draft, admins only), Publish.

### 9.2 Better tier: any shape

- A mode where the admin clicks on a snapping grid (6 in) to place corners, closes the shape by clicking the first corner, then clicks any wall to type its exact length. Lengths propagate around the polygon. Enforce clockwise order (reverse if the admin drew counter-clockwise).
- Reject self-crossing outlines with a clear message.

### 9.3 Other admin pages

- Default layout: the planner in `admin-default` mode.
- Rooms: table of rooms with dorm, number, type, assigned student email; form to add a room; assign by email; unassign.
- Furniture: editable table of the catalog.

---

## 10. Milestones

Each milestone ends with something you can see working. Do them in order within each track. **The Good tier (marked G) must be finished before any Better (B) work starts.** Feature freeze is **Thursday Dec 3**; Dec 3 to 6 is for testing, fixing, documentation and the video.

### M0: Shared foundation (all three, together, first)

- Repository, `.gitignore`, `requirements.txt`, vendored three.js and Bootstrap.
- `app.py` with the three blueprints registered; `layout.html` with navbar, import map, flash messages, footer disclaimer.
- `schema.sql`, `init_db.py` loading the two Demo Hall rooms and the catalog.
- `geometry.py` and `shared/geometry.js` with: walls from outline, wall lengths, inward normals, feature position along a wall, and `validate_room()` in Python. Tests for each.
- **Done when:** `python init_db.py && flask run` shows the home page listing Demo Hall; `pytest` and `node --test tests/*.test.mjs` pass.

### Planner track

| # | Tier | Milestone | Done when |
| --- | --- | --- | --- |
| P1 | G | Scene: renderer, camera, lights, orbit controls, a test box | A box can be orbited and zoomed on `/plan/1` |
| P2 | G | Room from `seed/rooms/demo-hall-single.json` (static fetch): floor, walls, dollhouse stubs, wall labels | The single shows at true proportions; near walls drop to stubs as you orbit |
| P3 | G | Features on walls; door zone tint | Door, window, radiator, outlet appear at the right positions |
| P4 | G | Load room and default layout from `/api/types/<id>`; furniture boxes with labels | Both Demo Hall rooms load from the database with furniture |
| P5 | G | Select, drag on floor, rotate, delete, keyboard, add from catalog | Every item can be moved anywhere in the room and stays on the floor |
| P6 | G | Save, save as new, load, rename via the API; unsaved-changes warning | Reload the page and the saved layout comes back |
| P7 | B | `rules.js` complete with tests; tints, status pill, snap to walls | Overlaps, blocked door and outside-the-room are flagged correctly in tests and on screen |
| P8 | B | Floor plan view toggle; will-it-fit custom items | A custom 36 × 36 × 28 item can be added, moved, saved, reloaded |
| P9 | B | `view` mode for share links | Share page shows the layout read-only |
| P10 | Best | Composite furniture shapes; first-person view; export image | |

### Server track

| # | Tier | Milestone | Done when |
| --- | --- | --- | --- |
| S1 | G | `helpers.py`: db, `login_required`, `admin_required`, `apology`; foreign keys on | Test proves a bad foreign key is rejected |
| S2 | G | Register, login, logout; `create_admin.py` | A new student can register and log in; an admin can be created from the terminal |
| S3 | G | Home with search, dorm page, room type facts page | All three pages render from the database; drafts hidden from non-admins |
| S4 | G | `/api/types/<id>`, `/api/furniture` | JSON matches section 7.2 exactly; test covers draft visibility |
| S5 | G | Layouts API with ownership checks and placement validation | Tests: another user's layout returns 403; bad rotation returns 400 |
| S6 | G | `/my-room`, `/layouts` page | An assigned student lands on their room's planner |
| S7 | B | Share tokens; shopping list page | A share link works logged out and stops working after "Stop sharing" |
| S8 | B | `--demo-users` seeding; `export_rooms.py` | A fresh database can be rebuilt with all real rooms from `seed/` |

### Admin track

| # | Tier | Milestone | Done when |
| --- | --- | --- | --- |
| A1 | G | Admin home and room types list behind `admin_required` | A student gets 403 on every `/admin` route (test) |
| A2 | G | Rectangle form with live SVG preview, walls labelled | Typing width and length redraws the preview to scale |
| A3 | G | Features table with live preview and inline errors | A window wider than its wall is shown in red with the reason |
| A4 | G | Save draft, edit, publish; server validation with readable errors | A room built in the form opens correctly in the 3D planner |
| A5 | G | Rooms page: add room, assign and unassign student by email | The assigned student sees "My room" |
| A6 | G | Default layout page (planner in `admin-default` mode) | The default layout set here is what visitors see first |
| A7 | B | Dorms page; furniture catalog editor | Changing the bed's size changes it in every planner |
| A8 | B | Click-to-draw outlines for non-rectangular rooms | An L-shaped room can be drawn, saved and opened in 3D |
| A9 | B | Export button calling `export_rooms.py` logic | Real rooms saved to `seed/rooms/` and committed |

### Integration checkpoints (all three)

1. **I1, after P4 + S4:** a Demo Hall room loads from the database in the planner.
2. **I2, after P6 + S5 + A4:** a room created in the builder opens in the planner, a student saves a layout, logs out, logs in, reopens it.
3. **I3, Dec 3 feature freeze:** every G row works end to end on all three laptops and in a fresh Codespace from `python init_db.py`.

---

## 11. Quality bar

### Definition of done for any feature

- Works in Chrome and Safari; the browsing pages work on a phone-width screen.
- No errors in the browser console or the Flask log during normal use.
- Input from the user is validated on the server, not only in the browser.
- New pure functions have a test.
- Code is commented where the reason is not obvious, especially geometry.
- `docs/decisions.md` has an entry if a non-obvious choice was made.

### Style

- Python: PEP 8, functions with docstrings, `snake_case`. SQL always with `?` placeholders, never string formatting.
- JavaScript: ES modules, `const` by default, no global variables, `camelCase`, functions under about 40 lines, JSDoc comments on exported functions. `rules.js` and `shared/geometry.js` import nothing from three.js or the DOM, so `node --test` can run them.
- Templates: extend `layout.html`; no inline `<script>` blocks other than the module tag and the import map.
- CSS: `style.css` for the site, `planner.css` for the planner. Use Bootstrap utilities before writing new CSS.
- Accessibility: every form control has a label; buttons have text; keyboard focus is visible; colour is never the only signal (issue text accompanies the orange tint).

### Testing

- `pytest`: `test_geometry.py` (valid rooms pass; each rule in 4.2 has a failing case), `test_routes.py` (auth, ownership, admin guard, draft visibility, layout save round trip). Use a temporary database per test via `CRIMSON3D_DB`.
- `node --test tests/*.test.mjs`: `geometry.test.mjs` (walls, normals, start corner on the left from inside, feature positions), `rules.test.mjs` (every rule in 4.5, including the L-shaped inner corner and under-bed clearance).
- Manual checklist per milestone, written in the milestone's pull request description.

---

## 12. Security and privacy

- Passwords hashed with werkzeug; never logged.
- Every layout read or write checks `layouts.user_id == session["user_id"]` (or admin for defaults).
- Share tokens come from `secrets.token_urlsafe(16)`; shared views are read-only.
- No real student names or real housing assignments in the database we submit or demo. Demo students are invented.
- Rooms are measured only with every occupant's permission; room numbers are optional and can be left off public pages.
- No photos of rooms with personal belongings unless the occupants agree in writing.

---

## 13. Out of scope

HarvardKey login; a phone app; augmented reality; LiDAR scanning; real-time multi-user editing; links to products for sale; uploading 3D model files; physics or stacking; furniture rotation other than 90° steps; any build tooling.

---

## 14. Open items for the team

These need a human decision. Claude Code should ask rather than guess.

- Real dorms and room types to seed beyond Demo Hall, once measured.
- Measured sizes of the Harvard-issued furniture (replace the placeholders).
- Whether to deploy publicly (Best tier) and where.
- The final project name, if it changes from Crimson3D.
