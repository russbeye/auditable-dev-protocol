/* The adp-index/1 contract suite. Valid fixtures must validate clean, every
   invalid fixture must trip the rule its filename names, and the spec and the
   fixture corpus must cover each other: each [fixture] rule has at least one
   invalid fixture, and no fixture cites a rule the spec does not define. */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const lib = require(path.join(__dirname, "..", "adp-index-lib.js"));

const FIXDIR = path.join(__dirname, "fixtures", "index");
const SPEC_PATH = path.join(__dirname, "..", "..", "references", "adp-index-1.md");
const LIB_PATH = path.join(__dirname, "..", "adp-index-lib.js");

const validFiles = fs.readdirSync(path.join(FIXDIR, "valid")).filter(f => f.endsWith(".json")).sort();
const invalidFiles = fs.readdirSync(path.join(FIXDIR, "invalid")).filter(f => f.endsWith(".json")).sort();

function readFixture(kind, name){
  return fs.readFileSync(path.join(FIXDIR, kind, name), "utf8");
}

/* The spec marks each rule with its proof obligation. We parse the markers
   from the document itself so the spec cannot drift from this suite without
   a test going red. */
function specRules(){
  const text = fs.readFileSync(SPEC_PATH, "utf8");
  const rules = new Map();
  for (const m of text.matchAll(/^- \*\*(IDX-\d{3})\*\* \[(fixture|valid|prose)\]/gm)){
    rules.set(m[1], m[2]);
  }
  return rules;
}

test("valid fixtures validate clean", () => {
  assert.ok(validFiles.length >= 3, "expected at least three valid fixtures");
  for (const name of validFiles){
    const doc = JSON.parse(readFixture("valid", name));
    assert.deepEqual(lib.validateIndex(doc), [], "valid/" + name + " should have no findings");
  }
});

test("invalid fixtures trip the rule their filename names", () => {
  for (const name of invalidFiles){
    const rule = name.match(/^IDX-\d{3}/);
    assert.ok(rule, "invalid fixture name must start with a rule id: " + name);
    const doc = JSON.parse(readFixture("invalid", name));
    const findings = lib.validateIndex(doc);
    assert.ok(findings.some(f => f.rule === rule[0]),
      "invalid/" + name + " should trip " + rule[0] + ", got: " +
      JSON.stringify(findings.map(f => f.rule + "@" + f.path)));
  }
});

test("every [fixture] rule has an invalid fixture, and no fixture cites an unknown rule", () => {
  const rules = specRules();
  assert.ok(rules.size >= 30, "spec rule table looks truncated: " + rules.size + " rules parsed");
  const covered = new Set(invalidFiles.map(n => n.slice(0, 7)));
  for (const [rule, marker] of rules){
    if (marker === "fixture"){
      assert.ok(covered.has(rule), "spec rule " + rule + " is marked [fixture] but has no invalid fixture");
    }
  }
  for (const rule of covered){
    assert.equal(rules.get(rule), "fixture", "fixture cites " + rule + " which the spec does not mark [fixture]");
  }
});

test("every rule id the validator emits exists in the spec", () => {
  const rules = specRules();
  const src = fs.readFileSync(LIB_PATH, "utf8");
  for (const m of src.matchAll(/"(IDX-\d{3})"/g)){
    assert.ok(rules.has(m[1]), "lib emits " + m[1] + " which the spec does not define");
  }
});

test("fixture files use the contract serialization", () => {
  for (const [kind, names] of [["valid", validFiles], ["invalid", invalidFiles]]){
    for (const name of names){
      const raw = readFixture(kind, name);
      assert.equal(raw, lib.serializeIndex(JSON.parse(raw)),
        kind + "/" + name + " is not serialized per IDX-028");
    }
  }
});

test("known token vocabularies stay in step with the corpus conventions", () => {
  assert.deepEqual(lib.CONFIDENCE_TOKENS, ["HIGH", "MEDIUM", "LOW"]);
  assert.deepEqual(lib.STATUS_TOKENS, ["OPEN", "VALIDATED", "INVALIDATED", "UNKNOWN"]);
  assert.equal(lib.CANONICAL_ARTIFACTS.length, 9);
});
