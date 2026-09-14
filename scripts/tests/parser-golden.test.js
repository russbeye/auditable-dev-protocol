/* Golden pin for the viewer's renderer. The EXAMPLE document exercises every
   artifact type, so its rendered output is the fixpoint the extraction must
   hold. If this test fails, the renderer's bytes moved. Regenerate the
   fixture only for a deliberate, reviewed rendering change. The command sits
   in fixtures/viewer-example.js. */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {parserLib, readFixture, renderViewerGolden} = require("./helpers.js");
const example = require("./fixtures/viewer-example.js");

// FX004 is the corpus ticket that writes every section kind once. To
// regenerate its render golden, write the output of renderViewerGolden over
// the fixture to fixtures/fx004-render.html, the same way viewer-example.html
// is made.
const fx004 = readFixture("corpus/20260911-FX004-section-vocabulary/audit-log.md");

test("the example document renders byte-identical to the golden fixture", () => {
  assert.equal(renderViewerGolden(example), readFixture("viewer-example.html"));
});

test("the example document has no intro text above its first section", () => {
  assert.equal(parserLib.parseSections(example).intro, "");
});

test("the example exercises the full registry, spine included", () => {
  const {secs} = parserLib.parseSections(example);
  assert.equal(secs.length, 14);
  const metas = secs.map(s => parserLib.metaFor(s.title));
  assert.equal(metas.filter(m => m.spine).length, 1);
  assert.ok(metas.every(m => m.tag !== ""));
});

test("FX004 renders byte-identical to its golden fixture", () => {
  assert.equal(renderViewerGolden(fx004), readFixture("fx004-render.html"));
});

test("FX004 writes the fourteen canonical headings and every other kind exactly once", () => {
  const {secs} = parserLib.parseSections(fx004);
  const counts = {};
  for (const s of secs){ const k = parserLib.metaFor(s.title).kind; counts[k] = (counts[k] || 0) + 1; }
  assert.equal(counts.artifact, 14);
  for (const kind of parserLib.SECTION_KINDS.filter(k => k !== "artifact")) assert.equal(counts[kind], 1, kind);
  assert.equal(secs.length, 14 + parserLib.SECTION_KINDS.length - 1);
});
