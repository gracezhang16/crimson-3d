/**
 * The furniture in the room and which item is selected (Claire).
 *
 * This is the single source of truth: every change (add, move, turn,
 * delete, select) goes through these functions, which update the 3D scene
 * and then tell every listener (the side panel, the save controls) what
 * changed: { content: true } when the furniture itself changed (so there is
 * something new to save), { content: false } for selection-only changes and
 * for loading.
 *
 * Each entry is { placement, item, group, issue }: the placement in the
 * SPEC.md 4.4 format, the item's size and colour (rules.itemDimensions), its
 * three.js group (furniture.makeFurniture), and its issue from
 * rules.evaluate() ("Blocks the door", ...) or null if it fits.
 *
 * With an animator (animate.js), added items pop in and deleted ones shrink
 * away. Only their look is animated; the entries change straight away.
 */

import * as THREE from "three";
import { glide, popIn, shrinkAway } from "./animate.js";
import { makeFurniture, setGhost, setIssueTint, setLabelVisible } from "./furniture.js";
import {
  blockMove, evaluate, findFreeSpot, firstCollision, footprint, footprintBox, itemDimensions, nearestFreeSpot,
  snap, zones,
} from "./rules.js";

const SELECTION_COLOR = 0xa51c30;  // crimson (SPEC.md 8.4)
const SELECTION_MARGIN = 1.5;      // inches between the item and its outline

/**
 * @param {{rooms: {outline: number[][]}[]}} geometry - the suite
 * @param {Map<number, object>} catalogById - /api/furniture rows by id
 * @param {THREE.Scene} scene
 * @param {() => void} requestRender
 * @param {ReturnType<import("./animate.js").createAnimator> | null} [animator] - null: no animations
 */
export function createLayout(geometry, catalogById, scene, requestRender, animator = null) {
  // Every room's outline: items may go anywhere inside any room.
  const outlines = geometry.rooms.map((room) => room.outline);
  const furniture = new THREE.Group();
  scene.add(furniture);
  const outlineMesh = makeSelectionOutline();
  scene.add(outlineMesh);
  // Deleted items shrink away in here: in the scene, but not in `furniture`,
  // so they can't be clicked while they go.
  const leaving = new THREE.Group();
  scene.add(leaving);

  let entries = [];
  let selected = null;
  const listeners = [];

  /**
   * Tell the scene and every listener that something changed.
   * @param {boolean} content - true if the furniture changed, not just the selection
   */
  function changed(content) {
    // SPEC.md 8.5: after every change, re-run the rules and update the tints.
    // (A hundred items at most, so checking every pair each time is quick.)
    const issues = evaluate(geometry, entries);
    entries.forEach((entry, i) => {
      entry.issue = issues[i];
      setIssueTint(entry.group, entry.issue !== null);
      // Names show on the selected item, and always on custom "will it fit"
      // items, which are plain boxes that don't show what they are.
      setLabelVisible(entry.group, entry === selected || entry.item.slug === null);
    });
    updateSelectionOutline(outlineMesh, selected);
    requestRender();
    listeners.forEach((listener) => listener({ content }));
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

  /**
   * Every item except `entry`, as {box, item}: what blockMove() and
   * firstCollision() check against, so furniture can't be pushed into furniture.
   */
  function othersThan(entry) {
    return entries
      .filter((other) => other !== entry)
      .map((other) => ({ box: footprintBox(other.placement, other.item), item: other.item }));
  }

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

    /** @param {(change: {content: boolean}) => void} listener - called after every change */
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
      changed(false);
    },

    /**
     * Add a catalog item at the first free spot, and select it.
     * @param {object} catalogItem - a /api/furniture row
     */
    addFromCatalog(catalogItem) {
      const item = itemDimensions({ furniture_id: catalogItem.id }, catalogById);
      const spot = findFreeSpot(item, 0, outlines, blockers());
      selected = addEntry({ furniture_id: catalogItem.id, x: spot.x, y: spot.y, rotation: 0 });
      if (animator && selected) popIn(animator, selected.group);
      changed(true);
    },

    /**
     * Add a custom "will it fit" item (SPEC.md 4.4) at the first free spot,
     * and select it.
     * @param {{label: string, width: number, depth: number, height: number}} custom
     */
    addCustom(custom) {
      const size = { ...custom, clearance: 0 };
      const spot = findFreeSpot(size, 0, outlines, blockers());
      selected = addEntry({ furniture_id: null, ...custom, x: spot.x, y: spot.y, rotation: 0 });
      if (animator && selected) popIn(animator, selected.group);
      changed(true);
    },

    /** @param {object | null} entry */
    select(entry) {
      if (entry !== selected) {
        selected = entry;
        changed(false);
      }
    },

    /**
     * Move an item towards (x, y); rules.snap() decides where it lands.
     * @param {object} entry
     * @param {number} x - plan inches
     * @param {number} y
     * @param {{flush?: boolean, pass?: boolean}} [options] - flush: false for arrow
     *   keys (see rules.snap); pass: true while dragging, to glide over other
     *   furniture (settle() then finds it a free spot when it's let go)
     */
    moveTo(entry, x, y, options = {}) {
      const wanted = snap({ x, y }, entry.item, entry.placement.rotation, outlines, options);
      const others = othersThan(entry);
      // Other furniture is solid: stop against it and slide along it. While
      // dragging, pass over it instead, see-through while on top of something.
      const spot = options.pass ? wanted : blockMove(entry.placement, wanted, entry.item, entry.placement.rotation, others);
      if (options.pass) {
        const box = footprintBox({ ...spot, rotation: entry.placement.rotation }, entry.item);
        setGhost(entry.group, firstCollision(box, entry.item, others) !== null);
      }
      if (spot.x === entry.placement.x && spot.y === entry.placement.y) {
        return; // nothing moved; skip the redraw
      }
      entry.placement.x = spot.x;
      entry.placement.y = spot.y;
      entry.group.position.set(spot.x, 0, spot.y);
      changed(true);
    },

    /**
     * A dragged item was let go. If it's on top of furniture it can't share
     * space with, it moves to the nearest free spot (rules.nearestFreeSpot),
     * gliding there; if nothing nearby is free, back to where the drag began.
     *
     * @param {object} entry
     * @param {{x: number, y: number}} start - where the drag began
     */
    settle(entry, start) {
      setGhost(entry.group, false);
      if (entry.placement.x === start.x && entry.placement.y === start.y) {
        return; // only clicked, not moved: leave it alone, even if it overlaps something
      }
      const others = othersThan(entry);
      const { rotation } = entry.placement;
      if (firstCollision(footprintBox(entry.placement, entry.item), entry.item, others) === null) {
        return; // landed somewhere free: it stays exactly there
      }
      const spot = nearestFreeSpot(entry.placement, entry.item, rotation, outlines, others) ?? start;
      const from = { x: entry.group.position.x, z: entry.group.position.z };
      entry.placement.x = spot.x;
      entry.placement.y = spot.y;
      entry.group.position.set(spot.x, 0, spot.y);
      if (animator) glide(animator, entry.group, from);
      changed(true);
    },

    /**
     * Turn an item 90° clockwise, then snap it back inside if it now sticks out.
     * If the turned item would run into other furniture it stays as it was,
     * and listeners get a `note` saying why (the panel shows it).
     *
     * @param {object} entry
     * @returns {boolean} true if it turned
     */
    rotate(entry) {
      const placement = entry.placement;
      const rotation = (placement.rotation + 90) % 360;
      const spot = snap(placement, entry.item, rotation, outlines, { flush: false });
      const others = othersThan(entry);
      const before = footprintBox(placement, entry.item);
      // Only count items it doesn't overlap already, as in blockMove().
      const clear = others.filter((other) => firstCollision(before, entry.item, [other]) === null);
      const hit = firstCollision(footprintBox({ ...spot, rotation }, entry.item), entry.item, clear);
      if (hit) {
        const note = `No room to turn it here: it would hit the ${hit.name.charAt(0).toLowerCase()}${hit.name.slice(1)}.`;
        listeners.forEach((listener) => listener({ content: false, note }));
        return false;
      }
      placement.rotation = rotation;
      Object.assign(placement, spot);
      rebuild(entry);
      changed(true);
      return true;
    },

    /** @param {object} entry */
    remove(entry) {
      if (animator) {
        const { group } = entry;
        leaving.add(group); // add() also takes it out of `furniture`
        shrinkAway(animator, group, () => leaving.remove(group));
      } else {
        furniture.remove(entry.group);
      }
      entries = entries.filter((other) => other !== entry);
      if (selected === entry) {
        selected = null;
      }
      changed(true);
    },

    /** @returns {object[]} the placements, in the order they were placed */
    placements: () => entries.map((entry) => entry.placement),

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
