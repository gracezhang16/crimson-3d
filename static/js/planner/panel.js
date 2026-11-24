/**
 * The planner's side panel (SPEC.md 8.6). Claire.
 *
 * P5: catalog "add" buttons (Harvard furniture, things to buy), the
 * selection card (name, size, Rotate, Delete) and a list of the items in the
 * room. P6 adds layout controls, P8 the "Will it fit?" form.
 *
 * Text is always set with textContent, never innerHTML, so a catalog name
 * can't inject HTML.
 */

import { formatFeetInches } from "../shared/units.js";

/**
 * Build one button with a name and a size line underneath.
 *
 * @param {string} name
 * @param {string} size
 * @returns {HTMLButtonElement}
 */
function itemButton(name, size) {
  const button = document.createElement("button");
  button.type = "button";
  const title = document.createElement("span");
  title.textContent = name;
  const dims = document.createElement("span");
  dims.className = "catalog-size";
  dims.textContent = size;
  button.append(title, dims);
  return button;
}

/**
 * "40 × 84 in" for a catalog button.
 * @param {{width: number, depth: number}} item
 * @returns {string}
 */
function footprintText(item) {
  return `${item.width} × ${item.depth} in`;
}

/**
 * Wire up the panel.
 *
 * @param {ReturnType<import("./layout.js").createLayout>} layout
 * @param {object[]} catalog - /api/furniture rows
 */
export function createPanel(layout, catalog) {
  const selection = document.querySelector("#selection");
  const roomItems = document.querySelector("#room-items");

  // Catalog buttons, built once.
  for (const item of catalog) {
    const button = itemButton(item.name, footprintText(item));
    button.setAttribute("aria-label", `Add ${item.name} (${footprintText(item)})`);
    button.addEventListener("click", () => layout.addFromCatalog(item));
    document.querySelector(`#catalog-${item.category}`)?.append(button);
  }

  document.querySelector("#rotate-button").addEventListener("click", () => {
    const entry = layout.selected();
    if (entry) layout.rotate(entry);
  });
  document.querySelector("#delete-button").addEventListener("click", () => {
    const entry = layout.selected();
    if (entry) layout.remove(entry);
  });

  /** Redraw the parts that depend on the layout. */
  function refresh() {
    const selected = layout.selected();
    selection.hidden = !selected;
    if (selected) {
      const { name, width, depth, height } = selected.item;
      document.querySelector("#selection-name").textContent = name;
      document.querySelector("#selection-size").textContent =
        `${formatFeetInches(width)} wide × ${formatFeetInches(depth)} deep × ${formatFeetInches(height)} tall`;
    }

    const entries = layout.entries();
    document.querySelector("#room-item-count").textContent = `(${entries.length})`;
    roomItems.replaceChildren(...entries.map((entry) => {
      const button = itemButton(entry.item.name, footprintText(entry.item));
      // aria-pressed tells screen readers (and our CSS) which one is selected.
      button.setAttribute("aria-pressed", String(entry === selected));
      button.addEventListener("click", () => layout.select(entry));
      const item = document.createElement("li");
      item.append(button);
      return item;
    }));
  }

  layout.onChange(() => refresh());
  refresh();
}
