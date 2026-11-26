/**
 * Drawing a room's outline with the mouse on the builder preview (A8). Hannah.
 *
 * While drawing, this module owns the preview <svg>: it draws the suite's
 * other rooms faintly, a grid, the corners placed so far and a guide line
 * from the last corner to the pointer. The pure rules (snapping, right angles,
 * closing, crossing walls) are in outline.js.
 *
 * Mouse position -> plan inches: the <svg> shows plan inches through its
 * viewBox, so the browser already knows how to turn inches into screen
 * pixels. getScreenCTM() returns that transformation as a matrix, and its
 * inverse turns a click's screen position back into inches.
 *
 * Keys while drawing: Backspace undoes the last corner, Escape cancels.
 * Drawing needs a mouse, a pen or a finger; walking the walls is the
 * keyboard-only way to describe the same room.
 */

import { formatFeetInches } from "../shared/units.js";
import { wallLetter } from "../shared/geometry.js";
import { addCorner, closeShape, rightAngle, SNAP, snapPoint } from "./outline.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const GRID_LINE = 12;          // inches between grid lines (corners still snap every 6)
const MIN_VIEW = [360, 270];   // inches shown at least: 30 × 22½ ft, the preview's 4:3
const VIEW_MARGIN = 60;        // inches of room to draw around what's already there
const CLOSE_DISTANCE = 9;      // inches: a click this close to the first corner closes the shape

/**
 * Create an SVG element with attributes.
 * @param {string} tag
 * @param {Object<string, string | number>} attributes
 * @returns {SVGElement}
 */
function svgElement(tag, attributes) {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, value);
  }
  return element;
}

/**
 * The area to show while drawing: everything already in the suite plus a
 * margin, at least MIN_VIEW, starting at the suite's north-west corner (0, 0).
 *
 * @param {number[][]} points
 * @returns {{x: number, y: number, width: number, height: number}}
 */
function drawingView(points) {
  const xs = [0, ...points.map(([x]) => x)];
  const ys = [0, ...points.map(([, y]) => y)];
  const width = Math.max(MIN_VIEW[0], Math.max(...xs) + 2 * VIEW_MARGIN);
  const height = Math.max(MIN_VIEW[1], Math.max(...ys) + 2 * VIEW_MARGIN);
  return { x: -VIEW_MARGIN / 2, y: -VIEW_MARGIN / 2, width, height };
}

/**
 * Start drawing on `svg`.
 *
 * @param {SVGSVGElement} svg
 * @param {object} options
 * @param {{name: string, outline: number[][]}[]} options.others - the suite's other rooms, drawn faintly
 * @param {(text: string, isError?: boolean) => void} options.hint - shows instructions under the preview
 * @param {(outline: number[][]) => void} options.onClose - called with the closed, clockwise outline
 * @param {() => void} options.onCancel
 * @returns {{undo: () => void, cancel: () => void, stop: () => void}}
 */
export function startDrawing(svg, { others, hint, onClose, onCancel }) {
  let corners = [];
  let pointer = null;   // the snapped, right-angled point under the pointer
  let view = drawingView(others.flatMap((room) => room.outline));

  /** Where an event happened, in plan inches (see the comment at the top). */
  function planPoint(event) {
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(svg.getScreenCTM().inverse());
    return [point.x, point.y];
  }

  /** True if `raw` (unsnapped inches) is close enough to the first corner to close the shape. */
  function closesShape(raw) {
    return corners.length >= 3 && Math.hypot(raw[0] - corners[0][0], raw[1] - corners[0][1]) <= CLOSE_DISTANCE;
  }

  function instructions() {
    if (corners.length === 0) return "Click where the room's first corner goes. Corners snap to a 6 in grid.";
    if (corners.length < 3) return "Click the next corner. Walls run straight north, south, east or west.";
    return "Click the next corner, or click the first corner (circled) to close the shape.";
  }

  /** Grow the view if a corner lands near its edge, so there is room to carry on. */
  function growView(point) {
    const right = view.x + view.width - VIEW_MARGIN / 2;
    const bottom = view.y + view.height - VIEW_MARGIN / 2;
    if (point[0] > right || point[1] > bottom) {
      view = drawingView([...others.flatMap((room) => room.outline), ...corners]);
    }
  }

  function render() {
    svg.replaceChildren();
    svg.setAttribute("viewBox", `${view.x} ${view.y} ${view.width} ${view.height}`);
    const fontSize = view.width / 36;

    const grid = svgElement("g", { class: "preview-grid" });
    for (let x = 0; x <= view.x + view.width; x += GRID_LINE) {
      grid.append(svgElement("line", { x1: x, y1: view.y, x2: x, y2: view.y + view.height, "vector-effect": "non-scaling-stroke" }));
    }
    for (let y = 0; y <= view.y + view.height; y += GRID_LINE) {
      grid.append(svgElement("line", { x1: view.x, y1: y, x2: view.x + view.width, y2: y, "vector-effect": "non-scaling-stroke" }));
    }
    svg.append(grid);

    for (const room of others) {
      const points = room.outline.map((p) => p.join(",")).join(" ");
      svg.append(svgElement("polygon", { points, class: "draw-other-room", "vector-effect": "non-scaling-stroke" }));
    }

    // The walls placed so far, then the guide line to the pointer.
    const path = pointer ? [...corners, pointer] : corners;
    if (path.length > 1) {
      svg.append(svgElement("polyline", {
        points: corners.map((p) => p.join(",")).join(" "), class: "draw-walls", "vector-effect": "non-scaling-stroke",
      }));
      for (let i = 0; i < path.length - 1; i++) {
        const [a, b] = [path[i], path[i + 1]];
        const length = Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]);
        if (length === 0) continue;
        // East-west walls: label centred above. North-south walls: label just
        // to the right, starting at the wall, so it never sits on the line.
        const northSouth = a[0] === b[0];
        const label = svgElement("text", {
          x: (a[0] + b[0]) / 2 + (northSouth ? fontSize * 0.4 : 0),
          y: (a[1] + b[1]) / 2 - (northSouth ? 0 : fontSize * 0.4),
          "font-size": fontSize, class: "preview-label draw-label",
          "text-anchor": northSouth ? "start" : "middle", "dominant-baseline": northSouth ? "middle" : "auto",
        });
        const letter = svgElement("tspan", { class: "preview-letter" });
        letter.textContent = wallLetter(i);
        label.append(letter, ` ${formatFeetInches(length)}`);
        svg.append(label);
      }
    }
    if (pointer && corners.length) {
      svg.append(svgElement("line", {
        x1: corners.at(-1)[0], y1: corners.at(-1)[1], x2: pointer[0], y2: pointer[1],
        class: "draw-guide", "vector-effect": "non-scaling-stroke",
      }));
    }
    corners.forEach((corner, i) => {
      svg.append(svgElement("circle", {
        cx: corner[0], cy: corner[1], r: i === 0 && corners.length >= 3 ? SNAP * 1.2 : SNAP * 0.6,
        class: i === 0 ? "draw-first-corner" : "draw-corner",
      }));
    });
    if (pointer) {
      svg.append(svgElement("circle", { cx: pointer[0], cy: pointer[1], r: SNAP * 0.5, class: "draw-pointer" }));
    }
  }

  function onMove(event) {
    const raw = planPoint(event);
    const snapped = snapPoint(raw);
    pointer = closesShape(raw) ? corners[0] : corners.length ? rightAngle(corners.at(-1), snapped) : snapped;
    render();
  }

  function onClick(event) {
    // Not a click on a room: the builder's own preview click listener must not
    // see it. stopImmediatePropagation also stops other listeners on this same <svg>.
    event.stopImmediatePropagation();
    const raw = planPoint(event);
    if (closesShape(raw)) {
      const { outline, error } = closeShape(corners);
      if (error) {
        hint(`${error} Undo a corner (Backspace) and try again.`, true);
        return;
      }
      stop();
      onClose(outline);
      return;
    }
    const snapped = snapPoint(raw);
    const point = corners.length ? rightAngle(corners.at(-1), snapped) : snapped;
    corners = addCorner(corners, point);
    growView(point);
    pointer = null;
    hint(instructions());
    render();
  }

  function onKey(event) {
    // Leave typing in form fields alone.
    if (event.target.closest?.("input, select, textarea")) return;
    if (event.key === "Escape") {
      event.preventDefault();
      cancel();
    } else if (event.key === "Backspace" || event.key === "Delete") {
      event.preventDefault();
      undo();
    }
  }

  function undo() {
    corners = corners.slice(0, -1);
    hint(instructions());
    render();
  }

  function stop() {
    svg.removeEventListener("pointermove", onMove);
    svg.removeEventListener("pointerleave", onLeave);
    svg.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKey);
    svg.classList.remove("is-drawing");
  }

  function cancel() {
    stop();
    onCancel();
  }

  function onLeave() {
    pointer = null;
    render();
  }

  svg.addEventListener("pointermove", onMove);
  svg.addEventListener("pointerleave", onLeave);
  // true = "capture": this listener runs before the builder's own click
  // listener on the same <svg>, so it can stop that one from seeing the click.
  svg.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKey);
  svg.classList.add("is-drawing");
  hint(instructions());
  render();
  return { undo, cancel, stop };
}
