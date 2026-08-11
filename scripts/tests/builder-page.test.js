/* Page pins for the defers editor (PB-009). These drive the real main IIFE
   through the vm harness in builder-harness.js, so they cover the wiring the
   lib tests cannot reach: the badge, the draft, and the editor's add, clear,
   and example paths. */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {lib, normalize} = require("./helpers.js");
const {bootBuilder} = require("./builder-harness.js");

test("the phase dropdown offers exactly the nine phases", async () => {
  const h = bootBuilder();
  await h.addRow("defers");
  const sel = h.listEls("defers")[0].querySelector('[data-field="phase"]');
  assert.deepEqual(sel._options, [""].concat(lib.PHASES));
});

test("a phase without a reason adds one badge issue with the parity key", async () => {
  const h = bootBuilder();
  const before = h.issueKeys();
  await h.addRow("defers");
  const sel = h.listEls("defers")[0].querySelector('[data-field="phase"]');
  sel.value = "analysis";
  h.fireChange(sel);
  const fresh = h.issueKeys().filter(k => !before.includes(k));
  assert.deepEqual(fresh, ["protocol.defers[0].reason"]);
});

test("defers rows ride the draft across a reload", async () => {
  const h = bootBuilder();
  await h.addRow("defers");
  const row = h.listEls("defers")[0];
  const sel = row.querySelector('[data-field="phase"]');
  const reason = row.querySelector('[data-field="reason"]');
  sel.value = "analysis";
  h.fireChange(sel);
  reason.value = "Manual test pass only this release";
  h.fireInput(reason);
  h.settle();
  const h2 = bootBuilder({storage: h.storage});
  assert.deepEqual(h2.rows("defers"),
    [{phase: "analysis", reason: "Manual test pass only this release"}]);
});

test("a pre-editor draft restores with zero defers rows", () => {
  const storage = new Map();
  const legacy = normalize({task: {id: "legacy-draft"}});
  assert.ok(!("defers" in legacy.protocol));
  storage.set("adp-pb-draft", JSON.stringify(legacy));
  const h = bootBuilder({storage});
  assert.equal(h.$("#t_id").value, "legacy-draft");
  assert.deepEqual(h.rows("defers"), []);
});

test("an empty defers editor exports no defers key", async () => {
  const h = bootBuilder();
  const y = await h.exportYaml();
  assert.ok(!y.includes("defers"));
  // The pristine export must match the pre-editor state shape byte for byte.
  // Only the seeded date differs from an all-empty document.
  assert.equal(y, lib.buildYaml(normalize({task: {date: h.$("#t_date").value}})));
});

test("Clear resets phase selections along with the rest of the form", async () => {
  const h = bootBuilder();
  await h.addRow("defers");
  const row = h.listEls("defers")[0];
  row.querySelector('[data-field="phase"]').value = "hypothesis";
  row.querySelector('[data-field="reason"]').value = "r";
  await h.click(h.$("#clear"));
  assert.deepEqual(h.rows("defers"), [{phase: "", reason: ""}]);
});

test("loading the example fills the defers editor from the example document", async () => {
  const h = bootBuilder();
  await h.click(h.$("#example"));
  assert.deepEqual(h.rows("defers"), [
    {phase: "communication", reason: "Ships behind the existing signup flag, so no deploy note goes out"},
    {phase: "the_loop", reason: "Follow-up obligations ride the GROW-6688 cleanup ticket"}
  ]);
  // The loaded example must serialize to the same bytes as its fixture twin,
  // which build-yaml.test.js pins to the golden.
  const y = await h.exportYaml();
  assert.equal(y, lib.buildYaml(require("./fixtures/builder-example.js")));
});

test("the defers controls carry accessible names and button semantics", async () => {
  const h = bootBuilder();
  await h.addRow("defers");
  const row = h.listEls("defers")[0];
  assert.equal(row.querySelector('[data-field="phase"]').getAttribute("aria-label"), "phase");
  assert.equal(row.querySelector('[data-field="reason"]').getAttribute("aria-label"), "reason");
  const rm = row.querySelector(".rm");
  assert.equal(rm.tagName, "BUTTON");
  assert.equal(rm.getAttribute("aria-label"), "remove");
});

test("the editor adds no live region and keeps a real add button", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "prompt-builder.html"), "utf8");
  assert.equal((html.match(/aria-live/g) || []).length, 1);
  assert.match(html, /<button class="add" data-add="defers">\+ add deferral<\/button>/);
});
