import assert from "node:assert/strict";
import test from "node:test";

globalThis.window ??= { matchMedia: undefined };
const util = await import("../template/kit/util.js");

test("clamp, pad2, escapeHtml, formatElapsedTime and localDateKey", () => {
  assert.equal(util.clamp(5, 0, 3), 3);
  assert.equal(util.clamp(-1, 0, 3), 0);
  assert.equal(util.pad2(7), "07");
  assert.equal(util.escapeHtml(`<a href="x">'&'</a>`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  assert.equal(util.formatElapsedTime(125), "02:05");
  assert.equal(util.formatElapsedTime(Number.NaN), "—");
  assert.equal(util.localDateKey(new Date(2026, 0, 5)), "2026-01-05");
});

test("shuffle keeps every item", () => {
  const items = [1, 2, 3, 4, 5];
  assert.deepEqual([...util.shuffle(items)].sort(), items);
});

test("createProgressLoader reaches 100 when ready and can be cancelled", () => {
  let clock = 0;
  const timers = [];
  const progress = [];
  let ready = false;
  const loader = util.createProgressLoader({
    progressCap: 96,
    isReady: () => ready,
    nextProgress: ({ elapsedMs, durationMs }) => Math.min(96, (elapsedMs / durationMs) * 100),
    nextDelay: () => 50,
    onProgress: (value) => progress.push(value),
    onReady: () => progress.push("ready"),
    now: () => clock,
    setTimer: (callback) => {
      timers.push(callback);
      return timers.length;
    },
    clearTimer: () => {},
  });
  loader.start({ duration: 100 });
  assert.equal(progress[0], 0);
  const tick = () => {
    const callback = timers.shift();
    callback();
  };
  clock = 50;
  tick();
  assert.equal(progress.at(-1), 50);
  clock = 150;
  tick();
  assert.equal(progress.at(-1), 96, "holds at the cap until ready");
  ready = true;
  tick();
  assert.deepEqual(progress.slice(-2), [100, "ready"]);
  assert.equal(loader.snapshot().running, false);

  loader.start({ duration: 100 });
  loader.cancel();
  const stale = timers.shift();
  stale();
  assert.equal(progress.at(-1), 0, "a cancelled loader does not report progress");
});
