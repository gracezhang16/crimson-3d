/**
 * The planner's side panel (SPEC.md 8.6). Claire.
 *
 * Catalog "add" buttons (Harvard furniture, things to buy), the selection
 * card (name, size, issue, Rotate, Delete), the list of items in the room
 * with their issues, and the status pill over the 3D view (P7). Layout
 * controls are in saving.js; the "Will it fit?" form arrives in P8.
 *
 * Text is always set with textContent, never innerHTML, so a catalog name
 * can't inject HTML.
 */

import { formatFeetInches } from "../shared/units.js";

/**
 * Build one button with a name and a size line underneath, and optionally
 * an issue line ("⚠ Blocks the door") below that.
 *
 * @param {string} name
 * @param {string} size
 * @param {string | null} [issue]
 * @returns {HTMLButtonElement}
 */
function itemButton(name, size, issue = null) {
  const button = document.createElement("button");
  button.type = "button";
  const title = document.createElement("span");
  title.textContent = name;
  const dims = document.createElement("span");
  dims.className = "catalog-size";
  dims.textContent = size;
  button.append(title, dims);
  if (issue) {
    const warning = document.createElement("span");
    warning.className = "issue-text";
    warning.textContent = `⚠ ${issue}`;
    button.append(warning);
    button.classList.add("has-issue");
  }
  return button;
}

/**
 * Show "Everything fits" or "N items don't fit" over the 3D view.
 * @param {object[]} entries
 */
function updateFitStatus(entries) {
  const pill = document.querySelector("#fit-status");
  const problems = entries.filter((entry) => entry.issue).length;
  pill.hidden = false;
  pill.classList.toggle("fit-pill-ok", problems === 0);
  pill.classList.toggle("fit-pill-issues", problems > 0);
  pill.textContent = problems === 0
    ? "✓ Everything fits"
    : `⚠ ${problems} ${problems === 1 ? "item doesn't" : "items don't"} fit`;
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
      const issue = document.querySelector("#selection-issue");
      issue.hidden = !selected.issue;
      issue.textContent = selected.issue ? `⚠ ${selected.issue}` : "";
    }

    const entries = layout.entries();
    document.querySelector("#room-item-count").textContent = `(${entries.length})`;
    roomItems.replaceChildren(...entries.map((entry) => {
      const button = itemButton(entry.item.name, footprintText(entry.item), entry.issue);
      // aria-pressed tells screen readers (and our CSS) which one is selected.
      button.setAttribute("aria-pressed", String(entry === selected));
      button.addEventListener("click", () => layout.select(entry));
      const item = document.createElement("li");
      item.append(button);
      return item;
    }));
    updateFitStatus(entries);
  }

  layout.onChange(() => refresh());
  refresh();
}
