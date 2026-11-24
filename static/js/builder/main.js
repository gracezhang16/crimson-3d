/**
 * Room builder page (templates/admin/suite_type_form.html). Hannah.
 *
 * Form state (shape, walls, features) -> room-format object -> live SVG
 * preview and inline errors, on every keystroke.
 * The pure parts live in state.js (form values -> geometry) and preview.js
 * (geometry -> SVG); this file only reads the form and wires them together.
 *
 * One "input" listener on the whole form catches typing in any field, because
 * input events bubble up from the field to the form ("event delegation").
 */

import { formatFeetInches } from "../shared/units.js";
import { wallLetter } from "../shared/geometry.js";
import { drawPreview } from "./preview.js";
import {
  buildGeometry, featureFromValues, geometryToForm, parseInches, rectangleWalls, wallProblem,
} from "./state.js";

// Which number boxes each kind of feature uses (SPEC.md 4.2); the rest are
// disabled. Offset is always used.
const FEATURE_FIELDS = {
  door: ["width", "height"],
  window: ["width", "height", "sill"],
  closet: ["width", "height"],
  radiator: ["width", "height", "depth"],
  outlet: [],
};

const form = document.querySelector("#room-type-form");
const svg = document.querySelector("#preview");
const status = document.querySelector("#preview-status");
const rectangleFields = document.querySelector("#rectangle-fields");
const wallFields = document.querySelector("#wall-fields");
const wallRows = document.querySelector("#wall-rows");
const rowTemplate = document.querySelector("#wall-row-template");
const featuresTable = document.querySelector("#features-table");
const featureTemplate = document.querySelector("#feature-template");
const saveBlocked = document.querySelector("#save-blocked");

/**
 * @returns {{direction: string, length: number}[]} the wall table, row by row
 */
function readWalls() {
  return [...wallRows.querySelectorAll(".wall-row")].map((row) => ({
    direction: row.querySelector(".wall-direction").value,
    length: parseInches(row.querySelector(".wall-length").value),
  }));
}

/**
 * Look up a form field by its name attribute.
 *
 * Why not form.elements.length? Because `elements` has built-in properties of
 * its own: `elements.length` is the number of fields, not our "length" input.
 * namedItem() always means "the field with this name".
 *
 * @param {string} name
 * @returns {HTMLInputElement | RadioNodeList}
 */
function field(name) {
  return form.elements.namedItem(name);
}

/**
 * @returns {object} the values buildGeometry() needs, read from the form
 */
function readForm() {
  return {
    shape: field("shape").value,
    width: parseInches(field("width").value),
    length: parseInches(field("length").value),
    walls: readWalls(),
    ceiling: parseInches(field("ceiling").value),
    features: readFeatures(),
  };
}

/**
 * @returns {HTMLTableSectionElement[]} one <tbody class="feature"> per feature
 */
function featureBodies() {
  return [...featuresTable.querySelectorAll("tbody.feature")];
}

/**
 * Read the features table into feature objects (see featureFromValues).
 * @returns {object[]}
 */
function readFeatures() {
  return featureBodies().map((body) => {
    const number = (name) => parseInches(body.querySelector(`[data-field="${name}"]`).value);
    const wall = body.querySelector(".feature-wall").value;
    return featureFromValues({
      kind: body.querySelector(".feature-kind").value,
      wall: wall === "" ? NaN : Number(wall),
      offset: number("offset"),
      width: number("width"),
      height: number("height"),
      sill: number("sill"),
      depth: number("depth"),
    });
  });
}

/** Add an empty feature row (a door on wall A), cloned from the <template>. */
function addFeature() {
  featuresTable.append(featureTemplate.content.firstElementChild.cloneNode(true));
}

/**
 * Keep each feature's wall list in step with the shape (A, B, C... for
 * however many walls there are), enable only the boxes its kind uses, and
 * show its problems in red underneath.
 *
 * @param {number} wallCount
 * @param {string[][]} featureErrors - from buildGeometry()
 */
function refreshFeatures(wallCount, featureErrors) {
  featureBodies().forEach((body, i) => {
    const select = body.querySelector(".feature-wall");
    const chosen = select.value === "" ? 0 : Number(select.value);
    const expectedOptions = chosen >= wallCount ? wallCount + 1 : wallCount;
    if (select.options.length !== expectedOptions) {
      select.replaceChildren();
      for (let wall = 0; wall < wallCount; wall++) {
        select.append(new Option(wallLetter(wall), wall));
      }
      // A wall that was deleted from the shape stays selected, so the row
      // shows an error instead of silently moving to another wall.
      if (chosen >= wallCount) {
        select.append(new Option(`${wallLetter(chosen)} (removed)`, chosen));
      }
      select.value = chosen;
    }

    const kind = body.querySelector(".feature-kind").value;
    const used = FEATURE_FIELDS[kind];
    for (const input of body.querySelectorAll("[data-field]")) {
      input.disabled = input.dataset.field !== "offset" && !used.includes(input.dataset.field);
    }
    // A radiator's height is optional; hint at the default the planner uses.
    body.querySelector('[data-field="height"]').placeholder = kind === "radiator" ? "24" : "80";

    const problems = featureErrors[i] ?? [];
    body.querySelector(".feature-inputs").classList.toggle("table-danger", problems.length > 0);
    body.querySelector(".feature-error-row").hidden = problems.length === 0;
    body.querySelector(".feature-error").textContent = problems.join(" ");
  });
}

/**
 * Add a row to the wall table, cloned from the <template>.
 *
 * @param {string} direction
 * @param {number | string} length
 */
function addWallRow(direction = "east", length = "") {
  const row = rowTemplate.content.firstElementChild.cloneNode(true);
  row.querySelector(".wall-direction").value = direction;
  row.querySelector(".wall-length").value = length;
  wallRows.append(row);
}

/**
 * Letter the rows A, B, C... and mark rows with a bad length in red, with
 * the reason underneath (Bootstrap's is-invalid + invalid-feedback).
 *
 * @param {{direction: string, length: number}[]} walls
 */
function refreshRows(walls) {
  wallRows.querySelectorAll(".wall-row").forEach((row, i) => {
    row.querySelector(".wall-letter").textContent = wallLetter(i);
    row.querySelector(".wall-direction").setAttribute("aria-label", `Wall ${wallLetter(i)} direction`);
    const input = row.querySelector(".wall-length");
    input.setAttribute("aria-label", `Wall ${wallLetter(i)} length in inches`);
    // An empty box isn't an error yet; the admin may still be typing.
    const problem = input.value === "" ? null : wallProblem(walls[i]);
    input.classList.toggle("is-invalid", Boolean(problem));
    row.querySelector(".invalid-feedback").textContent = problem ?? "";
  });
}

/**
 * Show either the summary ("9′ 6″ × 12′ 6″ overall · 4 walls") or the list
 * of problems under the preview.
 *
 * @param {object | null} geometry
 * @param {string[]} errors
 */
function showStatus(geometry, errors) {
  status.replaceChildren();
  if (errors.length) {
    const list = document.createElement("ul");
    list.className = "text-danger mb-0 ps-3";
    for (const error of errors) {
      const item = document.createElement("li");
      item.textContent = error;
      list.append(item);
    }
    status.append(list);
    return;
  }
  const { outline } = geometry.rooms[0];
  const xs = outline.map(([x]) => x);
  const ys = outline.map(([, y]) => y);
  status.className = "mt-2 small text-success";
  status.textContent = `✓ ${formatFeetInches(Math.max(...xs))} × ${formatFeetInches(Math.max(...ys))} overall · ${outline.length} walls`;
}

/** Rebuild the geometry from the form and redraw everything. */
function update() {
  const values = readForm();
  const { geometry, errors, openEnd, featureErrors } = buildGeometry(values);
  if (values.shape === "walls") {
    refreshRows(values.walls);
  }
  const wallCount = values.shape === "walls" ? values.walls.length : 4;
  refreshFeatures(wallCount, featureErrors);
  status.className = "mt-2 small";
  showStatus(geometry, errors);
  // The preview draws one room (its outline and features). U3 draws whole suites.
  drawPreview(svg, geometry && geometry.rooms[0], openEnd, featureErrors);
  // Only a complete, valid room goes into the hidden field the server reads (A4).
  field("geometry").value = errors.length ? "" : JSON.stringify(geometry);
}

/**
 * Switch between Rectangle and Custom shape. A custom shape starts from the
 * current rectangle's four walls, so the admin only edits what differs.
 *
 * @param {"rectangle" | "walls"} shape
 */
function setShape(shape) {
  const custom = shape === "walls";
  rectangleFields.hidden = rectangleFields.disabled = custom;
  wallFields.hidden = wallFields.disabled = !custom;
  if (custom && !wallRows.children.length) {
    const width = parseInches(field("width").value) || 120;
    const length = parseInches(field("length").value) || 120;
    rectangleWalls(width, length).forEach((wall) => addWallRow(wall.direction, wall.length));
  }
  update();
}

form.addEventListener("input", update);
form.addEventListener("change", (event) => {
  if (event.target.name === "shape") {
    setShape(event.target.value);
  }
});
form.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (button?.dataset.action === "add-wall") {
    addWallRow();
    wallRows.lastElementChild.querySelector(".wall-length").focus();
    update();
  } else if (button?.dataset.action === "remove-wall") {
    button.closest("tr").remove();
    update();
  } else if (button?.dataset.action === "add-feature") {
    addFeature();
    update(); // fills in the new row's wall list before focusing it
    featureBodies().at(-1).querySelector('[data-field="offset"]').focus();
  } else if (button?.dataset.action === "remove-feature") {
    button.closest("tbody").remove();
    update();
  }
});
// Only submit a room the preview accepts; the server checks it again anyway.
form.addEventListener("submit", (event) => {
  update();
  const blocked = field("geometry").value === "";
  saveBlocked.hidden = !blocked;
  if (blocked) {
    event.preventDefault();
  }
});

/**
 * Fill the shape, ceiling and features from a saved room (editing, or the
 * server sending the form back with errors).
 *
 * @param {object} geometry - the room format
 * @returns {boolean} false if the room can't be shown in the form
 */
function loadGeometry(geometry) {
  const saved = geometryToForm(geometry);
  if (!saved) {
    return false;
  }
  field("ceiling").value = saved.ceiling;
  if (saved.shape === "rectangle") {
    field("width").value = saved.width;
    field("length").value = saved.length;
  } else {
    saved.walls.forEach((wall) => addWallRow(wall.direction, wall.length));
  }
  document.querySelector(`#shape-${saved.shape}`).checked = true;

  saved.features.forEach(addFeature);
  // Build each feature's wall list before choosing its wall.
  refreshFeatures(saved.walls.length, []);
  featureBodies().forEach((body, i) => {
    const feature = saved.features[i];
    body.querySelector(".feature-kind").value = feature.kind;
    body.querySelector(".feature-wall").value = feature.wall;
    for (const input of body.querySelectorAll("[data-field]")) {
      input.value = feature[input.dataset.field] ?? "";
    }
  });
  return true;
}

if (form.dataset.geometry && !loadGeometry(JSON.parse(form.dataset.geometry))) {
  // The form would fall back to a default rectangle, and saving that would
  // overwrite the real shape. So saving is switched off for this room.
  form.querySelector('button[type="submit"]').disabled = true;
  saveBlocked.textContent = "This suite has angled walls or several rooms, which the builder "
    + "can't edit yet, so saving is turned off to keep its shape safe.";
  saveBlocked.hidden = false;
}
setShape(field("shape").value);
