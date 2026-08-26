/* Golden pin for the block-aware decision-log reader. The example carries
   both block classes the reader cuts on — a gate blockquote and a fenced
   snippet — so the rendered bytes prove trailing material lands below the
   grid and the field values stay clean. Regenerate the fixture only for a
   deliberate, reviewed rendering change; the command sits in
   fixtures/dl-trail-example.js. */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {parserLib, readFixture} = require("./helpers.js");
const example = require("./fixtures/dl-trail-example.js");

test("trailing blocks render byte-identical to the golden fixture", () => {
  assert.equal(parserLib.renderDecisionLog(example), readFixture("dl-trail-example.html"));
});

test("no field value carries block material", () => {
  const {entries} = parserLib.parseDLEntries(example);
  assert.equal(entries.length, 2);
  for (const e of entries){
    for (const f of parserLib.parseDLFields(parserLib.dlSplitBody(e.lines).fieldLines)){
      assert.equal(f.value.includes("DL-777"), false);
      assert.equal(f.value.includes("Phase 5 gate"), false);
      assert.equal(f.value.includes("```"), false);
    }
  }
  assert.equal(parserLib.dlEntryStatus(entries[0]), "VALIDATED");
  assert.equal(parserLib.dlEntryStatus(entries[1]), "OPEN");
});

test("the counts read through the same cut as the cards", () => {
  const counts = parserLib.dlStatusCounts(example);
  assert.equal(counts.validated, 1);
  assert.equal(counts.open, 1);
  assert.equal(counts.total, 2);
});
