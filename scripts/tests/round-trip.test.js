/* Round-trip pins. The importer's contract is that whatever it accepts
   silently must re-export with the same meaning. For in-dialect documents
   that tightens to a fixpoint: serialize, reparse, serialize again, and the
   bytes must not move. */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {lib, readFixture, readReference, normalize} = require("./helpers.js");
const {parseYAML, buildYaml} = lib;
const example = require("./fixtures/builder-example.js");

test("the builder example round-trips to a byte-for-byte fixpoint", () => {
  const y1 = buildYaml(example);
  const issues = [];
  const y2 = buildYaml(parseYAML(y1, issues));
  assert.deepEqual(issues, []);
  assert.equal(y2, y1);
});

test("the annotated template imports with an empty report", () => {
  const issues = [];
  parseYAML(readReference("prompt-template-annotated.yaml"), issues);
  assert.deepEqual(issues, []);
});

test("the annotated template round-trips to a byte-for-byte fixpoint", () => {
  const doc = parseYAML(readReference("prompt-template-annotated.yaml"));
  const y1 = buildYaml(doc);
  const issues = [];
  const y2 = buildYaml(parseYAML(y1, issues));
  assert.deepEqual(issues, []);
  assert.equal(y2, y1);
});

test("re-exporting the annotated template preserves every parsed value", () => {
  const doc = parseYAML(readReference("prompt-template-annotated.yaml"));
  const doc2 = parseYAML(buildYaml(doc));
  assert.deepEqual(doc2, doc);
});

test("a document that omits optional groups round-trips once normalized", () => {
  const issues = [];
  const doc = parseYAML(readFixture("partial-groups.yaml"), issues);
  assert.deepEqual(issues, []);
  const y1 = buildYaml(normalize(doc));
  const y2 = buildYaml(normalize(parseYAML(y1)));
  assert.equal(y2, y1);
});

test("the golden fixture parses back with an empty report", () => {
  const issues = [];
  parseYAML(readFixture("builder-example.yaml"), issues);
  assert.deepEqual(issues, []);
});
