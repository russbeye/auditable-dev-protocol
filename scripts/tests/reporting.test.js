/* Regression tests for the import report. The contract from
   PB-003-import-fidelity is that nothing is dropped or altered without being
   named, so each test pins both the report entry and the value left behind.
   The report wording is part of that contract, so we assert it verbatim. */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {lib} = require("./helpers.js");
const {parseYAML} = lib;

test("a flow sequence is reported at its key path and kept as plain text", () => {
  const issues = [];
  const doc = parseYAML('role:\n  lens: "L"\n  priorities: ["a", "b"]\n', issues);
  assert.equal(doc.role.priorities, '["a", "b"]');
  assert.deepEqual(issues, ["role.priorities (flow sequence is unsupported; value kept as plain text)"]);
});

test("a flow mapping is reported at its key path and kept as plain text", () => {
  const issues = [];
  const doc = parseYAML("task: {id: X}\n", issues);
  assert.equal(doc.task, "{id: X}");
  assert.deepEqual(issues, ["task (flow mapping is unsupported; value kept as plain text)"]);
});

test("an anchor is reported at its key path and kept as plain text", () => {
  const issues = [];
  const doc = parseYAML("task:\n  id: &shared X\n", issues);
  assert.equal(doc.task.id, "&shared X");
  assert.deepEqual(issues, ["task.id (anchor is unsupported; value kept as plain text)"]);
});

test("an alias is reported at its key path and kept as plain text", () => {
  const issues = [];
  const doc = parseYAML("task:\n  id: *shared\n", issues);
  assert.equal(doc.task.id, "*shared");
  assert.deepEqual(issues, ["task.id (alias is unsupported; value kept as plain text)"]);
});

test("a tag is reported at its key path and kept as plain text", () => {
  const issues = [];
  const doc = parseYAML("task:\n  id: !!str 42\n", issues);
  assert.equal(doc.task.id, "!!str 42");
  assert.deepEqual(issues, ["task.id (tag is unsupported; value kept as plain text)"]);
});

test("the continuation lines of a multiline flow sequence are reported as skipped", () => {
  const issues = [];
  parseYAML('role:\n  priorities: [\n    "a",\n    "b"\n  ]\n', issues);
  assert.deepEqual(issues, [
    "role.priorities (flow sequence is unsupported; value kept as plain text)",
    "lines 3-5 skipped (not recognized as part of any field)"
  ]);
});

test("a second document marker is reported and reading continues", () => {
  const issues = [];
  const doc = parseYAML('task:\n  id: "X"\n---\nother: "Y"\n', issues);
  assert.equal(doc.task.id, "X");
  assert.deepEqual(issues, ['line 3 ("---" marker: multi-document streams are unsupported; still read as one document)']);
});

test("an end-of-document marker is reported and reading continues", () => {
  const issues = [];
  const doc = parseYAML('task:\n  id: "X"\n...\n', issues);
  assert.equal(doc.task.id, "X");
  assert.deepEqual(issues, ['line 3 ("..." marker: multi-document streams are unsupported; still read as one document)']);
});

test("unrecognized lines are reported as one coalesced range", () => {
  const issues = [];
  parseYAML('task:\n  id: "X"\n    stray one\n    stray two\n', issues);
  assert.deepEqual(issues, ["lines 3-4 skipped (not recognized as part of any field)"]);
});

test("keep chomping on a block scalar is reported", () => {
  const issues = [];
  const doc = parseYAML("prompt: |+\n  body\n", issues);
  assert.equal(doc.prompt, "body");
  assert.deepEqual(issues, ['prompt ("+" chomping is unsupported; trailing newlines dropped)']);
});

test("strip chomping on a block scalar is not reported", () => {
  const issues = [];
  const doc = parseYAML("prompt: |-\n  body\n", issues);
  assert.equal(doc.prompt, "body");
  assert.deepEqual(issues, []);
});

// The warning itself lives in the importer, which compares against "1.0". The
// lib's half of that contract is to deliver the value verbatim, as a string,
// however the document spelled it.
test("schema_version reaches the importer verbatim, quoted or not", () => {
  assert.equal(parseYAML('schema_version: "2.0"\n').schema_version, "2.0");
  assert.equal(parseYAML("schema_version: 2.0\n").schema_version, "2.0");
  assert.equal(parseYAML('schema_version: "1.0"\n').schema_version, "1.0");
});

// The flatten-and-report guard lives in the builder's setLine, which can only
// work if the parser hands it the newlines intact. This pins that half.
test("block scalar newlines survive into single-line requirement fields", () => {
  const doc = parseYAML(
    'requirements:\n  - id: "R1"\n    statement: "s"\n    verify: |\n      first\n      second\n'
  );
  assert.equal(doc.requirements[0].verify, "first\nsecond");
});

test("parseYAML without an issues array still parses and does not throw", () => {
  const doc = parseYAML('role:\n  priorities: ["a"]\n');
  assert.equal(doc.role.priorities, '["a"]');
});
