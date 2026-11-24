/**
 * Pointer and keyboard interaction (SPEC.md 8.5). Claire.
 *
 * Picking uses a Raycaster: it shoots an invisible ray from the camera
 * through the point under the pointer and lists what the ray hits, nearest
 * first. Dragging then follows the pointer across an invisible flat plane at
 * the height where the item was grabbed, so items slide along the floor and
 * never lift off it.
 *
 * Pointer events cover mouse, pen and touch alike; the canvas has
 * `touch-action: none` (planner.css) so a finger drag moves furniture
 * instead of scrolling the page.
 */

import * as THREE from "three";
import { arrowDirection } from "./roomMath.js";

const CLICK_TOLERANCE = 5;   // pixels a press may wander and still count as a click
const SMALL_STEP = 1;        // inches per arrow key press
const BIG_STEP = 6;          // inches per Shift + arrow

/**
 * @param {{canvas: HTMLCanvasElement, camera: THREE.Camera,
 *   controls: import("three/addons/OrbitControls.js").OrbitControls,
 *   layout: ReturnType<import("./layout.js").createLayout>}} options
 */
export function attachInteraction({ canvas, camera, controls, layout }) {
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const dragPlane = new THREE.Plane();
  const hit = new THREE.Vector3();
  let drag = null;       // { entry, offsetX, offsetZ, pointerId } while dragging
  let pressedAt = null;  // where a press on empty space started, to spot clicks

  /**
   * Point the raycaster from the camera through the pointer's position.
   * Screen pixels are turned into -1..1 "normalized device coordinates",
   * which is what three.js expects (y points up there, so it's flipped).
   * @param {PointerEvent} event
   */
  function aim(event) {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
  }

  /**
   * The furniture entry under the pointer, and where the ray hit it.
   * A hit may be on a child (the box or its label), so we climb to the
   * group that carries the entry.
   * @returns {{entry: object, point: THREE.Vector3} | null}
   */
  function pick(event) {
    aim(event);
    for (const intersection of raycaster.intersectObjects(layout.pickables(), true)) {
      for (let object = intersection.object; object; object = object.parent) {
        if (object.userData.entry) {
          return { entry: object.userData.entry, point: intersection.point };
        }
      }
    }
    return null;
  }

  // Registered in the capture phase so it runs before OrbitControls' own
  // listener: if the press lands on furniture, we switch the camera controls
  // off before they start turning the view.
  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) {
      return; // right-drag and middle-drag stay with the camera
    }
    const picked = pick(event);
    if (!picked) {
      pressedAt = { x: event.clientX, y: event.clientY };
      return;
    }
    const { entry, point } = picked;
    layout.select(entry);
    // A horizontal plane through the grab point: normal (0, 1, 0), and
    // `constant` is minus the height.
    dragPlane.set(new THREE.Vector3(0, 1, 0), -point.y);
    drag = {
      entry,
      offsetX: point.x - entry.placement.x,
      offsetZ: point.z - entry.placement.y,
      pointerId: event.pointerId,
    };
    controls.enabled = false;
    // Pointer capture keeps the moves coming to us even if the pointer
    // leaves the canvas mid-drag.
    canvas.setPointerCapture(event.pointerId);
  }, { capture: true });

  canvas.addEventListener("pointermove", (event) => {
    if (!drag || event.pointerId !== drag.pointerId) {
      return;
    }
    aim(event);
    if (raycaster.ray.intersectPlane(dragPlane, hit)) {
      // Plan x = three.js x, plan y = three.js z (SPEC.md 4.1).
      layout.moveTo(drag.entry, hit.x - drag.offsetX, hit.z - drag.offsetZ);
    }
  });

  function endDrag(event) {
    if (drag && event.pointerId === drag.pointerId) {
      drag = null;
      controls.enabled = true;
      if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
      return;
    }
    // A press on empty space that barely moved is a click: clear the
    // selection. (A longer drag was the camera orbiting; leave it alone.)
    if (pressedAt && Math.hypot(event.clientX - pressedAt.x, event.clientY - pressedAt.y) < CLICK_TOLERANCE) {
      layout.select(null);
    }
    pressedAt = null;
  }
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);

  window.addEventListener("keydown", (event) => onKey(event, camera, controls, layout));
}

/**
 * Keyboard shortcuts: R turns, Delete/Backspace removes, arrows move (Shift
 * for bigger steps), Escape clears the selection.
 *
 * @param {KeyboardEvent} event
 */
function onKey(event, camera, controls, layout) {
  // Never steal keys from a text box or dropdown, e.g. the layout name in P6.
  if (event.target.closest?.("input, textarea, select, [contenteditable]")) {
    return;
  }
  const entry = layout.selected();
  if (event.key === "Escape") {
    layout.select(null);
    return;
  }
  if (!entry || event.ctrlKey || event.metaKey || event.altKey) {
    return;
  }
  if (event.key === "r" || event.key === "R") {
    layout.rotate(entry);
  } else if (event.key === "Delete" || event.key === "Backspace") {
    layout.remove(entry);
  } else if (event.key.startsWith("Arrow")) {
    const forward = new THREE.Vector3().subVectors(controls.target, camera.position);
    const [dx, dy] = arrowDirection(event.key, [forward.x, forward.z]);
    const step = event.shiftKey ? BIG_STEP : SMALL_STEP;
    layout.moveTo(entry, entry.placement.x + dx * step, entry.placement.y + dy * step, { flush: false });
  } else {
    return;
  }
  event.preventDefault(); // stop arrows scrolling the page and Backspace going back
}
