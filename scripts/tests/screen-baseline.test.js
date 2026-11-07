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
const {captureAll} = require("./screen-text.js");
const {readFixture} = require("./helpers.js");

test("every screen shows the text and labels its baseline records", async () => {
  const want = JSON.parse(readFixture("screen-baseline.json"));
  const got = await captureAll();
  assert.deepEqual(Object.keys(got), Object.keys(want));
  for (const k of Object.keys(want)) assert.deepEqual(got[k], want[k], k);
}, 60000);
