// Tests for static/js/shared/api.js. Run with: node --test tests/*.test.mjs
//
// There is no server here, so each test replaces the global fetch() with a
// fake that records the request and returns a canned Response.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";

import { apiFetch } from "../static/js/shared/api.js";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/**
 * Replace fetch() with a fake that returns `response` and records calls.
 * @returns {Array<{url: string, request: object}>} the recorded calls
 */
function fakeFetch(response) {
  const calls = [];
  globalThis.fetch = async (url, request) => {
    calls.push({ url, request });
    if (response instanceof Error) {
      throw response;
    }
    return response;
  };
  return calls;
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("GET returns the parsed JSON", async () => {
  const calls = fakeFetch(jsonResponse([{ id: 1, name: "Bed" }]));
  assert.deepEqual(await apiFetch("/api/furniture"), [{ id: 1, name: "Bed" }]);
  assert.equal(calls[0].url, "/api/furniture");
  assert.equal(calls[0].request.method, "GET");
  assert.equal(calls[0].request.body, undefined);
});

test("a body is sent as JSON with the right Content-Type", async () => {
  const calls = fakeFetch(jsonResponse({ ok: true, updated: "2026-11-24 07:37:33" }));
  await apiFetch("/api/layouts/3", { method: "PUT", body: { name: "Final" } });
  assert.equal(calls[0].request.method, "PUT");
  assert.equal(calls[0].request.headers["Content-Type"], "application/json");
  assert.equal(calls[0].request.body, '{"name":"Final"}');
});

test("an error reply throws the server's message and status", async () => {
  fakeFetch(jsonResponse({ error: "That layout belongs to someone else." }, 403));
  await assert.rejects(apiFetch("/api/layouts/2"), {
    message: "That layout belongs to someone else.",
    status: 403,
  });
});

test("an error reply that isn't JSON still gives a readable message", async () => {
  fakeFetch(new Response("<h1>Internal Server Error</h1>", { status: 500 }));
  await assert.rejects(apiFetch("/api/layouts"), {
    message: "Something went wrong (error 500).",
    status: 500,
  });
});

test("a successful reply that isn't JSON throws", async () => {
  fakeFetch(new Response("<html></html>", { status: 200 }));
  await assert.rejects(apiFetch("/api/layouts"), { message: /couldn't read/ });
});

test("no answer at all (offline) throws with status 0", async () => {
  fakeFetch(new TypeError("fetch failed"));
  await assert.rejects(apiFetch("/api/layouts"), { message: /Couldn't reach the server/, status: 0 });
});
