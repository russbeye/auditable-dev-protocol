/* Unit tests for parseYAML over the dialect the builder emits. Each test pins
   one parser behavior and is named for it, so a failure reads as a sentence
   about what broke. */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {lib} = require("./helpers.js");
const {parseYAML} = lib;

test("a literal block scalar keeps its interior newlines", () => {
  const doc = parseYAML("prompt: |\n  first line\n  second line\n");
  assert.equal(doc.prompt, "first line\nsecond line");
});

test("a literal block scalar drops trailing blank lines", () => {
  const doc = parseYAML("prompt: |\n  body\n\n\n");
  assert.equal(doc.prompt, "body");
});

test("a folded block scalar reads a single line break as a space", () => {
  const doc = parseYAML("prompt: >\n  one\n  two\n");
  assert.equal(doc.prompt, "one two");
});

test("a folded block scalar reads a blank line as a newline", () => {
  const doc = parseYAML("prompt: >\n  one\n\n  two\n");
  assert.equal(doc.prompt, "one\ntwo");
});

test("a folded block scalar keeps literal breaks around a more-indented line", () => {
  const doc = parseYAML("prompt: >\n  one\n    indented\n  two\n");
  assert.equal(doc.prompt, "one\n  indented\ntwo");
});

test("a folded block scalar keeps a leading blank line as a newline", () => {
  const doc = parseYAML("prompt: >\n\n  one\n");
  assert.equal(doc.prompt, "\none");
});

test("a double-quoted string unescapes quotes and backslashes", () => {
  const doc = parseYAML('task:\n  title: "say \\"hi\\" and \\\\ done"\n');
  assert.equal(doc.task.title, 'say "hi" and \\ done');
});

test("a single-quoted string reads a doubled quote as one quote", () => {
  const doc = parseYAML("task:\n  title: 'don''t'\n");
  assert.equal(doc.task.title, "don't");
});

test("true and false parse as booleans, not strings", () => {
  const doc = parseYAML("protocol:\n  apply: true\n  log_assumptions: false\n");
  assert.equal(doc.protocol.apply, true);
  assert.equal(doc.protocol.log_assumptions, false);
});

test("null and the tilde both parse as null", () => {
  const doc = parseYAML("task:\n  id: null\n  title: ~\n");
  assert.equal(doc.task.id, null);
  assert.equal(doc.task.title, null);
});

test("a scalar sequence parses as an array of values", () => {
  const doc = parseYAML('role:\n  priorities:\n    - one\n    - "two"\n');
  assert.deepEqual(doc.role.priorities, ["one", "two"]);
});

test("a sequence of maps parses as an array of objects in order", () => {
  const doc = parseYAML(
    'requirements:\n' +
    '  - id: "R1"\n    statement: "s1"\n    verify: "v1"\n' +
    '  - id: "R2"\n    statement: "s2"\n    verify: "v2"\n'
  );
  assert.deepEqual(doc.requirements, [
    {id: "R1", statement: "s1", verify: "v1"},
    {id: "R2", statement: "s2", verify: "v2"}
  ]);
});

test("a full-line comment does not become a field", () => {
  const doc = parseYAML('# heading\ntask:\n  # inner\n  id: "X"\n');
  assert.deepEqual(doc, {task: {id: "X"}});
});

test("a comment after a plain scalar is not part of the value", () => {
  const doc = parseYAML("task:\n  title: plain value  # note\n");
  assert.equal(doc.task.title, "plain value");
});

test("a comment after a quoted scalar is not part of the value", () => {
  const doc = parseYAML('task:\n  title: "x # y"  # note\n');
  assert.equal(doc.task.title, "x # y");
});

test("a comment after a bare key still opens the nested node below it", () => {
  const doc = parseYAML("role:\n  priorities:  # note\n    - one\n");
  assert.deepEqual(doc.role.priorities, ["one"]);
});

test("a comment after a block scalar header does not break the block", () => {
  const doc = parseYAML("prompt: |  # note\n  body\n");
  assert.equal(doc.prompt, "body");
});

test("a hash without whitespace before it stays inside a plain value", () => {
  const doc = parseYAML("task:\n  id: a#b\n");
  assert.equal(doc.task.id, "a#b");
});

test("blank lines between entries are ignored", () => {
  const doc = parseYAML('task:\n\n  id: "X"\n\n  title: "T"\n');
  assert.deepEqual(doc, {task: {id: "X", title: "T"}});
});

test("tabs count as two spaces of indentation", () => {
  const doc = parseYAML('task:\n\tid: "X"\n');
  assert.equal(doc.task.id, "X");
});

test("CRLF input parses the same as LF input", () => {
  const doc = parseYAML('task:\r\n  id: "X"\r\n');
  assert.equal(doc.task.id, "X");
});

test("a leading document marker is skipped without a report", () => {
  const issues = [];
  const doc = parseYAML('---\ntask:\n  id: "X"\n', issues);
  assert.equal(doc.task.id, "X");
  assert.deepEqual(issues, []);
});

test("input with no content parses to an empty document", () => {
  assert.deepEqual(parseYAML(""), {});
});
