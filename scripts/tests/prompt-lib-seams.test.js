/* The two prompt-lib exports the shell's builder screen reads, held to the
   standalone builder's private copies. asExported is the badge seam: the
   document validate judges is the export image, with buildYaml's omissions
   applied. exampleDocument is the one example both pages load. The parity
   tests boot the real standalone page through builder-harness.js and read
   its badge, so the page's copy and the lib's cannot drift apart silently
   while the page still carries one. */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {lib} = require("./helpers.js");
const {bootBuilder} = require("./builder-harness.js");
const fixture = require("./fixtures/builder-example.js");

// asExported edits its argument, so the seam reads a copy, as the page does.
const keysOf = d => lib.validate(lib.asExported(JSON.parse(JSON.stringify(d)))).map(([k]) => k);

test("exampleDocument equals the golden example fixture and hands out a fresh copy", () => {
  assert.deepEqual(lib.exampleDocument(), fixture);
  const a = lib.exampleDocument();
  a.task.id = "changed";
  assert.equal(lib.exampleDocument().task.id, fixture.task.id);
});

test("asExported drops an all-blank role and placeholders an empty requirement or lesson row", () => {
  const d = lib.blankDocument();
  d.requirements = [{id: "", statement: "", verify: ""}, {id: "R1", statement: "s", verify: "v"}];
  d.lessons_learned = [{context: "", takeaway: ""}, {context: "c", takeaway: ""}];
  const out = lib.asExported(JSON.parse(JSON.stringify(d)));
  assert.equal("role" in out, false);
  assert.deepEqual(out.requirements, [{id: "-", statement: "-", verify: "-"}, {id: "R1", statement: "s", verify: "v"}]);
  // A list with no real row keeps the filter, so the panel asks for a
  // requirement instead of reading a placeholder as one.
  const e = lib.blankDocument();
  e.requirements = [{id: "", statement: "", verify: ""}];
  assert.deepEqual(lib.asExported(JSON.parse(JSON.stringify(e))).requirements, []);
  assert.deepEqual(keysOf(e).filter(k => /requirements/.test(k)), ["requirements"]);
  // The empty row keeps its index as a passing placeholder, so the flagged
  // row behind it still reads lessons_learned[1].
  assert.deepEqual(out.lessons_learned, [{context: "-", takeaway: "-"}, {context: "c", takeaway: ""}]);
  assert.ok(keysOf(d).includes("lessons_learned[1]"));
  // A role with a lens stays.
  const r = lib.blankDocument();
  r.role.lens = "lens";
  assert.equal(lib.asExported(r).role.lens, "lens");
});

// ---- parity with the standalone page ----

test("the blank form's badge on the standalone equals the lib seam over the blank document", () => {
  const h = bootBuilder();
  // The page seeds today's date; the lib's blank document has none.
  h.$("#t_date").value = "";
  h.fireInput(h.$("#t_date"));
  assert.deepEqual(h.issueKeys(), keysOf(lib.blankDocument()));
});

test("the loaded example is VALID on the standalone and issue-free through the lib seam", async () => {
  const h = bootBuilder();
  await h.click(h.$("#example"));
  assert.equal(h.statusText(), "VALID");
  const d = lib.exampleDocument();
  d.schema_version = "1.0";
  assert.deepEqual(keysOf(d), []);
  assert.deepEqual(h.issueKeys(), []);
});

test("a partly filled form flags the same keys on the standalone and through the lib seam", () => {
  const h = bootBuilder();
  h.$("#t_date").value = "";
  h.fireInput(h.$("#t_date"));
  const req = h.listEls("requirements")[0].querySelector('[data-field="id"]');
  req.value = "R1";
  h.fireInput(req);
  const les = h.listEls("lessons_learned")[0].querySelector('[data-field="context"]');
  les.value = "tried once";
  h.fireInput(les);
  const d = lib.blankDocument();
  d.requirements = [{id: "R1", statement: "", verify: ""}];
  d.lessons_learned = [{context: "tried once", takeaway: ""}];
  assert.deepEqual(h.issueKeys(), keysOf(d));
});

test("asExported is total over a document normalize has not filled, and hides nothing from validate", () => {
  // Each omission reads the shape it omits, so a raw document comes back as it
  // went in and validate still judges the structure its author wrote.
  const raws = [{task: {id: "T-1"}}, {role: {lens: "x"}}, {requirements: "x", lessons_learned: "s"},
    {requirements: ["x", {id: "R1", statement: "s", verify: "v"}]}, {lessons_learned: [null]}, null, []];
  for (const raw of raws){
    const note = JSON.stringify(raw);
    assert.deepEqual(lib.asExported(JSON.parse(JSON.stringify(raw))), raw, note);
    assert.deepEqual(keysOf(raw), lib.validate(JSON.parse(JSON.stringify(raw))).map(([k]) => k), note);
  }
});
