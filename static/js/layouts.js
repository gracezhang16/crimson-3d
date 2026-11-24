/**
 * My layouts page (templates/my_layouts.html): rename and delete layouts
 * through the layouts API, and show "last saved" times in local time.
 *
 * Uses one click listener and one submit listener on the whole table instead
 * of one per button ("event delegation"): each event says which element was
 * clicked, and closest() finds the row it belongs to.
 */

import { apiFetch } from "./shared/api.js";

const table = document.querySelector("#layouts-table");
const status = document.querySelector("#layouts-status");
const emptyMessage = document.querySelector("#layouts-empty");

/**
 * Show a short message above the table.
 *
 * @param {string} text
 * @param {"success" | "danger"} kind - Bootstrap alert colour
 */
function showStatus(text, kind) {
  status.replaceChildren();
  const alert = document.createElement("div");
  alert.className = `alert alert-${kind} py-2`;
  alert.textContent = text; // textContent, not innerHTML, so names can't inject HTML
  status.append(alert);
}

/**
 * Rewrite a <time datetime="...Z"> element as a local date and time,
 * e.g. "Nov 24, 2026, 2:37 AM".
 *
 * @param {HTMLTimeElement} element
 */
function showLocalTime(element) {
  const date = new Date(element.dateTime);
  if (!Number.isNaN(date.getTime())) {
    element.textContent = date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  }
}

/**
 * Switch a row between showing its name and showing the rename form.
 *
 * @param {HTMLTableRowElement} row
 * @param {boolean} editing
 */
function setEditing(row, editing) {
  const form = row.querySelector(".rename-form");
  row.querySelector(".layout-name").hidden = editing;
  form.hidden = !editing;
  if (editing) {
    form.elements.name.value = row.querySelector(".layout-name").textContent;
    form.elements.name.select();
  }
}

/**
 * Ask the server to rename a layout, then update the row.
 *
 * @param {HTMLTableRowElement} row
 * @param {string} name
 */
async function renameLayout(row, name) {
  try {
    const result = await apiFetch(`/api/layouts/${row.dataset.layoutId}`, {
      method: "PUT",
      body: { name },
    });
    row.querySelector(".layout-name").textContent = name.trim();
    const time = row.querySelector("time");
    time.dateTime = `${result.updated.replace(" ", "T")}Z`;
    showLocalTime(time);
    setEditing(row, false);
    showStatus("Renamed.", "success");
  } catch (error) {
    showStatus(error.message, "danger");
  }
}

/**
 * Confirm, then ask the server to delete a layout and remove its row.
 *
 * @param {HTMLTableRowElement} row
 */
async function deleteLayout(row) {
  const name = row.querySelector(".layout-name").textContent;
  if (!window.confirm(`Delete “${name}”? This can't be undone.`)) {
    return;
  }
  try {
    await apiFetch(`/api/layouts/${row.dataset.layoutId}`, { method: "DELETE" });
    row.remove();
    showStatus(`Deleted “${name}”.`, "success");
    if (!table.querySelector("tbody tr")) {
      table.closest(".table-responsive").hidden = true;
      emptyMessage.hidden = false;
    }
  } catch (error) {
    showStatus(error.message, "danger");
  }
}

// The table only exists when the student has at least one layout.
if (table) {
  table.querySelectorAll("time[datetime]").forEach(showLocalTime);

  table.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) {
      return;
    }
    const row = button.closest("tr");
    if (button.dataset.action === "rename") {
      setEditing(row, true);
    } else if (button.dataset.action === "cancel") {
      setEditing(row, false);
    } else if (button.dataset.action === "delete") {
      deleteLayout(row);
    }
  });

  table.addEventListener("submit", (event) => {
    event.preventDefault(); // stop the browser's normal form submission (a page reload)
    const form = event.target;
    renameLayout(form.closest("tr"), form.elements.name.value);
  });
}
