/**
 * Planner entry point (SPEC.md 8.1): read the page's data-* attributes, build
 * the scene and wire the modules together.
 *
 * P1: shows a test box the size of the bed on a 1 ft grid, to prove the
 * scene, camera and controls work. P2 replaces it with the real room.
 */

import * as THREE from "three";
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
 * Replace the canvas with a message (SPEC.md 8.8).
 *
 * @param {HTMLCanvasElement} canvas
 */
function showNoWebgl(canvas) {
  const message = document.createElement("div");
  message.className = "planner-message";
  message.setAttribute("role", "alert");
  message.textContent = NO_WEBGL_MESSAGE;
  canvas.replaceWith(message);
}

/**
 * P1 placeholder: a box the size of the twin XL bed (40 × 84 × 36 in) on a
 * floor grid with a line every 12 in.
 *
 * @returns {THREE.Group}
 */
function makeTestScene() {
  const group = new THREE.Group();

  // BoxGeometry is centred on its origin, so lift it by half its height to
  // stand it on the floor (y = 0).
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(40, 36, 84),
    new THREE.MeshStandardMaterial({ color: 0xb8875a }),
  );
  box.position.y = 18;
  group.add(box);

  // GridHelper(size, divisions): 120 in across, 10 divisions = one per foot.
  group.add(new THREE.GridHelper(120, 10, 0x8a8f99, 0xc4c9d1));
  return group;
}

const plannerElement = document.querySelector("#planner");
const canvas = document.querySelector("#scene");
// Used from P4 on, to load the room (config.typeId) and saved layouts.
const config = readConfig(plannerElement); // eslint-disable-line no-unused-vars

if (!webglAvailable()) {
  showNoWebgl(canvas);
} else {
  try {
    const view = createScene(canvas);
    const testScene = makeTestScene();
    view.scene.add(testScene);
    view.fitCamera(new THREE.Box3().setFromObject(testScene));
  } catch (error) {
    // Creating the renderer can still fail (e.g. the graphics driver refuses).
    console.error(error);
    showNoWebgl(canvas);
  }
}
