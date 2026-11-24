/**
 * Furniture shapes (SPEC.md 8.4, Better tier): each catalog item drawn as
 * the thing it is, built from simple boxes and cylinders. No 3D model files.
 * Claire.
 *
 * Every shape fits exactly inside the item's catalog width × depth × height,
 * so the placement rules (rules.js), which only see the footprint, still
 * hold. Shapes are built in the item's own space:
 *   x across the width (centred), y up from the floor, z along the depth
 *   (centred), with the FRONT facing +z (SPEC.md 4.4: front faces +y in plan).
 *
 * The catalog colour is the main material (wood, fabric, plastic), so
 * changing a colour in the catalog editor still shows. Items with no shape
 * here (custom "will it fit" items, new catalog entries) are plain boxes.
 */

import * as THREE from "three";

const LINEN = "#f2eee6";
const PILLOW = "#fbf9f4";
const THROW = "#a51c30";      // a crimson blanket on the bed
const METAL = "#5d6168";
const HANDLE = "#2f2b2d";
const SHADE = "#f3e3c3";
const BOOK_COLORS = ["#a51c30", "#2f5d8a", "#d9a441", "#3c6e47", "#6b4f8a", "#e8e2d6", "#1f1b1d"];

/** @returns {THREE.Color} `color` lightened towards white by t (0..1) */
function lighten(color, t) {
  return new THREE.Color(color).lerp(new THREE.Color("#ffffff"), t);
}

/** @returns {THREE.Color} `color` darkened towards black by t (0..1) */
function darken(color, t) {
  return new THREE.Color(color).multiplyScalar(1 - t);
}

/**
 * A small helper that adds parts to a group. Each part gets its own material
 * (so tinting one item orange never tints another) and remembers its colour
 * in userData.baseColor (so furniture.setIssueTint can switch back).
 */
function partsOf(group) {
  function add(mesh, color, x, y, z) {
    mesh.position.set(x, y, z);
    mesh.userData.baseColor = new THREE.Color(color);
    group.add(mesh);
    return mesh;
  }
  return {
    /** A box w × h × d with its bottom centre at (x, y, z). */
    box(w, h, d, color, x = 0, y = 0, z = 0, options = {}) {
      const material = new THREE.MeshStandardMaterial({ color, roughness: 0.75, ...options });
      return add(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material), color, x, y + h / 2, z);
    },
    /** An upright cylinder (or cone, if the radii differ) with its bottom centre at (x, y, z). */
    cylinder(radiusTop, radiusBottom, h, color, x = 0, y = 0, z = 0, options = {}, openEnded = false) {
      const geometry = new THREE.CylinderGeometry(radiusTop, radiusBottom, h, 28, 1, openEnded);
      const material = new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...options });
      return add(new THREE.Mesh(geometry, material), color, x, y + h / 2, z);
    },
  };
}

/** Bed: legs up to the under-bed clearance, a frame, mattress, pillow, crimson throw and headboard. */
function bed({ width: w, depth: d, height: h, clearance, color }, part) {
  const under = Math.min(clearance || h * 0.35, h * 0.6);   // free space underneath (rule 4)
  const leg = 2.5;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      part.box(leg, under, leg, darken(color, 0.2), sx * (w / 2 - leg / 2), 0, sz * (d / 2 - leg / 2));
    }
  }
  part.box(w, 3, d - 2, color, 0, under, 1);                        // side rails and slats
  part.box(w, h, 2, darken(color, 0.12), 0, 0, -d / 2 + 1);         // headboard at the back
  const mattress = Math.max(2, Math.min(8, h - under - 3 - 4));
  const top = under + 3;
  part.box(w - 1.5, mattress, d - 3.5, LINEN, 0, top, 1);
  part.box(w * 0.7, Math.min(4, h - top - mattress), 12, PILLOW, 0, top + mattress, -d / 2 + 9);
  part.box(w - 1, 0.8, d * 0.5, THROW, 0, top + mattress, d / 2 - d * 0.25 - 1.5);
}

/** Desk: a top on legs, with a drawer pedestal on the right. */
function desk({ width: w, depth: d, height: h, color }, part) {
  const top = 1.5;
  const legHeight = h - top;
  part.box(w, top, d, color, 0, legHeight, 0);
  for (const sz of [-1, 1]) {
    part.box(1.5, legHeight, 1.5, darken(color, 0.15), -w / 2 + 0.75, 0, sz * (d / 2 - 0.75));
  }
  const pw = Math.min(16, w * 0.38);                                // pedestal width
  const px = w / 2 - pw / 2;
  part.box(pw, legHeight, d - 1, darken(color, 0.08), px, 0, -0.5);
  const drawer = (legHeight - 1) / 3;
  for (let i = 0; i < 3; i++) {
    const y = 0.5 + i * drawer;
    part.box(pw - 1.5, drawer - 0.6, 0.5, lighten(color, 0.08), px, y + 0.3, d / 2 - 0.75);
    part.box(3, 0.7, 0.4, HANDLE, px, y + drawer / 2, d / 2 - 0.2);
  }
}

/** Desk chair: seat and backrest on a post with a four-spoke base. */
function chair({ width: w, depth: d, height: h, color }, part) {
  const seat = h * 0.5;
  part.box(w - 1, 2.5, d - 2, color, 0, seat - 2.5, 1);             // seat, towards the front
  part.box(w - 3, h - seat - 1, 2, color, 0, seat + 1, -d / 2 + 1); // backrest at the back
  part.box(1.5, 4, 1.5, METAL, 0, seat - 1, -d / 2 + 1.5);         // backrest support
  part.cylinder(0.9, 0.9, seat - 5.5, METAL, 0, 3, 0.5);           // gas lift post
  const spoke = Math.min(w, d) - 1;
  for (const angle of [Math.PI / 4, -Math.PI / 4]) {
    part.box(spoke, 1.2, 1.6, METAL, 0, 1.4, 0.5).rotation.y = angle;
  }
  const reach = (spoke / 2) * Math.SQRT1_2;                         // spoke ends, turned 45°
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    part.cylinder(0.9, 0.9, 1.4, HANDLE, sx * reach, 0, 0.5 + sz * reach);
  }
}

/** Dresser: body on a plinth with a lighter top and drawers with knobs. */
function dresser({ width: w, depth: d, height: h, color }, part, drawers = 5) {
  part.box(w - 2, 2, d - 2, darken(color, 0.3), 0, 0, -0.5);       // plinth
  part.box(w, h - 2, d - 0.8, color, 0, 2, -0.4);                  // body
  part.box(w, 1.2, d - 0.8, lighten(color, 0.12), 0, h - 1.2, -0.4);
  const drawer = (h - 5) / drawers;
  for (let i = 0; i < drawers; i++) {
    const y = 3 + i * drawer;
    part.box(w - 2, drawer - 0.8, 0.6, lighten(color, 0.06), 0, y + 0.4, d / 2 - 0.5);
    const knobs = w > 24 ? [-w / 4, w / 4] : [0];
    for (const kx of knobs) {
      part.box(2.5, 0.8, 0.4, HANDLE, kx, y + drawer / 2, d / 2 - 0.2);
    }
  }
}

/** Bookcase: open shelves with a few books on each. */
function bookcase({ width: w, depth: d, height: h, color }, part) {
  const t = 1;
  for (const sx of [-1, 1]) {
    part.box(t, h, d, color, sx * (w / 2 - t / 2), 0, 0);
  }
  part.box(w - 2 * t, h, 0.5, darken(color, 0.15), 0, 0, -d / 2 + 0.25);   // back panel
  part.box(w - 2 * t, 2.5, d, darken(color, 0.1), 0, 0, 0);                 // kick plate
  part.box(w - 2 * t, t, d, color, 0, h - t, 0);                            // top
  const compartments = Math.max(2, Math.round(h / 13));
  const gap = (h - 2.5 - t) / compartments;
  for (let k = 0; k < compartments; k++) {
    const floor = 2.5 + k * gap;
    if (k > 0) part.box(w - 2 * t, 0.8, d - 0.5, color, 0, floor, 0.25);   // shelf
    // A row of books along the left of each shelf, colours and sizes varying
    // in a fixed pattern so every bookcase looks the same on every visit.
    let x = -w / 2 + t + 0.6;
    for (let b = 0; x < w * 0.15; b++) {
      const bookWidth = 1.2 + ((k * 3 + b) % 4) * 0.35;
      const bookHeight = gap * (0.62 + (((k + b) * 7) % 5) * 0.05);
      part.box(bookWidth, bookHeight, d * 0.7, BOOK_COLORS[(k * 2 + b) % BOOK_COLORS.length],
        x + bookWidth / 2, floor + 0.8, -d / 2 + 0.5 + d * 0.35);
      x += bookWidth + 0.15;
    }
  }
}

/** Wardrobe: tall body on a plinth with two doors and long handles. */
function wardrobe({ width: w, depth: d, height: h, color }, part) {
  part.box(w - 1, 3, d - 1, darken(color, 0.3), 0, 0, 0);
  part.box(w, h - 3, d - 0.8, color, 0, 3, -0.4);
  part.box(w, 1.5, d - 0.8, lighten(color, 0.1), 0, h - 1.5, -0.4);
  const door = (w - 1.5) / 2 - 0.25;
  for (const sx of [-1, 1]) {
    part.box(door, h - 6, 0.6, lighten(color, 0.05), sx * (door / 2 + 0.25), 4, d / 2 - 0.5);
    part.box(0.6, 9, 0.4, HANDLE, sx * 1.6, h * 0.55 - 4.5, d / 2 - 0.2);
  }
}

/** Floor lamp: round base, thin pole, glowing shade. */
function floorLamp({ width: w, depth: d, height: h }, part) {
  const radius = Math.min(w, d) / 2;
  const shade = Math.min(12, h * 0.25);
  part.cylinder(radius * 0.85, radius * 0.9, 1.2, HANDLE, 0, 0, 0);
  part.cylinder(0.45, 0.45, h - shade - 1.2, METAL, 0, 1.2, 0);
  // An open cone, lit from inside (emissive) so the lamp reads as on.
  part.cylinder(radius * 0.55, radius * 0.98, shade, SHADE, 0, h - shade, 0,
    { emissive: "#ffd99a", emissiveIntensity: 0.5, side: THREE.DoubleSide }, true);
}

/** Rug: a thin base with a lighter border panel and a centre motif. */
function rug({ width: w, depth: d, height: h, color }, part) {
  const base = Math.min(h, 0.6);
  part.box(w, base, d, color, 0, 0, 0);
  part.box(w - 6, 0.05, d - 6, lighten(color, 0.25), 0, base, 0);
  part.box(w * 0.4, 0.05, d * 0.3, darken(color, 0.1), 0, base + 0.05, 0);
}

/** Mini fridge: body, door with a freezer line, and a handle. */
function miniFridge({ width: w, depth: d, height: h, color }, part) {
  part.box(w - 1, 1, d - 2, HANDLE, 0, 0, -0.5);
  part.box(w, h - 1, d - 1, color, 0, 1, -0.5);
  part.box(w - 0.6, h - 2, 0.5, lighten(color, 0.08), 0, 1.5, d / 2 - 0.75);
  part.box(w - 1, 0.3, 0.3, darken(color, 0.25), 0, h * 0.72, d / 2 - 0.35);
  part.box(0.8, h * 0.35, 0.4, HANDLE, w / 2 - 2.5, h * 0.3, d / 2 - 0.2);
}

/** Futon: wooden frame and arms, seat and back cushions in the catalog colour. */
function futon({ width: w, depth: d, height: h, color }, part) {
  const wood = "#8b6a4a";
  const base = h * 0.3;
  part.box(w - 6, base, d, wood, 0, 0, 0);
  for (const sx of [-1, 1]) {
    part.box(3, h * 0.62, d, darken(wood, 0.1), sx * (w / 2 - 1.5), 0, 0);
  }
  part.box(w - 6, h * 0.2, d * 0.68, color, 0, base, d / 2 - d * 0.34);           // seat cushion
  part.box(w - 6, h - base, d * 0.3, darken(color, 0.08), 0, base, -d / 2 + d * 0.15); // back cushion
}

/** Storage bin: see-through plastic tub with a darker lid. */
function storageBin({ width: w, depth: d, height: h, color }, part) {
  part.box(w - 1, h - 1.5, d - 1, color, 0, 0, 0, { transparent: true, opacity: 0.78 });
  part.box(w, 1.5, d, darken(color, 0.25), 0, h - 1.5, 0);
}

// Shapes by catalog slug (seed/furniture.json).
const SHAPES = {
  "bed-twin-xl": bed,
  desk,
  "desk-chair": chair,
  dresser,
  bookcase,
  wardrobe,
  "floor-lamp": floorLamp,
  "rug-5x8": rug,
  "mini-fridge": miniFridge,
  futon,
  "storage-bin": storageBin,
};

/**
 * Build an item's shape, or null if there's no shape for it (then the caller
 * draws a plain box).
 *
 * @param {{slug: string | null, width: number, depth: number, height: number,
 *   clearance: number, color: string}} item - from rules.itemDimensions()
 * @returns {THREE.Group | null}
 */
export function buildShape(item) {
  const build = SHAPES[item.slug];
  if (!build) {
    return null;
  }
  const group = new THREE.Group();
  build(item, partsOf(group));
  return group;
}
