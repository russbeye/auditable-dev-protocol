/* The two prompt-lib exports that New task and the tests read. asExported is
   the badge seam: the document validate judges is the export image, with
   buildYaml's omissions applied. exampleDocument is the golden example. */
"use strict";

import {test} from "vitest";
const assert = require("node:assert/strict");
const {lib} = require("./helpers.js");
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
