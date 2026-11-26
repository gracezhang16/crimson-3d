/**
 * Planner entry point (SPEC.md 8.1): read the page's data-* attributes, load
 * the room, build the scene and wire the modules together.
 *
 * P6: the room (floor, walls with dollhouse stubs, wall features, door zones,
 * wall labels) with its default furniture, or a saved layout (?layout=<id>);
 * furniture can be selected, dragged, turned, nudged, deleted and added from
 * the catalog; logged-in students can save, save as new and rename.
 */

import { apiFetch } from "../shared/api.js";
import { attachInteraction } from "./interaction.js";
import { createRoomLabels, createWallLabels } from "./labels.js";
import { createAnimator, playIntro } from "./animate.js";
import { createItemTools } from "./itemTools.js";
import { createLayout } from "./layout.js";
import { createItemList, createPanel, createShoppingList } from "./panel.js";
import { buildRoom } from "./room.js";
import { createDefaultSaveControls, createSaveControls } from "./saving.js";
import { createScene, webglAvailable } from "./scene.js";

const NO_WEBGL_MESSAGE =
  "This browser can't show the 3D view. Try a current version of Chrome, Safari, Firefox or Edge.";

/**
 * Read the settings the server put on #planner. dataset turns
 * data-type-id into dataset.typeId (dashes become camelCase).
 *
 * @param {HTMLElement} element
 * @returns {{typeId: number, layoutId: number | null, mode: string, loggedIn: boolean,
 *   shareToken: string | null}}
 */
function readConfig(element) {
  const { typeId, layoutId, mode, loggedIn, shareToken } = element.dataset;
  return {
    typeId: Number(typeId),
    layoutId: layoutId ? Number(layoutId) : null,
    mode, // "edit" | "view" (share page) | "admin-default"
    loggedIn: loggedIn === "true",
    shareToken: shareToken || null,
  };
}

/**
 * Load what the planner draws: the suite and the placements to start from.
 * The share page reads one shared layout (/api/share/<token>); otherwise the
 * suite type comes from /api/types/<id>, with a saved layout if one was asked
 * for. The catalog is loaded alongside, in parallel (Promise.all).
 *
 * @returns {Promise<{geometry: object, placements: object[], catalog: object[],
 *   saved: object | null}>}
 */
async function loadPlan(config) {
  if (config.mode === "view") {
    const [shared, catalog] = await Promise.all([
      apiFetch(`/api/share/${config.shareToken}`),
      apiFetch("/api/furniture"),
    ]);
    return { geometry: shared.geometry, placements: shared.placements, catalog, saved: null };
  }
  const [roomType, catalog, saved] = await Promise.all([
    apiFetch(`/api/types/${config.typeId}`),
    apiFetch("/api/furniture"),
    config.layoutId ? apiFetch(`/api/layouts/${config.layoutId}`) : null,
  ]);
  // A saved layout if one was asked for, otherwise the suite's default.
  const placements = saved ? saved.placements : roomType.default_layout.placements;
  return { geometry: roomType.geometry, placements, catalog, saved };
}

/**
 * Show a message over the 3D area, e.g. when WebGL or loading fails
 * (SPEC.md 8.8). Removes the canvas, since there's nothing to draw.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {string} text
 */
function showMessage(canvas, text) {
  const message = document.createElement("div");
  message.className = "planner-message";
  message.setAttribute("role", "alert");
  message.textContent = text;
  canvas.replaceWith(message);
}

/**
 * Load the room type and the furniture catalog, then draw them.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {{typeId: number}} config
 */
async function start(canvas, config) {
  let plan;
  try {
    plan = await loadPlan(config);
  } catch (error) {
    showMessage(canvas, `Couldn't load this suite: ${error.message}`);
    return;
  }
  const { geometry, placements, catalog, saved } = plan;
  const catalogById = new Map(catalog.map((item) => [item.id, item]));

  const container = canvas.parentElement;
  const view = createScene(canvas);
  const room = buildRoom(geometry);
  view.scene.add(room.group);

  const animator = createAnimator(view.requestRender);
  const layout = createLayout(geometry, catalogById, view.scene, view.requestRender, animator);
  layout.load(placements);
  // The opening show (animate.js): walls rise, then the furniture drops in.
  // Any click or key in the 3D view skips to the end. "capture" runs this
  // before the planner's own pointer handling, so the click then works normally.
  playIntro(animator, room.group, layout.entries());
  const skip = () => { if (animator.busy()) animator.finishAll(); };
  canvas.addEventListener("pointerdown", skip, { capture: true });
  window.addEventListener("keydown", skip, { capture: true });
  let tools = null; // Rotate / Delete over the selected item (not on share pages)
  if (config.mode === "view") {
    // Share page: look, don't touch (SPEC.md 8.1). No picking or dragging.
    createItemList(layout);
  } else {
    attachInteraction({ canvas, camera: view.camera, controls: view.controls, layout });
    createPanel(layout, catalog);
    tools = createItemTools(container, layout);
  }
  createShoppingList(layout);
  if (config.mode === "edit" && config.loggedIn) {
    createSaveControls(config, layout, saved ? saved.name : "My layout", saved?.share_url ?? null);
  } else if (config.mode === "admin-default") {
    createDefaultSaveControls(config, layout);
  }

  const labels = createWallLabels(container, room.walls);
  const roomLabels = createRoomLabels(container, geometry.rooms);
  const focus = createRoomFocus(geometry.rooms, room, view);
  // Order matters: the room decides which walls are stubs, then the labels
  // pick from the walls still standing.
  attachViewTools(view);
  view.addFrameCallback((camera) => {
    room.update(camera, focus.current(), view.view() === "plan");
    labels.update(camera);
    roomLabels.update(camera);
    tools?.update(camera);
  });
  view.fitCamera(room.bounds);
}

/**
 * The "Rooms" buttons for a suite with several rooms: "Whole suite" plus one
 * per room. Picking a room points the camera at it, and room.update() then
 * lowers every other room's walls so it can be seen into from any side.
 *
 * @param {{name: string}[]} rooms
 * @param {ReturnType<typeof buildRoom>} room
 * @param {ReturnType<typeof createScene>} view
 * @returns {{current: () => number | null}} the room in focus (null = whole suite)
 */
function createRoomFocus(rooms, room, view) {
  let focus = null;
  const section = document.querySelector("#room-focus");
  if (rooms.length < 2) {
    return { current: () => null };
  }
  section.hidden = false;
  const box = document.querySelector("#room-focus-buttons");

  function render() {
    const choices = [["Whole suite", null], ...rooms.map((r, i) => [r.name, i])];
    box.replaceChildren(...choices.map(([label, index]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `btn btn-sm ${index === focus ? "btn-crimson" : "btn-outline-secondary"}`;
      button.setAttribute("aria-pressed", String(index === focus));
      button.textContent = label;
      button.addEventListener("click", () => {
        focus = index;
        view.fitCamera(index === null ? room.bounds : room.roomBounds[index]);
        render();
      });
      return button;
    }));
  }
  render();
  return { current: () => focus };
}

/**
 * The 3D / Floor plan switch and the zoom buttons over the 3D view.
 * @param {ReturnType<typeof createScene>} view
 */
function attachViewTools(view) {
  const modeButtons = document.querySelectorAll(".scene-tools [data-view]");
  for (const button of modeButtons) {
    button.addEventListener("click", () => {
      view.setView(button.dataset.view);
      modeButtons.forEach((b) => b.setAttribute("aria-pressed", String(b === button)));
    });
  }
  for (const button of document.querySelectorAll(".scene-tools [data-zoom]")) {
    button.addEventListener("click", () => view.zoom(button.dataset.zoom === "in" ? 0.8 : 1.25));
  }
}

const plannerElement = document.querySelector("#planner");
const canvas = document.querySelector("#scene");

if (!webglAvailable()) {
  showMessage(canvas, NO_WEBGL_MESSAGE);
} else {
  start(canvas, readConfig(plannerElement)).catch((error) => {
    // Creating the renderer can still fail (e.g. the graphics driver refuses).
    console.error(error);
    showMessage(canvas, NO_WEBGL_MESSAGE);
  });
}
