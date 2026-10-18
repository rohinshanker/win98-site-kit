// Node tests for the Neko package: manifest integrity and the pure motion
// rules in apps/neko/motion.js (direction and sprite selection, viewport
// geometry, footprints, context-menu clamping and the stream plan).

import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import * as motion from "../../registry/apps/neko/apps/neko/motion.js";

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../registry/apps/neko");
const viewport = { width: 1280, height: 800 };

const walk = async (dir) => {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => (entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]))
  );
  return files.flat();
};

/** A deterministic random source that replays `values` and then repeats the last one. */
const sequence = (values) => {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)];
};

test("manifest lists every package file and only files that exist", async () => {
  const manifest = JSON.parse(await readFile(path.join(packageDir, "manifest.json"), "utf8"));
  assert.equal(manifest.id, "neko");
  assert.equal(manifest.kind, "app");
  const onDisk = (await walk(packageDir))
    .map((file) => path.relative(packageDir, file))
    .filter((file) => file !== "manifest.json" && !file.endsWith(".DS_Store"))
    .sort();
  assert.deepEqual([...manifest.files].sort(), onDisk);
  assert.ok(manifest.files.includes("apps/neko/index.js"));
  assert.ok(manifest.files.includes("assets/neko/LICENSE"));
  assert.ok(manifest.files.includes("assets/neko/neko-credit-icon.png"));
  for (const file of manifest.files) {
    assert.ok(file.startsWith("apps/neko/") || file.startsWith("assets/neko/"), `${file} is outside the package folders`);
  }
});

test("every sprite named in the tables ships as a PNG", async () => {
  const sprites = new Set((await readdir(path.join(packageDir, "assets/neko/sprites"))).map((name) => name.replace(/\.png$/, "")));
  for (const name of motion.SPRITE_NAMES) assert.ok(sprites.has(name), `missing sprite ${name}`);
  for (const direction of motion.DIRECTIONS) assert.ok(sprites.has(`fp_${direction}`), `missing footprint ${direction}`);
  for (const action of [...motion.IDLE_ACTIONS, ...motion.MANUAL_ACTIONS, ...motion.STREAM_ACTIONS]) {
    for (const frame of action.frames) assert.ok(motion.SPRITE_NAMES.includes(frame), `${action.name} uses unknown ${frame}`);
  }
  for (const step of motion.WAKE_SEQUENCE) assert.ok(motion.SPRITE_NAMES.includes(step.sprite));
});

test("chooseRunDirection maps the cat-minus-target vector to the eight compass sprites", () => {
  const cases = [
    [[0, 10], "up"],
    [[0, -10], "down"],
    [[10, 0], "left"],
    [[-10, 0], "right"],
    [[-7, 7], "upright"],
    [[7, 7], "upleft"],
    [[-7, -7], "downright"],
    [[7, -7], "downleft"],
  ];
  for (const [[diffX, diffY], expected] of cases) {
    const distance = Math.hypot(diffX, diffY);
    assert.equal(motion.chooseRunDirection(diffX, diffY, distance), expected, `${diffX},${diffY}`);
    assert.ok(motion.RUN_SPRITES[expected].length === 2);
  }
  assert.equal(motion.chooseRunDirection(0, 0, 1), "down", "no movement falls back to down");
});

test("sleep and nap frames alternate at their own cadences", () => {
  assert.deepEqual([0, 1, 2, 3].map(motion.sleepSpriteName), ["sleep1", "sleep2", "sleep1", "sleep2"]);
  assert.equal(motion.napSpriteName(0), "sleep1");
  assert.equal(motion.napSpriteName(motion.NAP_FRAME_SWITCH_FRAMES - 1), "sleep1");
  assert.equal(motion.napSpriteName(motion.NAP_FRAME_SWITCH_FRAMES), "sleep2");
  assert.equal(motion.napSpriteName(motion.NAP_FRAME_SWITCH_FRAMES * 2), "sleep1");
});

test("clampCenterX/Y keep the sprite inside the viewport, allowing for the vertical offset", () => {
  const half = motion.SPRITE_SIZE / 2;
  assert.equal(motion.clampCenterX(-100, 1280), half);
  assert.equal(motion.clampCenterX(5000, 1280), 1280 - half);
  assert.equal(motion.clampCenterX(600, 1280), 600);
  assert.equal(motion.clampCenterY(-100, 800), half + motion.VERTICAL_OFFSET);
  assert.equal(motion.clampCenterY(5000, 800), 800 - half + motion.VERTICAL_OFFSET);
  assert.equal(motion.clampCenterX(10, 20), half, "a viewport narrower than the sprite pins to the minimum");
});

test("scratchAnchor pins the cat to the requested edge next to the pointer", () => {
  const half = motion.SPRITE_SIZE / 2;
  assert.deepEqual(motion.scratchAnchor("left", 0, 300, viewport), { x: half, y: 310 });
  assert.deepEqual(motion.scratchAnchor("right", 1280, 300, viewport), { x: 1280 - half, y: 310 });
  assert.deepEqual(motion.scratchAnchor("top", 500, 0, viewport), { x: 500, y: half + motion.VERTICAL_OFFSET });
  assert.deepEqual(motion.scratchAnchor("bottom", 500, 800, viewport), { x: 500, y: 800 - half + motion.VERTICAL_OFFSET });
  assert.deepEqual(motion.scratchAnchor("unknown", 500, 300, viewport), { x: 500, y: 310 });
});

test("pointerViewportEdge only fires inside the two-pixel hot zone and picks the nearest edge", () => {
  assert.equal(motion.pointerViewportEdge(600, 400, viewport), null);
  assert.equal(motion.pointerViewportEdge(0, 400, viewport), "left");
  assert.equal(motion.pointerViewportEdge(1279, 400, viewport), "right");
  assert.equal(motion.pointerViewportEdge(600, 1, viewport), "top");
  assert.equal(motion.pointerViewportEdge(600, 799, viewport), "bottom");
  assert.equal(motion.pointerViewportEdge(1, 0, viewport), "top", "corner: the closer edge wins");
  assert.equal(motion.pointerViewportEdge(3, 400, viewport), null);
});

test("pointerExitEdge prefers the largest overshoot and otherwise the nearest edge", () => {
  assert.equal(motion.pointerExitEdge(-30, 400, viewport), "left");
  assert.equal(motion.pointerExitEdge(1300, 400, viewport), "right");
  assert.equal(motion.pointerExitEdge(600, -5, viewport), "top");
  assert.equal(motion.pointerExitEdge(600, 850, viewport), "bottom");
  assert.equal(motion.pointerExitEdge(-5, -40, viewport), "top");
  assert.equal(motion.pointerExitEdge(10, 400, viewport), "left", "inside: nearest edge");
  assert.equal(motion.pointerExitEdge(600, 790, viewport), "bottom");
});

test("isAtScratchEdge uses the scratch target when known and the raw edge otherwise", () => {
  const half = motion.SPRITE_SIZE / 2;
  assert.ok(motion.isAtScratchEdge({ edge: "left", x: 30, y: 300, targetX: 21, targetY: 300, viewport }));
  assert.ok(!motion.isAtScratchEdge({ edge: "left", x: 60, y: 300, targetX: 21, targetY: 300, viewport }));
  const raw = (edge, x, y) => motion.isAtScratchEdge({ edge, x, y, targetX: null, targetY: null, viewport });
  assert.ok(raw("left", half + motion.EDGE_SCRATCH_DISTANCE, 300));
  assert.ok(!raw("left", half + motion.EDGE_SCRATCH_DISTANCE + 1, 300));
  assert.ok(raw("right", 1280 - half - motion.EDGE_SCRATCH_DISTANCE, 300));
  assert.ok(raw("top", 300, half + motion.VERTICAL_OFFSET + motion.EDGE_SCRATCH_DISTANCE));
  assert.ok(raw("bottom", 300, 800 - half + motion.VERTICAL_OFFSET - motion.EDGE_SCRATCH_DISTANCE));
  assert.ok(!raw("nowhere", 300, 300));
});

test("stepTowardTarget moves SPEED pixels along the vector and reports arrival", () => {
  const step = motion.stepTowardTarget({ x: 100, y: 100, targetX: 200, targetY: 100, stopDistance: motion.SPEED, viewport });
  assert.equal(step.arrived, false);
  assert.equal(step.direction, "right");
  assert.deepEqual([step.x, step.y], [110, 100]);
  assert.deepEqual([step.moveX, step.moveY], [10, -0]);
  assert.deepEqual(motion.stepTowardTarget({ x: 100, y: 100, targetX: 105, targetY: 100, stopDistance: 6, viewport }), { arrived: true });
  assert.deepEqual(motion.stepTowardTarget({ x: 100, y: 100, targetX: 109, targetY: 100, stopDistance: 0, viewport }), { arrived: true }, "closer than one step counts as arrived");
  const clamped = motion.stepTowardTarget({ x: 22, y: 100, targetX: -500, targetY: 100, stopDistance: 0, viewport });
  assert.equal(clamped.x, motion.SPRITE_SIZE / 2, "steps never leave the viewport");
  assert.equal(clamped.direction, "left");
});

test("footprints are spaced FOOTPRINT_SPACING apart and placed as a staggered pair behind the cat", () => {
  assert.ok(motion.shouldDropFootprint(null, null, 10, 10), "the first print always drops");
  assert.ok(!motion.shouldDropFootprint(0, 0, 20, 0));
  assert.ok(motion.shouldDropFootprint(0, 0, motion.FOOTPRINT_SPACING, 0));
  const pair = motion.footprintPairPositions({ x: 100, y: 100, moveX: 10, moveY: 0, side: 1 });
  assert.equal(pair.length, 2);
  assert.deepEqual(pair.map((paw) => paw.side), [1, -1]);
  const originX = 100 - motion.FOOTPRINT_BACK_OFFSET;
  const originY = 100 - motion.VERTICAL_OFFSET;
  assert.deepEqual([pair[0].x, pair[0].y], [originX - motion.FOOTPRINT_STAGGER, originY + motion.FOOTPRINT_SIDE_OFFSET]);
  assert.deepEqual([pair[1].x, pair[1].y], [originX + motion.FOOTPRINT_STAGGER, originY - motion.FOOTPRINT_SIDE_OFFSET]);
  const still = motion.footprintPairPositions({ x: 100, y: 100, moveX: 0, moveY: 0, side: -1 });
  assert.ok(still.every((paw) => Number.isFinite(paw.x) && Number.isFinite(paw.y)), "a zero vector does not divide by zero");
  assert.deepEqual(motion.footprintPlacement(100, 100, "left"), { left: Math.round(100 - 10.5), top: 100 });
  assert.deepEqual(motion.footprintPlacement(100, 100, "nope"), { left: 100, top: 100 });
});

test("homePositionFromRect centres on the bed plus the vertical offset, else the viewport centre", () => {
  assert.deepEqual(motion.homePositionFromRect({ left: 10, top: 20, width: 40, height: 40 }, viewport), { x: 30, y: 50 });
  assert.deepEqual(motion.homePositionFromRect({ left: 10, top: 20, width: 0, height: 0 }, viewport), { x: 640, y: 400 });
  assert.deepEqual(motion.homePositionFromRect(undefined, viewport), { x: 640, y: 400 });
});

test("contextMenuPosition keeps the menu inside the viewport and above the taskbar", () => {
  const menu = { menuWidth: 140, menuHeight: 30, viewport, taskbarTop: 748 };
  assert.deepEqual(motion.contextMenuPosition({ requestedLeft: 300, requestedTop: 200, ...menu }), { left: 300, top: 200 });
  assert.deepEqual(motion.contextMenuPosition({ requestedLeft: -50, requestedTop: -50, ...menu }), { left: 6, top: 6 });
  assert.deepEqual(motion.contextMenuPosition({ requestedLeft: 1270, requestedTop: 790, ...menu }), { left: 1280 - 140 - 6, top: 748 - 30 - 6 });
  assert.deepEqual(
    motion.contextMenuPosition({ requestedLeft: 1270, requestedTop: 790, ...menu, taskbarTop: null }),
    { left: 1134, top: 800 - 6 - 30 - 6 },
    "without a taskbar the viewport bottom bounds the menu"
  );
  assert.deepEqual(motion.contextMenuPosition({ requestedLeft: 0, requestedTop: 0, menuWidth: 5000, menuHeight: 5000, viewport }), { left: 6, top: 6 });
});

test("createStreamPlan schedules 40 cats in consecutive 250ms slots with bounded speeds and 25% actions", () => {
  const plan = motion.createStreamPlan();
  assert.equal(plan.length, 40);
  assert.ok(Object.isFrozen(plan));
  const slot = motion.STREAM_SPAWN_WINDOW_MS / motion.STREAM_COUNT;
  assert.equal(slot, 250);
  const byId = [...plan].sort((a, b) => a.id - b.id);
  byId.forEach((cat, index) => {
    assert.ok(cat.spawnDelayMs >= index * slot && cat.spawnDelayMs < (index + 1) * slot, `cat ${index} spawns in its slot`);
    assert.ok(["left", "right"].includes(cat.entrySide));
    assert.equal(cat.initialDirection, cat.entrySide === "left" ? 1 : -1);
    assert.ok(cat.initialSpeedMultiplier >= motion.STREAM_MIN_SPEED_MULTIPLIER);
    assert.ok(cat.initialSpeedMultiplier <= motion.STREAM_MAX_SPEED_MULTIPLIER);
    if (cat.action) {
      assert.ok(motion.STREAM_ACTIONS.includes(cat.action));
      assert.ok(cat.actionTriggerProgress >= 0.2 && cat.actionTriggerProgress <= 0.8);
      if (cat.action.fixedDurationMs) assert.equal(cat.actionDurationMs, cat.action.fixedDurationMs);
      else assert.ok(cat.actionDurationMs >= 5000 && cat.actionDurationMs <= 10000);
    } else {
      assert.equal(cat.actionTriggerProgress, null);
      assert.equal(cat.actionDurationMs, null);
    }
    assert.equal(cat.postActionDirection, null);
    assert.equal(cat.postActionSpeedMultiplier, null);
  });
  for (let index = 1; index < plan.length; index += 1) assert.ok(plan[index - 1].spawnDelayMs <= plan[index].spawnDelayMs, "sorted by delay");
});

test("createStreamPlan is deterministic for a given random source and never collapses a slot", () => {
  const zeros = motion.createStreamPlan({ count: 4, durationMs: 1000, random: () => 0 });
  assert.deepEqual(zeros.map((cat) => cat.spawnDelayMs), [0, 250, 500, 750]);
  assert.ok(zeros.every((cat) => cat.entrySide === "left" && cat.initialSpeedMultiplier === 0.8 && cat.action?.name === "sit"));
  const ones = motion.createStreamPlan({ count: 4, durationMs: 1000, random: () => 1 });
  assert.ok(ones.every((cat, index) => cat.spawnDelayMs < (index + 1) * 250), "a roll of 1 still stays inside the slot");
  assert.ok(ones.every((cat) => cat.entrySide === "right" && cat.initialSpeedMultiplier === 1.7 && cat.action === null));
  const sleeper = motion.createStreamPlan({ count: 1, durationMs: 1000, random: sequence([0.5, 0.5, 0.5, 0.1, 0.99, 0.5]) });
  assert.equal(sleeper[0].action.name, "sleep");
  assert.equal(sleeper[0].actionDurationMs, motion.STREAM_SLEEP_ACTION_DURATION_MS);
  assert.equal(sleeper[0].actionTriggerProgress, 0.2 + 0.5 * 0.6);
  assert.equal(motion.createStreamPlan({ count: 0 }).length, 0);
  assert.equal(motion.sampleRoll(() => Number.NaN), 0, "non-finite rolls count as zero");
  assert.equal(motion.sampleRoll(() => 7), 1);
  assert.equal(motion.sampleIndex(5, () => 0.999), 4);
});

test("streamActionSpriteName follows each action's documented cadence", () => {
  const byName = Object.fromEntries(motion.STREAM_ACTIONS.map((action) => [action.name, action]));
  assert.equal(motion.streamActionSpriteName(byName.clean, 0), "awake");
  assert.equal(motion.streamActionSpriteName(byName.clean, 999), "awake");
  assert.equal(motion.streamActionSpriteName(byName.clean, 1000), "wash1");
  assert.equal(motion.streamActionSpriteName(byName.clean, 2999), "wash1");
  assert.equal(motion.streamActionSpriteName(byName.clean, 3000), "awake");
  assert.deepEqual([0, 749, 750, 1500, 2250, 2999, 5000].map((ms) => motion.streamActionSpriteName(byName.yawn, ms)), [
    "yawn1",
    "yawn1",
    "yawn2",
    "yawn2",
    "yawn1",
    "yawn1",
    "yawn1",
  ]);
  assert.equal(motion.streamActionSpriteName(byName.sleep, 0), "sleep1");
  assert.equal(motion.streamActionSpriteName(byName.sleep, 799), "sleep1");
  assert.equal(motion.streamActionSpriteName(byName.sleep, 800), "sleep2");
  assert.equal(motion.streamActionSpriteName(byName.scratch, 100), "scratch2");
  assert.equal(motion.streamActionSpriteName(byName.scratch, 600), "scratch1");
  assert.equal(motion.streamActionSpriteName(byName.sit, -50), "awake", "negative or missing elapsed clamps to zero");
  assert.equal(motion.streamActionSpriteName(byName.sit, undefined), "awake");
});

test("stream lane geometry puts every sprite's lowest opaque row on the taskbar", () => {
  const scale = motion.SPRITE_SIZE / motion.STREAM_SOURCE_SIZE_PX;
  assert.equal(motion.streamLaneY(748, 800), 748 - 30 * scale);
  assert.equal(motion.streamLaneY(null, 800), 800 - 52 - 30 * scale, "no taskbar: fall back to the default taskbar height");
  for (const [sprite, opaque] of Object.entries(motion.STREAM_OPAQUE_HEIGHT_BY_SPRITE)) {
    const bottom = motion.streamLaneY(748, 800) + motion.streamPoseOffsetY(sprite) + opaque * scale;
    const overlap = sprite.startsWith("sleep") ? motion.STREAM_SLEEP_OVERLAP_PX : 0;
    assert.ok(Math.abs(bottom - (748 + overlap)) < 1e-9, `${sprite} touches the taskbar (${bottom})`);
  }
  assert.equal(motion.streamPoseOffsetY("unknown"), 0);
});

test("stream cats advance, animate and leave the viewport at the documented margins", () => {
  assert.equal(motion.streamStepX(1, 1, 100), motion.SPEED);
  assert.equal(motion.streamStepX(-1, 1.7, 50), -8.5);
  assert.deepEqual(motion.advanceRunFrame(0, 0, 40), { runFrameIndex: 0, runFrameElapsedMs: 40, changed: false });
  assert.deepEqual(motion.advanceRunFrame(0, 90, 20), { runFrameIndex: 1, runFrameElapsedMs: 10, changed: true });
  assert.deepEqual(motion.advanceRunFrame(1, 0, 250), { runFrameIndex: 1, runFrameElapsedMs: 50, changed: true }, "two whole frames return to the same cycle index");
  assert.ok(!motion.isOutsideViewport(-84, 1280));
  assert.ok(motion.isOutsideViewport(-85, 1280));
  assert.ok(motion.isOutsideViewport(1365, 1280));
  assert.ok(!motion.isOutsideViewport(1364, 1280));
  assert.equal(motion.clampFrameDelta(5000), 200);
  assert.equal(motion.clampFrameDelta(-5), 0);
});

test("stream actions trigger once, only while fully visible, past the planned progress", () => {
  const action = motion.STREAM_ACTIONS[0];
  const base = { entrySide: "left", action, actionCompleted: false, actionStartedAt: null, actionTriggerProgress: 0.5 };
  assert.equal(motion.streamEntryProgress({ ...base, x: 640 }, 1280), 0.5);
  assert.equal(motion.streamEntryProgress({ ...base, entrySide: "right", x: 320 }, 1280), 0.75);
  assert.equal(motion.streamEntryProgress({ ...base, x: 320 }, 0), 0);
  assert.ok(motion.isStreamCatFullyVisible({ x: 21 }, 1280));
  assert.ok(!motion.isStreamCatFullyVisible({ x: 20 }, 1280));
  assert.ok(motion.shouldStartStreamAction({ ...base, x: 640 }, 1280));
  assert.ok(!motion.shouldStartStreamAction({ ...base, x: 639 }, 1280));
  assert.ok(!motion.shouldStartStreamAction({ ...base, x: 640, action: null }, 1280));
  assert.ok(!motion.shouldStartStreamAction({ ...base, x: 640, actionCompleted: true }, 1280));
  assert.ok(!motion.shouldStartStreamAction({ ...base, x: 640, actionStartedAt: 10 }, 1280));
  assert.ok(!motion.shouldStartStreamAction({ ...base, x: 10, actionTriggerProgress: 0 }, 1280), "not yet fully visible");
});
