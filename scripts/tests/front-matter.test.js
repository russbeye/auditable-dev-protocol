"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const lib = require(path.join(__dirname, "..", "adp-parser-lib.js"));

test("a well-formed block splits off and sections start clean", () => {
  const md = "---\nstate: open\npr: \"#7\"\n---\n# Title\n\n## Problem Statement\nBody\n";
  const fm = lib.splitFrontMatter(md);
  assert.equal(fm.front, "state: open\npr: \"#7\"");
  const p = lib.parseSections(md);
  assert.equal(p.front, fm.front);
  assert.equal(p.intro, "# Title");
  assert.equal(p.secs.length, 1);
});

test("an unclosed opener stays content", () => {
  const md = "---\nstate: open\nno closer here\n";
  assert.equal(lib.splitFrontMatter(md).front, null);
  assert.equal(lib.splitFrontMatter(md).rest, md);
});

test("a horizontal rule followed by prose stays content", () => {
  const md = "---\nJust prose, not a key pair.\n---\nrest of the document\n";
  const fm = lib.splitFrontMatter(md);
  assert.equal(fm.front, null);
  assert.equal(fm.rest, md);
});

test("only byte zero opens a block", () => {
  const md = "\n---\nstate: open\n---\n";
  assert.equal(lib.splitFrontMatter(md).front, null);
});

test("a frontless document keeps its exact intro and sections", () => {
  const md = "# Plain\n\n## One\nbody\n";
  const p = lib.parseSections(md);
  assert.equal(p.front, null);
  assert.equal(p.intro, "# Plain");
  assert.equal(p.secs.length, 1);
});

test("Phase N titles attribute to their phase", () => {
  assert.equal(lib.metaFor("Phase 3: Hypothesis").tag, "P3");
  assert.equal(lib.metaFor("Phase 9: Obligations").tag, "P9");
  // An artifact name inside a prefix title hits the artifact row first, and
  // both rows agree on the phase.
  assert.equal(lib.metaFor("Phase 4: Pre-Mortem Report").tag, "P4");
  // No numeric prefix, no attribution.
  assert.equal(lib.metaFor("Phases and stages").tag, "");
  // Two digits never collapse onto a single-digit phase.
  assert.equal(lib.metaFor("Phase 10: Extra").tag, "");
});

test("splitRow and isTableStart are exported for the builder", () => {
  assert.deepEqual(lib.splitRow("| a | `b|c` | d |"), ["a", "`b|c`", "d"]);
  assert.equal(lib.isTableStart(["| a | b |", "|---|---|"], 0), true);
  assert.equal(lib.isTableStart(["plain prose", "more prose"], 0), false);
});
