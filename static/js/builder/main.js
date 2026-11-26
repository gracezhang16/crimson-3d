/**
 * Suite builder page (templates/admin/suite_type_form.html). Hannah.
 *
 * A suite is one or more rooms. This file keeps every room's typed values
 * in `rooms`, shows the selected room's values in the editor, and on every
 * keystroke rebuilds the whole suite (state.js: parseRoom, buildSuite) and
 * redraws the preview (preview.js: drawSuite). Switching rooms saves the
 * editor into `rooms` first, so nothing typed is lost.
 *
 * One "input" listener on the whole form catches typing in any field, because
 * input events bubble up from the field to the form ("event delegation").
 *
 * A8: "Draw it on the preview" hands the preview to draw.js until the shape
 * is closed or drawing is cancelled; the drawn outline then fills the wall
 * rows, marked "drawn" until a measured length is typed (outline.closeWalk).
 */

import { formatFeetInches } from "../shared/units.js";
import { signedArea, wallLetter } from "../shared/geometry.js";
import { startDrawing } from "./draw.js";
import { closeWalk, wallsFromOutline } from "./outline.js";
import { drawSuite } from "./preview.js";
import {
  buildSuite, geometryToForm, newRoom, parseInches, parseRoom, positionNextTo, rectangleWalls, wallProblem,
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
const MAX_ROOMS = 8;
const DEFAULT_GAP = 5; // inches of wall between a new room and the one it's placed next to

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
const roomTabs = document.querySelector("#room-tabs");
const placeNextTo = document.querySelector("#place-next-to");
const placeRoom = document.querySelector("#place-room");
const drawButton = document.querySelector("#draw-button");
const drawTools = document.querySelector("#draw-tools");
const drawHint = document.querySelector("#draw-hint");

let rooms = [newRoom("Bedroom A")]; // every room's typed values (see state.newRoom)
let selected = 0;                     // the room shown in the editor
let built = null;                     // the latest buildSuite() result
let drawing = null;                   // while drawing: draw.js's controls (undo, cancel)
let walkBefore = null;                // wall lengths when a length box got focus (keepWalkClosed)

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

// ---------------------------------------------------------------------------
// The room editor: its fields <-> one room's typed values
// ---------------------------------------------------------------------------

/**
 * @returns {HTMLTableSectionElement[]} one <tbody class="feature"> per feature
 */
function featureBodies() {
  return [...featuresTable.querySelectorAll("tbody.feature")];
}

/** @returns {object} the selected room's values, read from the editor */
function readEditor() {
  return {
    name: field("room_name").value,
    kind: field("room_kind").value,
    shape: field("shape").value,
    width: field("width").value,
    length: field("length").value,
    x: field("room_x").value,
    y: field("room_y").value,
    walls: [...wallRows.querySelectorAll(".wall-row")].map((row) => ({
      direction: row.querySelector(".wall-direction").value,
      length: row.querySelector(".wall-length").value,
      drawn: row.dataset.drawn === "true",
    })),
    features: featureBodies().map((body) => {
      const value = (name) => body.querySelector(`[data-field="${name}"]`).value;
      return {
        kind: body.querySelector(".feature-kind").value,
        wall: body.querySelector(".feature-wall").value,
        offset: value("offset"), width: value("width"), height: value("height"),
        sill: value("sill"), depth: value("depth"),
      };
    }),
  };
}

/**
 * Show a room's values in the editor.
 * @param {object} room - typed values
 */
function writeEditor(room) {
  field("room_name").value = room.name;
  field("room_kind").value = room.kind;
  field("width").value = room.width;
  field("length").value = room.length;
  field("room_x").value = room.x;
  field("room_y").value = room.y;
  document.querySelector(`#shape-${room.shape}`).checked = true;
  showShapeFields(room.shape);

  wallRows.replaceChildren();
  room.walls.forEach((wall) => addWallRow(wall.direction, wall.length, wall.drawn));

  featureBodies().forEach((body) => body.remove());
  room.features.forEach(() => addFeature());
  // Build each feature's wall list before choosing its wall.
  refreshFeatures(wallCount(room), []);
  featureBodies().forEach((body, i) => {
    const feature = room.features[i];
    body.querySelector(".feature-kind").value = feature.kind;
    body.querySelector(".feature-wall").value = feature.wall;
    for (const input of body.querySelectorAll("[data-field]")) {
      input.value = feature[input.dataset.field] ?? "";
    }
  });
}

/** @returns {number} how many walls a room has (4 for a rectangle) */
function wallCount(room) {
  return room.shape === "walls" ? room.walls.length : 4;
}

/**
 * Add a row to the wall table, cloned from the <template>.
 *
 * @param {string} direction
 * @param {number | string} length
 * @param {boolean} [drawn] - the length comes from a drawing, not a tape measure
 */
function addWallRow(direction = "east", length = "", drawn = false) {
  const row = rowTemplate.content.firstElementChild.cloneNode(true);
  row.querySelector(".wall-direction").value = direction;
  row.querySelector(".wall-length").value = length;
  row.dataset.drawn = String(Boolean(drawn));
  wallRows.append(row);
}

/** Add an empty feature row (a door on wall A), cloned from the <template>. */
function addFeature() {
  featuresTable.append(featureTemplate.content.firstElementChild.cloneNode(true));
}

/**
 * Letter the wall rows A, B, C... and mark rows with a bad length in red,
 * with the reason underneath (Bootstrap's is-invalid + invalid-feedback).
 *
 * @param {{direction: string, length: number}[]} walls - parsed
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
    row.querySelector(".wall-drawn").hidden = row.dataset.drawn !== "true";
  });
}

/**
 * Remember every wall's length when a length box gets focus, so that
 * keepWalkClosed() works from the lengths before this edit, not from the
 * half-typed values in between ("1", "14", "146").
 */
function rememberWalk() {
  walkBefore = [...wallRows.querySelectorAll(".wall-length")].map((input) => input.value);
}

/**
 * After a wall's length is typed: it now counts as measured, and if the walk
 * no longer closes, the nearest drawn wall on the same axis is changed to
 * close it again (outline.closeWalk). Each keystroke starts again from the
 * lengths before this edit (rememberWalk), so only the final number counts.
 * Changed rows flash briefly.
 *
 * @param {HTMLInputElement} input - the .wall-length box just typed in
 */
function keepWalkClosed(input) {
  const rows = [...wallRows.querySelectorAll(".wall-row")];
  const index = rows.indexOf(input.closest(".wall-row"));
  rows[index].dataset.drawn = "false";
  const drawn = rows.map((row) => row.dataset.drawn === "true");
  if (!drawn.some(Boolean) || walkBefore?.length !== rows.length) {
    return;
  }
  const lengthBox = (row) => row.querySelector(".wall-length");
  // Put the drawn walls back to their lengths before this edit, then close.
  rows.forEach((row, j) => {
    if (drawn[j]) lengthBox(row).value = walkBefore[j];
  });
  const walls = rows.map((row) => ({
    direction: row.querySelector(".wall-direction").value,
    length: parseInches(lengthBox(row).value),
  }));
  const result = closeWalk(walls, index, drawn);
  for (const j of result?.adjusted ?? []) {
    lengthBox(rows[j]).value = result.lengths[j];
    rows[j].classList.remove("wall-adjusted");
    void rows[j].offsetWidth; // restart the CSS highlight if it's still running
    rows[j].classList.add("wall-adjusted");
  }
}

/**
 * Jump to the box holding wall i's length (clicked in the preview).
 * @param {number} i
 */
function focusWall(i) {
  const input = field("shape").value === "walls"
    ? wallRows.querySelectorAll(".wall-length")[i]
    : field(i % 2 === 0 ? "width" : "length"); // a rectangle: A and C are its width, B and D its length
  input?.focus();
  input?.select();
}

/**
 * Keep each feature's wall list in step with the room's shape (A, B, C...
 * for however many walls there are), enable only the boxes its kind uses,
 * and show its problems in red underneath.
 *
 * @param {number} walls - how many walls the room has
 * @param {string[][]} featureErrors - from buildSuite()
 */
function refreshFeatures(walls, featureErrors) {
  featureBodies().forEach((body, i) => {
    const select = body.querySelector(".feature-wall");
    const chosen = select.value === "" ? 0 : Number(select.value);
    const expectedOptions = chosen >= walls ? walls + 1 : walls;
    if (select.options.length !== expectedOptions) {
      select.replaceChildren();
      for (let wall = 0; wall < walls; wall++) {
        select.append(new Option(wallLetter(wall), wall));
      }
      // A wall that was deleted from the shape stays selected, so the row
      // shows an error instead of silently moving to another wall.
      if (chosen >= walls) {
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
 * Show the Rectangle or Custom shape fields. The inactive fieldset is
 * disabled as well as hidden, so its fields are neither checked nor submitted.
 *
 * @param {"rectangle" | "walls"} shape
 */
function showShapeFields(shape) {
  const custom = shape === "walls";
  rectangleFields.hidden = rectangleFields.disabled = custom;
  wallFields.hidden = wallFields.disabled = !custom;
}

// ---------------------------------------------------------------------------
// Rooms: tabs, adding, removing, placing
// ---------------------------------------------------------------------------

/** Redraw the room tabs and the "place next to" list. */
function renderTabs() {
  const buttons = rooms.map((room, i) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `btn btn-sm ${i === selected ? "btn-crimson" : "btn-outline-secondary"}`;
    button.dataset.action = "select-room";
    button.dataset.room = i;
    button.setAttribute("aria-pressed", String(i === selected));
    button.textContent = room.name.trim() || `Room ${i + 1}`;
    return button;
  });
  const add = document.createElement("button");
  add.type = "button";
  add.className = "btn btn-sm btn-outline-secondary";
  add.dataset.action = "add-room";
  add.textContent = "+ Add room";
  add.disabled = rooms.length >= MAX_ROOMS;
  const hallway = document.createElement("button");
  hallway.type = "button";
  hallway.className = "btn btn-sm btn-outline-secondary";
  hallway.dataset.action = "add-hallway";
  hallway.textContent = "+ Add hallway";
  hallway.disabled = rooms.length >= MAX_ROOMS;
  roomTabs.replaceChildren(...buttons, add, hallway);

  form.querySelector('[data-action="remove-room"]').disabled = rooms.length === 1;
  placeNextTo.hidden = rooms.length === 1;
  placeRoom.replaceChildren(...rooms
    .map((room, i) => [room, i])
    .filter(([, i]) => i !== selected)
    .map(([room, i]) => new Option(room.name.trim() || `Room ${i + 1}`, i)));
}

/**
 * Show room i in the editor (saving the current room first).
 * @param {number} i
 */
function selectRoom(i) {
  rooms[selected] = readEditor();
  selected = i;
  writeEditor(rooms[selected]);
  renderTabs();
  update();
}

/**
 * Add a room east of the current one: a common room if there's none yet,
 * else a bedroom; or, with `hallway`, a long thin hallway.
 *
 * @param {boolean} [hallway]
 */
function addRoom(hallway = false) {
  rooms[selected] = readEditor();
  const anchor = built?.rooms[selected]?.outline;
  const position = anchor ? positionNextTo(anchor, "east", DEFAULT_GAP) : { x: 0, y: 0 };
  const hasCommon = rooms.some((room) => room.kind === "common");
  const bedrooms = rooms.filter((room) => room.kind === "bedroom").length;
  const hallways = rooms.filter((room) => room.kind === "hallway").length;
  let name;
  let kind;
  if (hallway) {
    [name, kind] = [hallways ? `Hallway ${hallways + 1}` : "Hallway", "hallway"];
  } else {
    [name, kind] = hasCommon ? [`Bedroom ${String.fromCharCode(65 + bedrooms)}`, "bedroom"] : ["Common room", "common"];
  }
  rooms.push(newRoom(name, kind, position));
  selected = rooms.length - 1;
  writeEditor(rooms[selected]);
  renderTabs();
  update();
  field("room_name").focus();
}

/** Remove the room being edited, after asking. */
function removeRoom() {
  const name = field("room_name").value.trim() || `Room ${selected + 1}`;
  if (rooms.length === 1 || !window.confirm(`Remove ${name} from this suite?`)) {
    return;
  }
  rooms.splice(selected, 1);
  selected = Math.max(0, selected - 1);
  writeEditor(rooms[selected]);
  renderTabs();
  update();
}

/** Move the room being edited next to another, with a wall's gap between. */
function placeNextToRoom() {
  const other = built?.rooms[Number(placeRoom.value)]?.outline;
  if (!other) {
    return; // that room has no shape yet
  }
  const gap = parseInches(document.querySelector("#place-gap").value);
  const side = document.querySelector("#place-side").value;
  const { x, y } = positionNextTo(other, side, Number.isNaN(gap) ? DEFAULT_GAP : gap);
  field("room_x").value = x;
  field("room_y").value = y;
  update();
}

// ---------------------------------------------------------------------------
// Rebuilding the suite and the preview
// ---------------------------------------------------------------------------

/**
 * Show either the summary ("3 rooms · 606.2 sq ft in all") or the list of
 * problems under the preview.
 *
 * @param {object | null} geometry
 * @param {string[]} errors
 */
function showStatus(geometry, errors) {
  status.replaceChildren();
  status.className = "mt-2 small";
  if (errors.length || !geometry) {
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
  status.className = "mt-2 small text-success";
  if (geometry.rooms.length === 1) {
    const { outline } = geometry.rooms[0];
    const width = Math.max(...outline.map(([x]) => x)) - Math.min(...outline.map(([x]) => x));
    const length = Math.max(...outline.map(([, y]) => y)) - Math.min(...outline.map(([, y]) => y));
    status.textContent = `✓ ${formatFeetInches(width)} × ${formatFeetInches(length)} overall · ${outline.length} walls`;
    return;
  }
  const area = geometry.rooms.reduce((sum, room) => sum + Math.abs(signedArea(room.outline)), 0) / 144;
  status.textContent = `✓ ${geometry.rooms.length} rooms · ${area.toFixed(1)} sq ft in all`;
}

/** Rebuild the suite from every room and redraw everything. */
function update() {
  rooms[selected] = readEditor();
  built = buildSuite({ ceiling: parseInches(field("ceiling").value), rooms: rooms.map(parseRoom) });
  const current = parseRoom(rooms[selected]);
  if (current.shape === "walls") {
    refreshRows(current.walls);
  }
  refreshFeatures(wallCount(rooms[selected]), built.rooms[selected].featureErrors);
  const tab = roomTabs.querySelector(`[data-room="${selected}"]`);
  if (tab) tab.textContent = rooms[selected].name.trim() || `Room ${selected + 1}`;
  showStatus(built.geometry, built.errors);
  if (!drawing) {
    drawSuite(svg, built.rooms, selected); // while drawing, draw.js owns the preview
  }
  // Only a complete, valid suite goes into the hidden field the server reads.
  field("geometry").value = built.errors.length || !built.geometry ? "" : JSON.stringify(built.geometry);
}

/**
 * Switch the selected room between Rectangle and Custom shape. A custom
 * shape starts from the current rectangle's four walls, so the admin only
 * edits what differs.
 *
 * @param {"rectangle" | "walls"} shape
 */
function setShape(shape) {
  showShapeFields(shape);
  if (shape === "walls" && !wallRows.children.length) {
    const width = parseInches(field("width").value) || 120;
    const length = parseInches(field("length").value) || 120;
    rectangleWalls(width, length).forEach((wall) => addWallRow(wall.direction, wall.length));
  }
  update();
}

// ---------------------------------------------------------------------------
// Drawing the selected room on the preview (A8)
// ---------------------------------------------------------------------------

/**
 * Show a line of instructions (or a problem) under the preview.
 * @param {string} text
 * @param {boolean} [isError]
 */
function showHint(text, isError = false) {
  drawHint.hidden = false;
  drawHint.textContent = text;
  drawHint.classList.toggle("text-danger", isError);
}

/** Hand the preview to draw.js, with the suite's other rooms shown for reference. */
function startDraw() {
  rooms[selected] = readEditor();
  const others = built.rooms
    .filter((room, i) => i !== selected && room.outline && !room.openEnd)
    .map((room) => ({ name: room.name, outline: room.outline }));
  drawTools.hidden = false;
  drawButton.disabled = true;
  status.hidden = true; // the summary is about the old shape until drawing ends
  drawing = startDrawing(svg, { others, hint: showHint, onClose: finishDrawing, onCancel: endDrawing });
  svg.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

/** Give the preview back to the builder. */
function endDrawing() {
  drawing = null;
  drawTools.hidden = true;
  drawButton.disabled = false;
  status.hidden = false;
  drawHint.hidden = true;
  update();
}

/**
 * The shape is closed: it becomes this room's walls (marked drawn) and
 * position, and the admin carries on by typing measured lengths.
 *
 * @param {number[][]} outline - clockwise, in suite inches
 */
function finishDrawing(outline) {
  field("room_x").value = Math.min(...outline.map(([x]) => x));
  field("room_y").value = Math.min(...outline.map(([, y]) => y));
  document.querySelector("#shape-walls").checked = true;
  showShapeFields("walls");
  wallRows.replaceChildren();
  wallsFromOutline(outline).forEach((wall) => addWallRow(wall.direction, wall.length, true));
  endDrawing();
  showHint(`Shape drawn: ${outline.length} walls. Now type each wall's measured length (or click a wall here). `
    + "Walls still marked “drawn” adjust to keep the room closed.");
  wallRows.querySelector(".wall-length").focus();
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

// focusin is "focus" that bubbles, so one listener on the form hears it.
form.addEventListener("focusin", (event) => {
  if (event.target.classList.contains("wall-length")) {
    rememberWalk();
  }
});
form.addEventListener("input", (event) => {
  if (event.target.classList.contains("wall-length")) {
    keepWalkClosed(event.target);
  }
  update();
});
form.addEventListener("change", (event) => {
  if (event.target.name === "shape") {
    setShape(event.target.value);
  }
});
form.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  const action = button?.dataset.action;
  // Any other button (switching rooms, adding walls...) ends a drawing first.
  if (drawing && action && action !== "undo-corner" && action !== "cancel-drawing") {
    drawing.cancel();
  }
  switch (action) {
    case "draw-room":
      startDraw();
      break;
    case "undo-corner":
      drawing?.undo();
      break;
    case "cancel-drawing":
      drawing?.cancel();
      break;
    case "select-room":
      selectRoom(Number(button.dataset.room));
      break;
    case "add-room":
      addRoom();
      break;
    case "add-hallway":
      addRoom(true);
      break;
    case "remove-room":
      removeRoom();
      break;
    case "place-room":
      placeNextToRoom();
      break;
    case "add-wall":
      addWallRow();
      wallRows.lastElementChild.querySelector(".wall-length").focus();
      update();
      break;
    case "remove-wall":
      button.closest("tr").remove();
      update();
      break;
    case "add-feature":
      addFeature();
      update(); // fills in the new row's wall list before focusing it
      featureBodies().at(-1).querySelector('[data-field="offset"]').focus();
      break;
    case "remove-feature":
      button.closest("tbody").remove();
      update();
      break;
    default:
  }
});
// Clicking a wall of the room being edited jumps to its length; clicking
// another room edits that room.
svg.addEventListener("click", (event) => {
  const wall = event.target.closest("[data-wall]");
  if (wall) {
    focusWall(Number(wall.dataset.wall));
    return;
  }
  const room = event.target.closest("[data-room]");
  if (room && Number(room.dataset.room) !== selected) {
    selectRoom(Number(room.dataset.room));
  }
});
// Only submit a suite the preview accepts; the server checks it again anyway.
form.addEventListener("submit", (event) => {
  update();
  const blocked = field("geometry").value === "";
  saveBlocked.hidden = !blocked;
  if (blocked) {
    event.preventDefault();
  }
});

// ---------------------------------------------------------------------------
// Start: a saved suite (editing, or the server sending the form back), or one new room
// ---------------------------------------------------------------------------

if (form.dataset.geometry) {
  const saved = geometryToForm(JSON.parse(form.dataset.geometry));
  if (saved) {
    rooms = saved.rooms;
    field("ceiling").value = saved.ceiling;
  } else {
    // The form would fall back to a default room, and saving that would
    // overwrite the real shape. So saving is switched off for this suite.
    form.querySelector('button[type="submit"]').disabled = true;
    saveBlocked.textContent = "This suite has a room with angled walls, which the builder can't edit yet, "
      + "so saving is turned off to keep its shape safe.";
    saveBlocked.hidden = false;
  }
}
writeEditor(rooms[selected]);
renderTabs();
update();
