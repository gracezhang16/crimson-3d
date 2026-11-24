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
import { createWallLabels } from "./labels.js";
import { createLayout } from "./layout.js";
import { createPanel } from "./panel.js";
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
 * @returns {{typeId: number, layoutId: number | null, mode: string, loggedIn: boolean}}
 */
function readConfig(element) {
  const { typeId, layoutId, mode, loggedIn } = element.dataset;
  return {
    typeId: Number(typeId),
    layoutId: layoutId ? Number(layoutId) : null,
    mode, // "edit" | "view" | "admin-default"
    loggedIn: loggedIn === "true",
  };
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
  let roomType;
  let catalog;
  let saved = null;
  try {
    // Promise.all starts the requests at once and waits for all of them.
    [roomType, catalog, saved] = await Promise.all([
      apiFetch(`/api/types/${config.typeId}`),
      apiFetch("/api/furniture"),
      config.layoutId ? apiFetch(`/api/layouts/${config.layoutId}`) : null,
    ]);
  } catch (error) {
    showMessage(canvas, `Couldn't load this room: ${error.message}`);
    return;
  }
  const catalogById = new Map(catalog.map((item) => [item.id, item]));

  const container = canvas.parentElement;
  const view = createScene(canvas);
  const room = buildRoom(roomType.geometry);
  view.scene.add(room.group);

  const layout = createLayout(roomType.geometry, catalogById, view.scene, view.requestRender);
  // A saved layout if one was asked for, otherwise the room's default.
  layout.load(saved ? saved.placements : roomType.default_layout.placements);
  if (config.mode !== "view") {
    attachInteraction({ canvas, camera: view.camera, controls: view.controls, layout });
    createPanel(layout, catalog);
  }
  if (config.mode === "edit" && config.loggedIn) {
    createSaveControls(config, layout, saved ? saved.name : "My layout");
  } else if (config.mode === "admin-default") {
    createDefaultSaveControls(config, layout);
  }

  const labels = createWallLabels(container, room.walls);
  // Order matters: the room decides which walls are stubs, then the labels
  // pick from the walls still standing.
  view.addFrameCallback((camera) => {
    room.update(camera);
    labels.update(camera);
  });
  view.fitCamera(room.bounds);
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
