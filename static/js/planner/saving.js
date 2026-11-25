/**
 * Saving layouts (SPEC.md 8.5, 8.6). Claire.
 *
 * Save, Save as new and rename go through the layouts API (api.py, S5):
 * POST /api/layouts creates, PUT /api/layouts/<id> updates. "Unsaved
 * changes" appears after any change to the furniture or the name, and the
 * browser warns before leaving the page while it shows.
 *
 * placementForSaving() is pure and tested in tests/saving.test.mjs; the
 * rest needs a browser, and only touches the page when createSaveControls()
 * is called.
 */

import { apiFetch } from "../shared/api.js";

/**
 * The placement in the SPEC.md 4.4 format, ready to send. Catalog items send
 * only their id, centre and rotation (their size comes from the catalog);
 * custom "will it fit" items also send their label and size. Positions are
 * whole inches (the server would round them anyway).
 *
 * @param {object} placement
 * @returns {object}
 */
export function placementForSaving(placement) {
  const saved = {
    furniture_id: placement.furniture_id,
    x: Math.round(placement.x),
    y: Math.round(placement.y),
    rotation: placement.rotation,
  };
  if (placement.furniture_id === null) {
    saved.label = placement.label;
    saved.width = placement.width;
    saved.depth = placement.depth;
    saved.height = placement.height;
  }
  return saved;
}

/**
 * The name for "Save as new": what's in the name box, but with " (copy)"
 * added if it's still the saved layout's name, so the two don't look
 * identical in the list.
 *
 * @param {string} typed - the name box
 * @param {string | null} savedName - the open layout's saved name, if any
 * @returns {string}
 */
export function nameForCopy(typed, savedName) {
  const name = typed.trim();
  return savedName !== null && name === savedName ? `${name} (copy)` : name;
}

/**
 * Wire up the "Your layout" panel section for a logged-in student.
 *
 * @param {{typeId: number, layoutId: number | null}} config
 * @param {ReturnType<import("./layout.js").createLayout>} layout
 * @param {string} name - the open layout's name ("My layout" for a new one)
 * @param {string | null} [sharedUrl] - its share link, if it is shared
 */
export function createSaveControls(config, layout, name, sharedUrl = null) {
  const nameInput = document.querySelector("#layout-name");
  const saveButton = document.querySelector("#save-button");
  const saveAsNewButton = document.querySelector("#save-as-new-button");
  const status = document.querySelector("#save-status");
  const error = document.querySelector("#save-error");
  const list = document.querySelector("#saved-layouts");

  let layoutId = config.layoutId;
  let savedName = layoutId ? name : null;
  let dirty = false;
  nameInput.value = name;
  const sharing = createShareControls(() => layoutId, error, sharedUrl);

  function setDirty(value) {
    dirty = value;
    status.className = dirty ? "small text-warning-emphasis" : "small text-body-secondary";
    status.textContent = dirty ? "Unsaved changes" : "";
  }

  layout.onChange(({ content }) => {
    if (content) setDirty(true);
  });
  nameInput.addEventListener("input", () => setDirty(true));

  // The browser shows its own "Leave site?" box; we can only ask for it.
  window.addEventListener("beforeunload", (event) => {
    if (dirty) {
      event.preventDefault();
      event.returnValue = ""; // older browsers need this as well
    }
  });

  /**
   * Save to the server: update the open layout, or create a new one.
   * @param {boolean} asNew - "Save as new"
   */
  async function save(asNew) {
    const newName = asNew ? nameForCopy(nameInput.value, savedName) : nameInput.value.trim();
    const placements = layout.placements().map(placementForSaving);
    error.hidden = true;
    saveButton.disabled = saveAsNewButton.disabled = true;
    try {
      if (layoutId && !asNew) {
        await apiFetch(`/api/layouts/${layoutId}`, { method: "PUT", body: { name: newName, placements } });
      } else {
        const created = await apiFetch("/api/layouts", {
          method: "POST", body: { type_id: config.typeId, name: newName, placements },
        });
        layoutId = created.id;
        // Change the address to ?layout=<id> without reloading, so a reload
        // (or a bookmark) reopens this layout.
        history.replaceState(null, "", `?layout=${layoutId}`);
      }
      nameInput.value = savedName = newName;
      setDirty(false);
      sharing.refresh(asNew); // a new layout starts unshared
      status.className = "small text-success";
      status.textContent = "Saved";
      refreshList();
    } catch (problem) {
      error.textContent = problem.message;
      error.hidden = false;
    } finally {
      saveButton.disabled = saveAsNewButton.disabled = false;
    }
  }

  /** Show this student's saved layouts for this room, newest first. */
  async function refreshList() {
    try {
      const layouts = await apiFetch(`/api/layouts?type_id=${config.typeId}`);
      list.replaceChildren(...layouts.map((saved) => {
        const item = document.createElement("li");
        const link = document.createElement("a");
        link.href = `?layout=${saved.id}`;
        link.textContent = saved.name;
        if (saved.id === layoutId) {
          link.setAttribute("aria-current", "page");
          link.className = "fw-semibold";
        }
        item.append(link);
        return item;
      }));
      if (!layouts.length) {
        const item = document.createElement("li");
        item.className = "text-body-secondary";
        item.textContent = "None yet.";
        list.append(item);
      }
    } catch (problem) {
      list.replaceChildren();
      error.textContent = problem.message;
      error.hidden = false;
    }
  }

  saveButton.addEventListener("click", () => save(false));
  saveAsNewButton.addEventListener("click", () => save(true));
  nameInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") save(false); // Enter in the name box saves
  });
  setDirty(false);
  refreshList();
  sharing.refresh(false);
}

/**
 * The Share controls (S7) under the save buttons, shown once the layout is
 * saved: share a read-only link, copy it, stop sharing, and a link to the
 * printable shopping list.
 *
 * @param {() => number | null} currentId - the open layout's id, if saved
 * @param {HTMLElement} error - where problems are shown
 * @param {string | null} sharedUrl - the share link if already shared
 * @returns {{refresh: (reset: boolean) => void}} call after saving
 */
function createShareControls(currentId, error, sharedUrl) {
  const box = document.querySelector("#share-controls");
  const shareButton = document.querySelector("#share-button");
  const linkBox = document.querySelector("#share-link");
  const urlInput = document.querySelector("#share-url");
  let url = sharedUrl;

  function render() {
    const id = currentId();
    box.hidden = !id;
    shareButton.hidden = Boolean(url);
    linkBox.hidden = !url;
    urlInput.value = url ?? "";
    document.querySelector("#shopping-list-link").href = id ? `/layouts/${id}/shopping-list` : "#";
  }

  async function call(method) {
    error.hidden = true;
    try {
      const result = await apiFetch(`/api/layouts/${currentId()}/share`, { method });
      url = method === "POST" ? result.share_url : null;
      render();
    } catch (problem) {
      error.textContent = problem.message;
      error.hidden = false;
    }
  }

  shareButton.addEventListener("click", () => call("POST"));
  document.querySelector("#stop-sharing").addEventListener("click", () => call("DELETE"));
  document.querySelector("#copy-share").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(urlInput.value);
    } catch {
      urlInput.select(); // clipboard blocked: select it so Ctrl/Cmd+C works
    }
  });

  return {
    refresh(reset) {
      if (reset) url = null;
      render();
    },
  };
}

/**
 * Wire up the "Default layout" panel section (admin-default mode, A6): Save
 * writes the room type's default layout, the one visitors see first.
 *
 * @param {{typeId: number}} config
 * @param {ReturnType<import("./layout.js").createLayout>} layout
 */
export function createDefaultSaveControls(config, layout) {
  const button = document.querySelector("#save-default-button");
  const status = document.querySelector("#save-status");
  const error = document.querySelector("#save-error");
  let dirty = false;

  function setDirty(value) {
    dirty = value;
    status.className = dirty ? "small text-warning-emphasis" : "small text-body-secondary";
    status.textContent = dirty ? "Unsaved changes" : "";
  }
  layout.onChange(({ content }) => {
    if (content) setDirty(true);
  });
  window.addEventListener("beforeunload", (event) => {
    if (dirty) {
      event.preventDefault();
      event.returnValue = "";
    }
  });

  button.addEventListener("click", async () => {
    error.hidden = true;
    button.disabled = true;
    try {
      await apiFetch(`/admin/api/types/${config.typeId}/default-layout`, {
        method: "PUT", body: { placements: layout.placements().map(placementForSaving) },
      });
      setDirty(false);
      status.className = "small text-success";
      status.textContent = "Saved. Visitors see this now.";
    } catch (problem) {
      error.textContent = problem.message;
      error.hidden = false;
    } finally {
      button.disabled = false;
    }
  });
  setDirty(false);
}
