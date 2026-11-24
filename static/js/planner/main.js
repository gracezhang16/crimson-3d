/**
 * Planner entry point (SPEC.md 8.1): read the page's data-* attributes, load
 * the room, build the scene and wire the modules together.
 *
 * P4: the room (floor, walls with dollhouse stubs, wall features, door zones,
 * wall labels) and its default furniture, loaded from /api/types/<id> and
 * /api/furniture. Moving furniture arrives in P5.
 */

import { apiFetch } from "../shared/api.js";
import * as THREE from "three";
import { makeFurniture } from "./furniture.js";
import { createWallLabels } from "./labels.js";
import { buildRoom } from "./room.js";
import { itemDimensions } from "./rules.js";
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
 * Build a group holding every placed item. Items whose catalog entry no
 * longer exists are skipped (with a console warning for developers).
 *
 * @param {object[]} placements - SPEC.md 4.4
 * @param {Map<number, object>} catalogById
 * @returns {THREE.Group}
 */
function buildFurniture(placements, catalogById) {
  const group = new THREE.Group();
  for (const placement of placements) {
    const item = itemDimensions(placement, catalogById);
    if (item) {
      group.add(makeFurniture(placement, item));
    } else {
      console.warn("Skipping a placement whose furniture is no longer in the catalog:", placement);
    }
  }
  return group;
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
  try {
    // Promise.all starts both requests at once and waits for both to finish.
    [roomType, catalog] = await Promise.all([
      apiFetch(`/api/types/${config.typeId}`),
      apiFetch("/api/furniture"),
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
  view.scene.add(buildFurniture(roomType.default_layout.placements, catalogById));

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
