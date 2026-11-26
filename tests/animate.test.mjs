// Tests for the planner's animation timing (static/js/planner/animate.js).
// Run with: node --test tests/*.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ALL_DROPS_MS, MAX_STAGGER_MS, WALLS_MS,
  dropDelays, dropHeight, easeInCubic, easeOutBack, easeOutCubic, progress,
} from "../static/js/planner/animate.js";

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≉ ${expected}`);

test("easing curves start at 0 and end at 1", () => {
  for (const ease of [easeOutCubic, easeInCubic, easeOutBack]) {
    close(ease(0), 0);
    close(ease(1), 1);
  }
});

test("easeOutBack overshoots a little in the middle (the 'pop')", () => {
  const peak = Math.max(...Array.from({ length: 101 }, (_, i) => easeOutBack(i / 100)));
  assert.ok(peak > 1.05 && peak < 1.2, `peak ${peak}`);
});

test("dropHeight falls from 1 to the floor, bounces once, and never goes below it", () => {
  close(dropHeight(0), 1);
  close(dropHeight(1), 0);
  const samples = Array.from({ length: 201 }, (_, i) => dropHeight(i / 200));
  assert.ok(samples.every((h) => h >= 0), "never into the floor");
  assert.ok(samples.some((h, i) => i > 140 && h > 0.03), "a small bounce near the end");
  // Falls faster and faster at first (like gravity): the second step is bigger than the first.
  assert.ok(dropHeight(0.1) - dropHeight(0.2) > dropHeight(0) - dropHeight(0.1));
});

test("progress is 0 before the start, 1 after the end, linear between", () => {
  assert.equal(progress(50, 100, 200), 0);
  assert.equal(progress(200, 100, 200), 0.5);
  assert.equal(progress(400, 100, 200), 1);
  assert.equal(progress(100, 100, 0), 1);
});

test("dropDelays: biggest pieces first, after the walls, one after another", () => {
  const items = [
    { width: 12, depth: 12 },   // lamp
    { width: 40, depth: 84 },   // bed
    { width: 42, depth: 24 },   // desk
  ];
  const [lamp, bed, desk] = dropDelays(items);
  assert.ok(bed < desk && desk < lamp, `bed ${bed}, desk ${desk}, lamp ${lamp}`);
  assert.ok(bed >= WALLS_MS * 0.5, "starts once the walls are mostly up");
  close(desk - bed, MAX_STAGGER_MS);
});

test("dropDelays keeps a crowded suite's show short", () => {
  const delays = dropDelays(Array.from({ length: 40 }, () => ({ width: 20, depth: 20 })));
  assert.ok(Math.max(...delays) - Math.min(...delays) <= ALL_DROPS_MS);
  assert.deepEqual(dropDelays([]), []);
});
