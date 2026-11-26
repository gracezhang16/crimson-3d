/**
 * Rotate and Delete buttons floating just above the selected item in the 3D
 * view, so a student doesn't have to reach for the side panel (Claire).
 *
 * Like the wall labels (labels.js), the toolbar is an ordinary HTML element
 * over the canvas. Each frame we "project" the point just above the item's
 * top through the camera to find where it is on screen, and move the toolbar
 * there. It follows the item while it's dragged, and the view while it turns.
 *
 * The buttons do exactly what the panel's buttons do (layout.rotate and
 * layout.remove), so the rules, the "No room to turn it here" note and the
 * delete animation all work the same.
 */

import * as THREE from "three";

const LIFT = 4; // inches above the item's top, so the toolbar never covers it

/**
 * Wire up the #item-tools toolbar in `container` (the element around the canvas).
 *
 * @param {HTMLElement} container
 * @param {ReturnType<import("./layout.js").createLayout>} layout
 * @returns {{update: (camera: THREE.Camera) => void}}
 */
export function createItemTools(container, layout) {
  const toolbar = container.querySelector("#item-tools");
  const point = new THREE.Vector3();

  toolbar.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-tool]");
    const entry = layout.selected();
    if (!button || !entry) {
      return;
    }
    if (button.dataset.tool === "rotate") {
      layout.rotate(entry);
    } else if (button.dataset.tool === "delete") {
      layout.remove(entry);
    }
  });
  // Clicks on the toolbar are for its buttons, not for the 3D view under it.
  toolbar.addEventListener("pointerdown", (event) => event.stopPropagation());

  /**
   * Put the toolbar above the selected item, or hide it. Called every frame.
   * @param {THREE.Camera} camera
   */
  function update(camera) {
    const entry = layout.selected();
    if (!entry) {
      toolbar.hidden = true;
      return;
    }
    const { group, item } = entry;
    // project() turns a 3D point into screen coordinates from -1 to 1
    // (x right, y up); z above 1 means the point is behind the camera.
    point.set(group.position.x, group.position.y + item.height + LIFT, group.position.z).project(camera);
    const x = ((point.x + 1) / 2) * container.clientWidth;
    const y = ((1 - point.y) / 2) * container.clientHeight;
    const onScreen = point.z < 1 && x >= 0 && x <= container.clientWidth && y >= 0 && y <= container.clientHeight;
    toolbar.hidden = !onScreen;
    if (onScreen) {
      toolbar.style.left = `${x}px`;
      toolbar.style.top = `${y}px`;
    }
  }

  return { update };
}
