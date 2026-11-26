/**
 * Planner animations: the room "building itself" when it opens, items
 * popping in when added and shrinking away when deleted. Claire.
 *
 * Only how things *look* is animated (a group's height off the floor, its
 * scale). Positions in the layout never change, so saving, the rules and the
 * shopping list never see an animation. Clicking, dragging or pressing a key
 * in the 3D view skips straight to the end.
 *
 * How an animation works here: a "tween" (short for in-between) is a change
 * from a start to an end over a duration. Every frame we work out how far
 * through it we are (0 to 1), pass that through an "easing" curve that makes
 * the motion speed up, slow down or overshoot, and apply the result.
 *
 * People who ask their system to reduce motion see everything in its final
 * place straight away (SPEC.md 8.7, 11).
 *
 * The easing and timing functions are pure (no three.js, no DOM), so
 * tests/animate.test.mjs runs them under node. createAnimator() needs a browser.
 */

// --- Timing (milliseconds) ------------------------------------------------------

export const WALLS_MS = 450;        // walls grow up from the floor
export const DROP_MS = 520;         // one piece falling into place
export const MAX_STAGGER_MS = 90;   // gap between pieces starting to fall...
export const ALL_DROPS_MS = 900;    // ...squeezed so the last starts within this
export const POP_MS = 320;          // an added item popping in
export const SHRINK_MS = 200;       // a deleted item shrinking away
export const DROP_FROM = 60;        // inches above the floor a piece falls from

// --- Easing curves: progress 0..1 in, 0..1 (roughly) out ----------------------------

/** Fast start, gentle stop. */
export function easeOutCubic(t) {
  return 1 - (1 - t) ** 3;
}

/** Slow start, fast end: for things leaving. */
export function easeInCubic(t) {
  return t ** 3;
}

/**
 * Overshoots the end a little and settles back: a "pop". Goes above 1 in
 * the middle (about 1.1), which is what makes it lively.
 */
export function easeOutBack(t, overshoot = 1.7) {
  const u = t - 1;
  return 1 + (overshoot + 1) * u ** 3 + overshoot * u ** 2;
}

/**
 * How high a falling piece is, as a fraction of where it started: 1 at the
 * start, 0 on the floor. It falls faster and faster (like gravity) for the
 * first 70% of the time, then makes one small bounce and lands.
 *
 * @param {number} t - progress, 0..1
 * @returns {number} 1..0, never below 0 (never into the floor)
 */
export function dropHeight(t) {
  const fall = 0.7;
  if (t < fall) {
    return 1 - (t / fall) ** 2;
  }
  return 0.06 * Math.sin((Math.PI * (t - fall)) / (1 - fall)); // the bounce: up a little and back
}

/**
 * Progress of a tween at time `now`: 0 before it starts, 1 once it's done.
 *
 * @param {number} now
 * @param {number} start - when it starts (after any delay)
 * @param {number} duration
 * @returns {number} 0..1
 */
export function progress(now, start, duration) {
  if (duration <= 0) return now >= start ? 1 : 0;
  return Math.min(1, Math.max(0, (now - start) / duration));
}

/**
 * When each piece starts to fall: the walls first, then the biggest pieces
 * (beds, futons) before small ones (lamps), one after another. The gap
 * shrinks for crowded suites so the whole show stays short.
 *
 * @param {{width: number, depth: number}[]} items - in layout order
 * @returns {number[]} delay in ms for each item, in the same order
 */
export function dropDelays(items) {
  const stagger = Math.min(MAX_STAGGER_MS, ALL_DROPS_MS / Math.max(1, items.length));
  const order = items
    .map((item, i) => ({ i, area: item.width * item.depth }))
    .sort((a, b) => b.area - a.area || a.i - b.i); // biggest first; ties keep layout order
  const delays = new Array(items.length);
  order.forEach(({ i }, rank) => {
    delays[i] = WALLS_MS * 0.8 + rank * stagger; // start just before the walls finish
  });
  return delays;
}

// --- Running tweens in the browser --------------------------------------------------

/**
 * A tiny animation runner. Each tween is
 *   { delay, duration, apply(p), done?() }
 * where apply() receives progress 0..1 every frame. It asks the scene to
 * draw (requestRender) only while something is moving, so the planner goes
 * back to drawing only on demand afterwards.
 *
 * @param {() => void} requestRender - from scene.js
 * @returns {{add: (tween: object) => void, finishAll: () => void, busy: () => boolean}}
 */
export function createAnimator(requestRender) {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let tweens = [];
  let running = false;

  function finish(tween) {
    tween.apply(1);
    tween.done?.();
  }

  function step(now) {
    for (const tween of tweens) {
      // The clock starts at a tween's first frame, not when it was added, so
      // a slow page load doesn't eat the start of the animation.
      tween.start ??= now + (tween.delay ?? 0);
      const p = progress(now, tween.start, tween.duration);
      if (now >= tween.start) tween.apply(p);
      if (p >= 1) tween.done?.();
    }
    tweens = tweens.filter((tween) => progress(now, tween.start, tween.duration) < 1);
    requestRender();
    running = tweens.length > 0;
    if (running) requestAnimationFrame(step);
  }

  return {
    add(tween) {
      if (reduceMotion) {
        finish(tween);
        requestRender();
        return;
      }
      tween.before?.(); // e.g. hide a piece until its turn
      tweens.push(tween);
      if (!running) {
        running = true;
        requestAnimationFrame(step);
      }
    },
    /** Jump every running tween to its end (a click or key skips the show). */
    finishAll() {
      tweens.forEach(finish);
      tweens = [];
      requestRender();
    },
    busy: () => tweens.length > 0,
  };
}

// --- The animations themselves ---------------------------------------------------------

/**
 * The opening show: walls grow up from the floor, then each piece drops in.
 * Works on three.js objects but needs nothing from three.js itself.
 *
 * @param {ReturnType<typeof createAnimator>} animator
 * @param {{scale: {y: number}}} roomGroup - room.js's group (floors are flat, so only walls grow)
 * @param {{group: object, item: {width: number, depth: number}}[]} entries - layout.entries()
 */
export function playIntro(animator, roomGroup, entries) {
  animator.add({
    delay: 0,
    duration: WALLS_MS,
    before: () => { roomGroup.scale.y = 0.001; },   // 0 exactly would upset the lighting maths
    apply: (p) => { roomGroup.scale.y = Math.max(0.001, easeOutCubic(p)); },
  });
  const delays = dropDelays(entries.map((entry) => entry.item));
  entries.forEach((entry, i) => {
    const { group } = entry;
    animator.add({
      delay: delays[i],
      duration: DROP_MS,
      before: () => { group.visible = false; },     // hidden until its turn
      apply: (p) => {
        group.visible = true;
        group.position.y = DROP_FROM * dropHeight(p);
      },
      done: () => { group.position.y = 0; },
    });
  });
}

/**
 * An item just added: it grows from nothing to full size, overshooting a little.
 * @param {ReturnType<typeof createAnimator>} animator
 * @param {{scale: {setScalar: (s: number) => void}}} group
 */
export function popIn(animator, group) {
  animator.add({
    duration: POP_MS,
    before: () => group.scale.setScalar(0.001),
    apply: (p) => group.scale.setScalar(Math.max(0.001, easeOutBack(p))),
  });
}

/**
 * An item just deleted: it shrinks to nothing, then `done` removes it for good.
 * @param {ReturnType<typeof createAnimator>} animator
 * @param {{scale: {setScalar: (s: number) => void}}} group
 * @param {() => void} done
 */
export function shrinkAway(animator, group, done) {
  animator.add({
    duration: SHRINK_MS,
    apply: (p) => group.scale.setScalar(Math.max(0.001, 1 - easeInCubic(p))),
    done,
  });
}
