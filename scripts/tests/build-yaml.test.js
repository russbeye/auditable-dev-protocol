/* Serialization pins for buildYaml. The golden fixture is the strongest pin:
   the builder example state must serialize to those exact bytes. When a
   deliberate change moves them, regenerate the fixture with the command in
   fixtures/builder-example.js and review the diff. */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {lib, readFixture, normalize} = require("./helpers.js");
const {buildYaml} = lib;
const example = require("./fixtures/builder-example.js");

test("the builder example serializes to the golden fixture byte for byte", () => {
  assert.equal(buildYaml(example), readFixture("builder-example.yaml"));
});

test("top-level keys keep the template order", () => {
  const y = buildYaml(example);
  const order = [
    "schema_version:", "task:", "preamble:", "role:", "prompt:", "constraints:",
    "context:", "lessons_learned:", "output:", "requirements:", "protocol:"
  ];
  let prev = -1;
  for (const key of order) {
    const at = key === "schema_version:" ? y.indexOf(key) : y.indexOf("\n" + key);
    assert.ok(at > prev, key + " appears after the key before it");
    prev = at;
  }
});

test("empty optional groups are omitted from the output", () => {
  const y = buildYaml(normalize({}));
  for (const key of ["preamble:", "role:", "constraints:", "context:", "lessons_learned:"]) {
    assert.ok(!y.includes(key), key + " is absent");
  }
});

test("the constant groups are emitted even when empty", () => {
  const y = buildYaml(normalize({}));
  for (const key of ["schema_version:", "task:", "output:", "requirements:", "protocol:"]) {
    assert.ok(y.includes(key), key + " is present");
  }
});

test("quoted values escape backslashes and double quotes", () => {
  const y = buildYaml(normalize({task: {title: 'say "hi" \\ done'}}));
  assert.ok(y.includes('  title: "say \\"hi\\" \\\\ done"'));
});

test("multiline prose becomes an indented literal block", () => {
  const y = buildYaml(normalize({prompt: "first\nsecond"}));
  assert.ok(y.includes("prompt: |\n  first\n  second"));
});

test("trailing whitespace is stripped from block values", () => {
  const y = buildYaml(normalize({prompt: "body\n\n"}));
  assert.match(y, /prompt: \|\n  body\n\n[a-z]/);
});

test("the document ends with exactly one newline", () => {
  const y = buildYaml(example);
  assert.ok(y.endsWith("\n"));
  assert.ok(!y.endsWith("\n\n"));
});

test("no run of blank lines survives in the output", () => {
  assert.ok(!/\n{3,}/.test(buildYaml(example)));
  assert.ok(!/\n{3,}/.test(buildYaml(normalize({}))));
});

test("a reference omits its empty optional lines", () => {
  const y = buildYaml(normalize({context: {references: [{path: "a.ts", lines: "", note: ""}]}}));
  assert.ok(y.includes('    - path: "a.ts"'));
  assert.ok(!y.includes("lines:"));
  assert.ok(!y.includes("note:"));
});

test("protocol booleans are emitted bare and artifacts as a list", () => {
  const y = buildYaml(normalize({protocol: {apply: false}}));
  assert.ok(y.includes("  apply: false"));
  assert.ok(y.includes("  artifacts:\n    - decision_log\n    - test_adversary"));
});
