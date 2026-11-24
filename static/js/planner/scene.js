/**
 * The 3D stage: renderer, camera, lights, orbit controls, resizing and
 * on-demand rendering (SPEC.md 8.2). Knows nothing about rooms or furniture;
 * other modules add objects to `scene` and call requestRender().
 *
 * three.js in four ideas:
 *   - A Scene holds objects (meshes, lights) positioned in 3D space.
 *   - A Camera says where we look from and how wide the view is.
 *   - A Renderer draws the scene, as seen by the camera, onto a <canvas>
 *     using WebGL (the browser's interface to the graphics card).
 *   - A Mesh is geometry (a shape) plus a material (how its surface looks).
 *
 * Units: 1 three.js unit = 1 inch. y points up and the floor is y = 0. Plan
 * x is three.js x, and plan y (south) is three.js z (SPEC.md 4.1).
 */

import * as THREE from "three";
// OrbitControls is an add-on, not part of three.js core. The import map in
// layout.html maps "three/addons/" to static/vendor/three/.
import { OrbitControls } from "three/addons/OrbitControls.js";

const FIELD_OF_VIEW = 35;           // degrees, top to bottom (SPEC.md 8.2)
const MAX_PIXEL_RATIO = 2;          // sharper on retina screens, but capped for speed
const BACKGROUND = 0x161318;        // near-black, matches .planner-scene in planner.css
// The camera may tilt down to straight overhead (0) but stops just above the
// horizon, so it never looks up from under the floor.
const MAX_POLAR_ANGLE = Math.PI / 2 - 0.05;
// Where the camera sits relative to the room when fitted: to the south-east
// and above, looking north-west (so the north wall is at the back).
const VIEW_DIRECTION = new THREE.Vector3(0.55, 0.75, 1).normalize();

/**
 * Return true if this browser can run three.js. three.js 0.170 needs WebGL 2.
 *
 * @returns {boolean}
 */
export function webglAvailable() {
  try {
    const testCanvas = document.createElement("canvas");
    return Boolean(window.WebGL2RenderingContext && testCanvas.getContext("webgl2"));
  } catch {
    return false;
  }
}

/**
 * Set up everything needed to draw 3D on `canvas`.
 *
 * @param {HTMLCanvasElement} canvas - must sit inside a sized container
 * @returns {{scene: THREE.Scene, camera: THREE.PerspectiveCamera,
 *   renderer: THREE.WebGLRenderer, controls: OrbitControls,
 *   requestRender: () => void, fitCamera: (box: THREE.Box3) => void,
 *   addFrameCallback: (callback: (camera: THREE.Camera) => void) => void}}
 */
export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BACKGROUND);
  addLights(scene);

  // Aspect ratio 1 for now; resize() sets the real one. near/far are set by fitCamera().
  const camera = new THREE.PerspectiveCamera(FIELD_OF_VIEW, 1, 1, 10000);
  const controls = createControls(camera, canvas);
  const panBounds = new THREE.Box3();

  // Functions other modules want run just before each frame is drawn (e.g. the
  // dollhouse walls and wall labels, which depend on where the camera is).
  const frameCallbacks = [];

  /**
   * Run `callback(camera)` just before every frame is drawn.
   * @param {(camera: THREE.Camera) => void} callback
   */
  function addFrameCallback(callback) {
    frameCallbacks.push(callback);
    requestRender();
  }

  // --- Render on demand ------------------------------------------------------
  // Instead of redrawing 60 times a second forever, we draw a frame only when
  // asked. requestAnimationFrame() runs our function just before the browser
  // next paints the screen; the flag stops us asking twice for the same frame.
  let frameRequested = false;

  function requestRender() {
    if (!frameRequested) {
      frameRequested = true;
      requestAnimationFrame(renderFrame);
    }
  }

  function renderFrame() {
    frameRequested = false;
    // With damping, the camera keeps gliding for a moment after you let go.
    // update() moves it one step and fires "change", which requests the next
    // frame, so frames keep coming until the motion stops on its own.
    controls.update();
    keepTargetInBounds(controls, camera, panBounds);
    frameCallbacks.forEach((callback) => callback(camera));
    renderer.render(scene, camera);
  }

  controls.addEventListener("change", requestRender);

  // --- Resizing --------------------------------------------------------------
  // A ResizeObserver calls us whenever the canvas's container changes size
  // (window resized, phone rotated, panel collapsed), not only on window resize.
  function resize() {
    const { clientWidth: width, clientHeight: height } = canvas.parentElement;
    if (width === 0 || height === 0) {
      return;
    }
    renderer.setSize(width, height, false); // false: CSS already sizes the canvas
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    requestRender();
  }
  new ResizeObserver(resize).observe(canvas.parentElement);
  resize();

  /**
   * Point the camera at a box (usually the room) and back off until all of it
   * fits on screen. Also limits zoom and panning to sensible distances.
   *
   * @param {THREE.Box3} box
   */
  function fitCamera(box) {
    const center = box.getCenter(new THREE.Vector3());
    const radius = box.getSize(new THREE.Vector3()).length() / 2;
    // Distance at which a sphere of this radius just fits in the field of
    // view (basic trigonometry), plus 10% margin.
    const halfFov = THREE.MathUtils.degToRad(FIELD_OF_VIEW / 2);
    const distance = (radius / Math.sin(halfFov)) * 1.1;

    controls.target.copy(center); // orbit around the middle of the room, half way up
    camera.position.copy(controls.target).addScaledVector(VIEW_DIRECTION, distance);
    camera.near = distance / 100;
    camera.far = distance * 10;
    camera.updateProjectionMatrix();

    controls.minDistance = radius * 0.4;
    controls.maxDistance = distance * 2.5;
    // Panning may slide the orbit centre sideways anywhere over the floor, at
    // the same height, but not beyond the room.
    panBounds.set(
      new THREE.Vector3(box.min.x, center.y, box.min.z),
      new THREE.Vector3(box.max.x, center.y, box.max.z),
    );
    controls.update();
    requestRender();
  }

  return { scene, camera, renderer, controls, requestRender, fitCamera, addFrameCallback };
}

/**
 * Light the scene: soft light from all around plus one light from above.
 * No shadows in the Good tier (SPEC.md 8.2).
 *
 * @param {THREE.Scene} scene
 */
function addLights(scene) {
  // Sky colour from above, ground colour from below, blended by surface angle.
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f99, 2.2));
  // Like sunlight: parallel rays from one direction, so tops are brighter than sides.
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(0.4, 1, 0.3);
  scene.add(sun);
}

/**
 * Create OrbitControls: drag to turn the camera around a target point,
 * scroll or pinch to zoom, right-drag or two-finger drag to pan.
 *
 * @param {THREE.Camera} camera
 * @param {HTMLCanvasElement} canvas
 * @returns {OrbitControls}
 */
function createControls(camera, canvas) {
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;          // glide to a stop instead of halting
  controls.maxPolarAngle = MAX_POLAR_ANGLE;
  controls.screenSpacePanning = false;    // pan along the floor, not up through the ceiling
  return controls;
}

/**
 * If panning moved the orbit centre off the floor, slide target and camera
 * back together so the view keeps its angle (SPEC.md 8.2: no panning beyond
 * the room).
 *
 * @param {OrbitControls} controls
 * @param {THREE.Camera} camera
 * @param {THREE.Box3} bounds - empty until fitCamera() runs
 */
function keepTargetInBounds(controls, camera, bounds) {
  if (bounds.isEmpty()) {
    return;
  }
  const clamped = controls.target.clone().clamp(bounds.min, bounds.max);
  const shift = clamped.sub(controls.target);
  if (shift.lengthSq() > 0) {
    controls.target.add(shift);
    camera.position.add(shift);
  }
}
