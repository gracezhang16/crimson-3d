/**
 * Small wrapper around fetch() for the Crimson3D JSON API (SPEC.md 7.2).
 *
 * SHARED FILE: the planner (Claire) and the My layouts page (Grace) both use
 * it. Agree on changes before making them.
 *
 * fetch() is the browser's built-in way to make an HTTP request from
 * JavaScript without reloading the page. It returns a Promise, so we use
 * `await` to wait for the answer. The login cookie is sent automatically
 * because the API is on the same site.
 *
 * No DOM or three.js imports, so tests/api.test.mjs can run it under node.
 */

/**
 * Call an API endpoint and return its parsed JSON reply.
 *
 * @param {string} url - e.g. "/api/layouts/3"
 * @param {{method?: string, body?: object}} [options] - HTTP method (default
 *   "GET") and an optional body, sent as JSON.
 * @returns {Promise<any>} the parsed JSON reply
 * @throws {Error} if the request fails. The message is written for a person
 *   (the server's {"error": ...} text when there is one), and `error.status`
 *   holds the HTTP status (0 if the server couldn't be reached).
 */
export async function apiFetch(url, { method = "GET", body } = {}) {
  const request = { method, headers: { Accept: "application/json" } };
  if (body !== undefined) {
    request.headers["Content-Type"] = "application/json";
    request.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(url, request);
  } catch {
    // fetch() only rejects when there is no answer at all (offline, server down).
    throw apiError("Couldn't reach the server. Check your connection and try again.", 0);
  }

  let data = null;
  try {
    data = await response.json();
  } catch {
    // Not JSON (e.g. an HTML error page); handled below.
  }

  if (!response.ok) {
    const message = data?.error ?? `Something went wrong (error ${response.status}).`;
    throw apiError(message, response.status);
  }
  if (data === null) {
    throw apiError("The server sent a reply we couldn't read.", response.status);
  }
  return data;
}

/**
 * Build an Error with an HTTP status attached.
 *
 * @param {string} message
 * @param {number} status
 * @returns {Error}
 */
function apiError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}
