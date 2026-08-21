/* Page pins that drive the real main IIFE through the vm harness in
   builder-harness.js, so they cover the wiring the lib tests cannot reach:
   the defers editor's badge, draft, add, clear, and example paths, and the
   checks panel's rendered row text. */
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
    {phase: "obligations", reason: "Follow-up obligations ride the GROW-6688 cleanup ticket"}
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

test("the page's blank state matches the lib's blank document", async () => {
  const h = bootBuilder();
  // The seeded date is the page's one deliberate non-blank default. We clear
  // it so the export shows only the shape both sides share.
  h.$("#t_date").value = "";
  h.fireInput(h.$("#t_date"));
  const y = await h.exportYaml();
  assert.equal(y, lib.buildYaml(lib.blankDocument()));
});

/* The badge validates the export image of the form, and these pins hold the
   canonical states to their exact issue keys. issueKeys() reads the panel in
   document order, so a reordered emission fails the same pin. */

const BLANK_KEYS = ["task.id", "task.title", "task.author", "prompt",
  "output.format", "output.destination", "requirements"];

test("the blank form pins its exact issue keys", () => {
  const h = bootBuilder();
  assert.deepEqual(h.issueKeys(), BLANK_KEYS);
});

test("a blank form plus one defers row pins its exact issue keys", async () => {
  const h = bootBuilder();
  await h.addRow("defers");
  assert.deepEqual(h.issueKeys(),
    BLANK_KEYS.concat(["protocol.defers[0].phase", "protocol.defers[0].reason"]));
});

test("the loaded example pins a VALID badge with no issues", async () => {
  const h = bootBuilder();
  await h.click(h.$("#example"));
  assert.deepEqual(h.issueKeys(), []);
  assert.equal(h.$("#status-txt").textContent, "VALID");
});

test("a priorities row without a lens adds exactly the role.lens issue", async () => {
  const h = bootBuilder();
  await h.addRow("priorities");
  const inp = h.listEls("priorities")[0].querySelector("input");
  inp.value = "ship it";
  h.fireInput(inp);
  assert.deepEqual(h.issueKeys(), ["task.id", "task.title", "task.author",
    "role.lens", "prompt", "output.format", "output.destination", "requirements"]);
});

test("an all-empty lessons row keeps a later flagged row on its own index", async () => {
  const h = bootBuilder();
  await h.addRow("lessons_learned");
  await h.addRow("lessons_learned");
  const ctx = h.listEls("lessons_learned")[1].querySelector('[data-field="context"]');
  ctx.value = "only context";
  h.fireInput(ctx);
  const keys = h.issueKeys();
  assert.ok(keys.includes("lessons_learned[1]"));
  assert.ok(!keys.includes("lessons_learned[0]"));
});

test("an all-empty requirement row before a partial one keeps the filtered index", async () => {
  const h = bootBuilder();
  await h.addRow("requirements");
  await h.addRow("requirements");
  const rid = h.listEls("requirements")[1].querySelector('[data-field="id"]');
  rid.value = "R9";
  h.fireInput(rid);
  const keys = h.issueKeys();
  assert.ok(keys.includes("requirements[0].statement"));
  assert.ok(keys.includes("requirements[0].verify"));
  assert.ok(!keys.includes("requirements"));
});

test("every unmet check row prints its key and the fixed word required", async () => {
  const h = bootBuilder();
  await h.addRow("defers");
  const rows = [...h.$("#issues-list").innerHTML.matchAll(/<li>([\s\S]*?)<\/li>/g)].map(m => m[1]);
  // An empty form plus one defers row flags six required fields, the
  // requirements aggregate, and the new row's phase and reason.
  assert.equal(rows.length, 9);
  for (const row of rows) assert.match(row, /^<code>[^<]+<\/code> — required$/);
  const keys = h.issueKeys();
  assert.ok(keys.includes("output.format"));
  assert.ok(keys.includes("protocol.defers[0].phase"));
});
