/* The R8 record step. The app tests compare every screen against
   fixtures/screen-baseline.json, which the vanilla page wrote before it was
   retired. No page can write the fixture again, so a deliberate change to
   what a screen shows edits the fixture by hand, under a Decision Log entry
   that names the change. */
"use strict";

import {test} from "vitest";
const assert = require("node:assert/strict");
const {JSDOM} = require("jsdom");
const {record} = require("./screen-text.js");

test("a run of sibling text nodes records as one entry, and an element still splits text", () => {
  const d = new JSDOM("<div id=a><p>3 slots used</p><p>a<b>x</b>c</p></div><div id=b><p></p><p>a<b>x</b>c</p></div>").window.document;
  d.querySelector("#b p").append(d.createTextNode("3"), d.createTextNode(" slots"), d.createComment(""), d.createTextNode(" used"));
  assert.deepEqual(record(d.getElementById("b")), record(d.getElementById("a")));
  assert.deepEqual(record(d.getElementById("a")).text, ["3 slots used", "a", "x", "c"]);
});
