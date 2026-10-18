import assert from "node:assert/strict";
import test from "node:test";
import { expandPlacement, normalizeApp, normalizeApps, normalizeWindowOptions } from "../template/kit/apps.js";

const minimal = { id: "demo", title: "Demo", icon: "assets/x.ico" };

test("a minimal app gets a close-only window and no hooks", () => {
  const app = normalizeApp(minimal);
  assert.equal(app.hasWindow, true);
  assert.equal(app.isLink, false);
  assert.deepEqual(app.window.controls, ["close"]);
  assert.equal(app.label, "Demo");
  assert.deepEqual(app.hooks, {});
  assert.equal(app.render(), "");
});

test("link apps and windowless apps are recognised", () => {
  const link = normalizeApp({ ...minimal, href: "https://example.com" });
  assert.equal(link.isLink, true);
  assert.equal(link.hasWindow, false);
  assert.equal(link.window, null);
  const windowless = normalizeApp({ ...minimal, window: false, onLaunch: () => true });
  assert.equal(windowless.hasWindow, false);
  assert.equal(typeof windowless.hooks.onLaunch, "function");
  assert.throws(() => normalizeApp({ ...minimal, window: false }), /onLaunch/);
});

test("ids, icons, styles and controls are validated", () => {
  assert.throws(() => normalizeApp({ ...minimal, id: "Bad Id" }), /kebab-case/);
  assert.throws(() => normalizeApp({ ...minimal, icon: "" }), /icon/);
  assert.throws(() => normalizeApp({ ...minimal, styles: "a.css" }), /styles/);
  assert.throws(() => normalizeWindowOptions({ controls: ["shade"] }, "demo"), /controls/);
  assert.throws(() => normalizeApps([minimal, minimal]), /Duplicate app id/);
});

test("extra windows are normalized and must not collide", () => {
  const app = normalizeApp({ ...minimal, windows: [{ id: "demo-rules", title: "Rules", onOpen() {} }] });
  assert.equal(app.windows[0].id, "demo-rules");
  assert.equal(typeof normalizeApp({ ...minimal, onHelp() {} }).hooks.onHelp, "function");
  assert.equal(typeof app.windows[0].hooks.onOpen, "function");
  assert.throws(
    () => normalizeApps([{ ...minimal, windows: [{ id: "other", title: "x" }] }, { ...minimal, id: "other" }]),
    /Duplicate (?:app|window) id other/
  );
});

test("placement expands the wildcard and rejects unknown ids", () => {
  const installed = ["about", "credits", "projects", "socials"];
  assert.deepEqual(expandPlacement("*", installed, "desktop"), installed);
  assert.deepEqual(expandPlacement(undefined, installed, "desktop"), installed);
  assert.deepEqual(expandPlacement(["projects", "*", "about"], installed, "desktop"), [
    "projects",
    "credits",
    "socials",
    "about",
  ]);
  assert.deepEqual(expandPlacement(["socials"], installed, "dock"), ["socials"]);
  assert.throws(() => expandPlacement(["nope"], installed, "dock"), /unknown app "nope"/);
  assert.throws(() => expandPlacement("all", installed, "dock"), /array/);
});
