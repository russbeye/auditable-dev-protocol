/* The R8 text baseline. Every screen the vanilla page reaches from the
   fixture corpus must show the text and the labels it showed when the
   baseline was taken. The React screens answer to the same fixture. If this
   test fails, a screen gained, lost, or reworded something a person reads.
   Regenerate the fixture only for a deliberate change that a Decision Log
   entry names, from the repo root:

     node -e "require('./scripts/tests/screen-text.js').captureAll().then(a=>require('fs').writeFileSync('scripts/tests/fixtures/screen-baseline.json',JSON.stringify(a,null,1)+'\n'))"
*/
"use strict";

import {test} from "vitest";
const assert = require("node:assert/strict");
const {JSDOM} = require("jsdom");
const {captureAll, record} = require("./screen-text.js");
const {readFixture} = require("./helpers.js");

test("every screen shows the text and labels its baseline records", async () => {
  const want = JSON.parse(readFixture("screen-baseline.json"));
  const got = await captureAll();
  assert.deepEqual(Object.keys(got), Object.keys(want));
  for (const k of Object.keys(want)) assert.deepEqual(got[k], want[k], k);
}, 60000);

test("a run of sibling text nodes records as one entry, and an element still splits text", () => {
  const d = new JSDOM("<div id=a><p>3 slots used</p><p>a<b>x</b>c</p></div><div id=b><p></p><p>a<b>x</b>c</p></div>").window.document;
  d.querySelector("#b p").append(d.createTextNode("3"), d.createTextNode(" slots"), d.createComment(""), d.createTextNode(" used"));
  assert.deepEqual(record(d.getElementById("b")), record(d.getElementById("a")));
  assert.deepEqual(record(d.getElementById("a")).text, ["3 slots used", "a", "x", "c"]);
});
