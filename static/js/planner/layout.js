/**
 * The furniture in the room and which item is selected (Claire).
 *
 * This is the single source of truth: every change (add, move, turn,
 * delete, select) goes through these functions, which update the 3D scene
 * and then tell every listener (the side panel now; the "Unsaved changes"
 * note in P6) that something changed.
 *
 * Each entry is { placement, item, group }: the placement in the SPEC.md
 * 4.4 format, the item's size and colour (rules.itemDimensions), and its
 * three.js group (furniture.makeFurniture).
 */

import * as THREE from "three";
import { makeFurniture } from "./furniture.js";
import { findFreeSpot, footprint, footprintBox, itemDimensions, snap, zones } from "./rules.js";

const SELECTION_COLOR = 0xa51c30;  // crimson (SPEC.md 8.4)
const SELECTION_MARGIN = 1.5;      // inches between the item and its outline

/**
 * @param {{outline: number[][]}} geometry - the room
 * @param {Map<number, object>} catalogById - /api/furniture rows by id
 * @param {THREE.Scene} scene
 * @param {() => void} requestRender
 */
export function createLayout(geometry, catalogById, scene, requestRender) {
  const { outline } = geometry;
  const furniture = new THREE.Group();
  scene.add(furniture);
  const outlineMesh = makeSelectionOutline();
  scene.add(outlineMesh);

  let entries = [];
  let selected = null;
  const listeners = [];

  /** Tell the scene and every listener that something changed. */
  function changed() {
    updateSelectionOutline(outlineMesh, selected);
    requestRender();
    listeners.forEach((listener) => listener());
  }

  /**
   * Add a placement to the room (no change notification; callers decide).
   * @returns {object | null} the new entry, or null if its item is unknown
   */
  function addEntry(placement) {
    const item = itemDimensions(placement, catalogById);
    if (!item) {
      console.warn("Skipping a placement whose furniture is no longer in the catalog:", placement);
      return null;
    }
    const entry = { placement, item, group: makeFurniture(placement, item) };
    entry.group.userData.entry = entry; // lets a click on the box find its entry
    furniture.add(entry.group);
    entries.push(entry);
    return entry;
  }

  /** Rebuild an entry's 3D group, e.g. after turning (its label may flip). */
  function rebuild(entry) {
    furniture.remove(entry.group);
    entry.group = makeFurniture(entry.placement, entry.item);
    entry.group.userData.entry = entry;
    furniture.add(entry.group);
  }

  // Door, closet and radiator zones: a new item shouldn't land in one. They
  // count as non-flat (height 2), so rugs, which never collide (rule 3), may.
  const zoneBlockers = zones(geometry).map((zone) => ({ box: zone.box, height: 2 }));

  /** Everything a newly added item should keep clear of, for findFreeSpot(). */
  function blockers() {
    return entries
      .map((entry) => ({ box: footprintBox(entry.placement, entry.item), height: entry.item.height }))
      .concat(zoneBlockers);
  }

  return {
    /** @returns {object[]} every entry (don't modify the array) */
    entries: () => entries,

    /** @returns {object | null} the selected entry */
    selected: () => selected,

    /** @param {() => void} listener - called after every change */
    onChange(listener) {
      listeners.push(listener);
    },

    /**
     * Replace everything with these placements (on load, or opening a saved layout).
     * @param {object[]} placements - SPEC.md 4.4
     */
    load(placements) {
      entries.forEach((entry) => furniture.remove(entry.group));
      entries = [];
      selected = null;
      placements.forEach((placement) => addEntry({ ...placement }));
      changed();
    },

    /**
     * Add a catalog item at the first free spot, and select it.
     * @param {object} catalogItem - a /api/furniture row
     */
    addFromCatalog(catalogItem) {
      const item = itemDimensions({ furniture_id: catalogItem.id }, catalogById);
      const spot = findFreeSpot(item, 0, outline, blockers());
      selected = addEntry({ furniture_id: catalogItem.id, x: spot.x, y: spot.y, rotation: 0 });
      changed();
    },

    /** @param {object | null} entry */
    select(entry) {
      if (entry !== selected) {
        selected = entry;
        changed();
      }
    },

    /**
     * Move an item towards (x, y); rules.snap() decides where it lands.
     * @param {object} entry
     * @param {number} x - plan inches
     * @param {number} y
     * @param {{flush?: boolean}} [options] - false for arrow keys (see rules.snap)
     */
    moveTo(entry, x, y, options = {}) {
      const spot = snap({ x, y }, entry.item, entry.placement.rotation, outline, options);
      if (spot.x === entry.placement.x && spot.y === entry.placement.y) {
        return; // nothing moved; skip the redraw
      }
      entry.placement.x = spot.x;
      entry.placement.y = spot.y;
      entry.group.position.set(spot.x, 0, spot.y);
      changed();
    },

    /**
     * Turn an item 90° clockwise, then snap it back inside if it now sticks out.
     * @param {object} entry
     */
    rotate(entry) {
      const placement = entry.placement;
      placement.rotation = (placement.rotation + 90) % 360;
      Object.assign(placement, snap(placement, entry.item, placement.rotation, outline, { flush: false }));
      rebuild(entry);
      changed();
    },

    /** @param {object} entry */
    remove(entry) {
      furniture.remove(entry.group);
      entries = entries.filter((other) => other !== entry);
      if (selected === entry) {
        selected = null;
      }
      changed();
    },

    /** @returns {THREE.Object3D[]} what the pointer can pick */
    pickables: () => furniture.children,
  };
}

/**
 * A crimson frame on the floor around the selected item (SPEC.md 8.4).
 * It's a flat shape with a hole rather than a line, because WebGL always
 * draws lines 1 pixel wide, which is hard to see from across the room.
 *
 * @returns {THREE.Mesh}
 */
function makeSelectionOutline() {
  const frame = new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.MeshBasicMaterial({ color: SELECTION_COLOR, side: THREE.DoubleSide }),
  );
  frame.rotation.x = -Math.PI / 2; // lie flat, like the floor
  frame.position.y = 0.5;          // just above the floor and the door-zone tint
  frame.visible = false;
  return frame;
}

const FRAME_WIDTH = 1.5; // inches

/**
 * Fit the frame around the selected entry, or hide it.
 *
 * @param {THREE.Mesh} frame
 * @param {object | null} entry
 */
function updateSelectionOutline(frame, entry) {
  frame.visible = entry !== null;
  if (!entry) {
    return;
  }
  const { halfX, halfY } = footprint(entry.item, entry.placement.rotation);
  const inX = halfX + SELECTION_MARGIN;
  const inY = halfY + SELECTION_MARGIN;
  const outX = inX + FRAME_WIDTH;
  const outY = inY + FRAME_WIDTH;
  // Drawn around (0, 0) in the shape's own plane, then placed at the item.
  const shape = new THREE.Shape([
    new THREE.Vector2(-outX, -outY), new THREE.Vector2(outX, -outY),
    new THREE.Vector2(outX, outY), new THREE.Vector2(-outX, outY),
  ]);
  shape.holes.push(new THREE.Path([
    new THREE.Vector2(-inX, -inY), new THREE.Vector2(-inX, inY),
    new THREE.Vector2(inX, inY), new THREE.Vector2(inX, -inY),
  ]));
  frame.geometry.dispose(); // free the old shape's memory on the graphics card
  frame.geometry = new THREE.ShapeGeometry(shape);
  frame.position.x = entry.placement.x;
  frame.position.z = entry.placement.y;
}
