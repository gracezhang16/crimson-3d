# CLAUDE.md

## Project

Crimson3D: a Flask + SQLite + three.js website where incoming Harvard first-years open a to-scale 3D model of their dorm room, arrange furniture, and save layouts. Admins build rooms in 2D from measurements and assign students.

**Read `SPEC.md` before starting any task.** It holds the data format, schema, routes, milestones and quality bar.

## How to work

1. **One milestone at a time** (SPEC.md section 10). Finish the Good tier before any Better work.
2. **Plan first.** Before writing code, state in a few lines what you will change, which files, and how we will check it works. Wait for a go-ahead on anything larger than a small fix.
3. **Small steps we can follow.** Prefer several small, working changes over one large one. After each, say what changed and how to test it by hand.
4. **Teach as you go.** When you use something not covered in CS50 (three.js, raycasting, import maps, blueprints, SVG, `fetch`), explain it briefly in your reply and in a code comment where it is used.
5. **Stay in the current workstream.** If a change needs another person's files, say so and describe the change instead of making it, unless asked.
6. **Never change the contract silently.** Any change to `geometry.py`, `static/js/shared/*` or SPEC.md section 4 must be called out explicitly, with the matching change made on both the Python and JavaScript sides.
7. **Record decisions.** Add a dated line to `docs/decisions.md` for any non-obvious choice (what, why, alternatives). We use it to write DESIGN.md.
8. **Do not write README.md or DESIGN.md.** You may suggest an outline or point out what is missing; the team writes them.
9. **Ask, don't guess,** about anything in SPEC.md section 14 (open items) or any product behaviour the spec does not cover.

## Hard rules

- No new dependencies, frameworks, CDNs or build tools without asking. No React, no npm bundler, no ORM.
- three.js 0.170.0 and Bootstrap 5.3.3 are vendored under `static/vendor/`; never load them from a CDN.
- SQL always uses `?` placeholders.
- Every layout read or write checks ownership on the server.
- No real student names or real housing assignments in seed data or tests.
- Keep `static/js/planner/rules.js` and `static/js/shared/geometry.js` free of three.js and DOM imports so they run under `node --test`.
- Do not commit `flask_session/`, `__pycache__/` or development databases.

## Commands

```bash
pip install -r requirements.txt
python init_db.py                 # fresh crimson3d.db from schema.sql + seed/ (add --demo-users for showcase accounts)
python create_admin.py you@example.com
flask run                         # http://127.0.0.1:5000
pytest                            # Python tests
node --test tests/*.test.mjs      # pure JavaScript tests
```

## Before saying a task is done

- `pytest` and `node --test tests/*.test.mjs` pass.
- You have described the manual check and, where possible, run it.
- No errors in the Flask log; mention anything the student should check in the browser console.
- `docs/decisions.md` is updated if needed.
