/**
 * Wall-length labels (SPEC.md 8.3): HTML labels such as 9′ 6″ floating above
 * the two full-height walls farthest from the camera.
 *
 * They are ordinary <div>s over the canvas, not 3D text. Each frame we
 * "project" each wall's 3D top-centre point through the camera, which gives
 * its position on screen, and move the label there. HTML text stays crisp and
 * readable at any zoom.
 */

import * as THREE from "three";
import { formatFeetInches } from "../shared/units.js";

const LABELLED_WALLS = 2;
const LIFT = 6; // inches above the wall top, so the label sits just over it

/**
 * Create one label per wall inside `container` (the element around the canvas).
 *
 * @param {HTMLElement} container
 * @param {{length: number}[]} roomWalls - from buildRoom()
 * @returns {{update: (camera: THREE.Camera) => void}}
 */
export function createWallLabels(container, roomWalls) {
  const labels = roomWalls.map((wall) => {
    const element = document.createElement("div");
    element.className = "wall-label";
    element.textContent = formatFeetInches(wall.length);
    element.hidden = true;
    container.append(element);
    return element;
  });
  const point = new THREE.Vector3();

  /**
   * Show labels on the farthest full-height walls and place them on screen.
   * Call after the room's update(), which decides which walls are stubs.
   * @param {THREE.Camera} camera
   */
  function update(camera) {
    const chosen = new Set(
      roomWalls
        .map((wall, i) => ({ i, wall, distance: wall.top.distanceTo(camera.position) }))
        .filter(({ wall }) => !wall.isStub)
        .sort((a, b) => b.distance - a.distance)
        .slice(0, LABELLED_WALLS)
        .map(({ i }) => i),
    );

    const { clientWidth: width, clientHeight: height } = container;
    roomWalls.forEach((wall, i) => {
      // project() turns a 3D point into screen coordinates from -1 to 1
      // (x right, y up); z above 1 means the point is behind the camera.
      point.copy(wall.top).setY(wall.top.y + LIFT).project(camera);
      const visible = chosen.has(i) && point.z < 1;
      labels[i].hidden = !visible;
      if (visible) {
        labels[i].style.left = `${((point.x + 1) / 2) * width}px`;
        labels[i].style.top = `${((1 - point.y) / 2) * height}px`;
      }
    });
  }

  return { update };
}
