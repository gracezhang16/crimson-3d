-- Crimson3D database schema (SPEC.md section 5).
-- init_db.py runs this file against a fresh, empty crimson3d.db.

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

CREATE TABLE suite_types (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    dorm_id      INTEGER NOT NULL REFERENCES dorms(id),
    name         TEXT NOT NULL,                      -- e.g. "Two-bedroom suite"
    capacity     INTEGER NOT NULL DEFAULT 1 CHECK (capacity BETWEEN 1 AND 6),
    bathroom     TEXT CHECK (bathroom IN ('en-suite', 'hallway', 'shared-suite')),
    geometry     TEXT NOT NULL,                      -- the suite format (SPEC.md section 4) as JSON text
    status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
    measured_by  TEXT,
    measured_on  DATE,
    notes        TEXT,
    created_by   INTEGER REFERENCES users(id),
    updated      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (dorm_id, name)
);

-- A specific suite, like Canaday B-21, built like one suite type.
CREATE TABLE suites (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    dorm_id        INTEGER NOT NULL REFERENCES dorms(id),
    number         TEXT NOT NULL,                    -- e.g. "B-21"
    suite_type_id  INTEGER NOT NULL REFERENCES suite_types(id),
    UNIQUE (dorm_id, number)
);

CREATE TABLE assignments (
    user_id   INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    suite_id  INTEGER NOT NULL REFERENCES suites(id) ON DELETE CASCADE
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
    user_id        INTEGER REFERENCES users(id) ON DELETE CASCADE,   -- NULL for a suite type's default layout
    suite_type_id  INTEGER NOT NULL REFERENCES suite_types(id) ON DELETE CASCADE,
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

CREATE INDEX layouts_by_user ON layouts (user_id, suite_type_id);
CREATE INDEX placements_by_layout ON placements (layout_id);
