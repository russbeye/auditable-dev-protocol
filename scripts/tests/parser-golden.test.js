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
