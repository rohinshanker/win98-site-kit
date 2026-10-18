import assert from "node:assert/strict";
import test from "node:test";
import { normalizeConfig } from "../template/kit/config.js";

test("defaults fill every section", () => {
  const config = normalizeConfig({});
  assert.equal(config.title, "My Desktop");
  assert.equal(config.desktop, "*");
  assert.equal(config.dock, "*");
  assert.equal(config.background.mode, "image");
  assert.equal(config.background.allowCustom, true);
  assert.equal(config.calendar.enabled, true);
  assert.deepEqual(config.calendar.photos, {});
  assert.equal(config.cursor.enabled, false);
  assert.equal(config.cursor.packs.light, "assets/cursors/light");
  assert.equal(config.clock.hour12, true);
  assert.ok(Object.isFrozen(config));
});

test("calendar photos accept MM-DD and YYYY-MM-DD and normalize strings", () => {
  const config = normalizeConfig({
    calendar: { photos: { "10-31": "a.jpg", "2026-01-01": { title: "New Year", image: "b.jpg" } } },
  });
  assert.deepEqual(config.calendar.photos["10-31"], { title: "", image: "a.jpg", alt: "" });
  assert.deepEqual(config.calendar.photos["2026-01-01"], { title: "New Year", image: "b.jpg", alt: "New Year" });
});

test("invalid calendar keys and missing images are rejected", () => {
  assert.throws(() => normalizeConfig({ calendar: { photos: { "31-10": "a.jpg" } } }), /MM-DD or YYYY-MM-DD/);
  assert.throws(() => normalizeConfig({ calendar: { photos: { "10-31": { title: "x" } } } }), /image/);
});

test("background modes are validated", () => {
  assert.throws(() => normalizeConfig({ background: { mode: "video" } }), /background.mode/);
  assert.throws(() => normalizeConfig({ background: { mode: "time-of-day" } }), /timeOfDay\.sunrise/);
  const config = normalizeConfig({
    background: {
      mode: "time-of-day",
      timeOfDay: { sunrise: "s.png", day: "d.png", sunset: "e.png", night: "n.png" },
      choices: [{ label: "Teal", color: "#008080" }],
    },
  });
  assert.equal(config.background.timeOfDay.night, "n.png");
  assert.deepEqual(config.background.choices, [{ label: "Teal", image: "", color: "#008080" }]);
  assert.throws(() => normalizeConfig({ background: { choices: [{ image: "x.png" }] } }), /label/);
});

test("title must be a non-empty string", () => {
  assert.throws(() => normalizeConfig({ title: "   " }), /title/);
  assert.throws(() => normalizeConfig(null), /object/);
});
