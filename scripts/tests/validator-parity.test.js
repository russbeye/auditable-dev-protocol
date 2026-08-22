/* Validator parity suite. One fixture corpus, two
   validators, zero tolerated drift.

   Every fixture under fixtures/parity/ is judged three ways. The manifest
   states the expected flagged keys, scripts/validate-prompt.py runs on the
   file, and the lib's validate() runs directly on the parsed document. All
   three must produce the same key set. The manifest is the contract, so
   flipping one expectation must fail the run.

   The corpus stays inside the builder's YAML dialect. Use quoted strings and
   real booleans. A typed plain scalar, for example an unquoted date, parses
   as a string here and as a richer type under PyYAML. That mismatch lives in
   the parsers, not the validators, and this suite does not judge it.

   Runs with the rest of the suite:  node --test scripts/tests/*.test.js
   Needs python3 with PyYAML on PATH. We fail loudly when either is missing,
   because a skipped parity check reads as parity that was never checked. */
"use strict";

const {test, before} = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const {spawnSync} = require("node:child_process");
const {lib} = require("./helpers.js");

const CORPUS = path.join(__dirname, "fixtures", "parity");
const VALIDATOR = path.join(__dirname, "..", "validate-prompt.py");
const MANIFEST = JSON.parse(fs.readFileSync(path.join(CORPUS, "manifest.json"), "utf8"));

const sortedKeys = errs => [...new Set(errs.map(e => e[0]))].sort();

function jsKeys(text){
  return sortedKeys(lib.validate(lib.parseYAML(text)));
}

function pyKeys(relPath){
  const res = spawnSync("python3", [VALIDATOR, path.join(CORPUS, relPath)], {encoding: "utf8"});
  if (res.status === 0) return [];
  if (res.status === 1){
    // Every message begins with the key it flags, so the first token is the
    // whole flagged-key contract. Message wording stays out of scope.
    const keys = res.stdout.split("\n")
      .filter(line => line.startsWith("  - "))
      .map(line => line.slice(4).split(/\s/, 1)[0]);
    return [...new Set(keys)].sort();
  }
  throw new Error(`validate-prompt.py exited ${res.status} on ${relPath}: ${res.stderr || res.stdout}`);
}

before(() => {
  const probe = spawnSync("python3", ["-c", "import yaml"], {encoding: "utf8"});
  assert.strictEqual(probe.status, 0,
    "the parity suite needs python3 with PyYAML (pip install pyyaml); " +
    "we fail rather than skip, because skipped parity reads as checked parity");
});

test("manifest and fixture directory agree on the corpus", () => {
  const onDisk = [];
  for (const dir of ["valid", "invalid"]){
    for (const f of fs.readdirSync(path.join(CORPUS, dir))) onDisk.push(`${dir}/${f}`);
  }
  assert.deepStrictEqual(onDisk.sort(), Object.keys(MANIFEST).sort());
});

test("the manifest's verdicts match the directory split", () => {
  for (const [file, keys] of Object.entries(MANIFEST)){
    if (file.startsWith("valid/")) assert.deepStrictEqual(keys, [], `${file} sits under valid/ but expects flags`);
    else assert.ok(keys.length > 0, `${file} sits under invalid/ but expects no flags`);
  }
});

for (const [file, expected] of Object.entries(MANIFEST)){
  test(`parity: ${file}`, () => {
    const want = [...expected].sort();
    const py = pyKeys(file);
    const js = jsKeys(fs.readFileSync(path.join(CORPUS, file), "utf8"));
    assert.deepStrictEqual(py, want, `${file}: validate-prompt.py disagrees with the manifest`);
    assert.deepStrictEqual(js, want, `${file}: the JS validate() disagrees with the manifest`);
  });
}

/* Requirement R2: every rule in validate-prompt.py has at least one fixture
   that trips it. BRANCHES lists every message-key family the Python validator
   can emit, with list indexes generalized to []. If you add a rule to
   validate-prompt.py, add its family here and a fixture that trips it. */
const BRANCHES = [
  "root", "schema_version",
  "task", "task.id", "task.title", "task.author", "task.date",
  "role", "role.lens", "role.priorities",
  "preamble", "prompt",
  "constraints", "context", "context.references[].path",
  "lessons_learned", "lessons_learned[]",
  "output", "output.format", "output.destination",
  "requirements", "requirements[]",
  "requirements[].id", "requirements[].statement", "requirements[].verify",
  "protocol", "protocol.apply",
  "protocol.stake_single_recommendation", "protocol.log_assumptions", "protocol.flag_low_confidence",
  "protocol.artifacts",
  "protocol.defers", "protocol.defers[]",
  "protocol.defers[].phase", "protocol.defers[].reason",
];

test("every Python rule family is tripped by at least one fixture", () => {
  const covered = new Set(
    Object.values(MANIFEST).flat().map(k => k.replace(/\[\d+\]/g, "[]")));
  const missing = BRANCHES.filter(b => !covered.has(b));
  assert.deepStrictEqual(missing, [], "rule families with no fixture");
});

test("validate-prompt.py has not grown rules the corpus does not know", () => {
  // A count pin is a blunt tripwire, and that is the point. A new rule site
  // fails this test until BRANCHES and the corpus grow with it.
  const src = fs.readFileSync(VALIDATOR, "utf8");
  const requires = (src.match(/require\(/g) || []).length - (src.match(/def require\(/g) || []).length;
  const appends = (src.match(/errors\.append\(/g) || []).length;
  assert.strictEqual(requires, 27, "require() call sites in validate-prompt.py");
  assert.strictEqual(appends, 3, "errors.append() sites in validate-prompt.py");
});

/* Totality over raw parsed documents. These cases pin the direct path: a
   report always comes back, never a throw, and once the root is a real
   mapping the fill toward the blank shape never hides a required field. */

const RAW_DOCS = {
  "an empty document": "",
  "a task-only document": [
    'schema_version: "1.0"',
    "task:",
    '  id: "T-1"',
    '  title: "Task only"',
    '  author: "a"',
    '  date: "2026-01-01"',
    "",
  ].join("\n"),
  "a document with no role": fs.readFileSync(path.join(CORPUS, "valid", "minimal.yaml"), "utf8"),
  "a hand-written linkless document": fs.readFileSync(path.join(CORPUS, "valid", "hand-written-linkless.yaml"), "utf8"),
};

for (const [name, text] of Object.entries(RAW_DOCS)){
  test(`raw validate returns a report for ${name}`, () => {
    assert.ok(Array.isArray(lib.validate(lib.parseYAML(text))));
  });
}

test("an empty parse gets the root verdict Python gives an empty file", () => {
  // parseYAML collapses an empty text to {}, and PyYAML reads the same text
  // as None, so both sides must answer with the root flag alone.
  assert.deepStrictEqual(sortedKeys(lib.validate(lib.parseYAML(""))), ["root"]);
});

test("dropping one required field keeps its exact flag", () => {
  const minimal = fs.readFileSync(path.join(CORPUS, "valid", "minimal.yaml"), "utf8");
  const noId = lib.parseYAML(minimal);
  delete noId.task.id;
  assert.ok(sortedKeys(lib.validate(noId)).includes("task.id"));
  const noPrompt = lib.parseYAML(minimal);
  delete noPrompt.prompt;
  assert.ok(sortedKeys(lib.validate(noPrompt)).includes("prompt"));
  const noReqs = lib.parseYAML(minimal);
  noReqs.requirements = [];
  assert.ok(sortedKeys(lib.validate(noReqs)).includes("requirements"));
});

test("a hand-written document with no preamble validates clean", () => {
  const text = fs.readFileSync(path.join(CORPUS, "valid", "hand-written-no-preamble.yaml"), "utf8");
  assert.deepStrictEqual(lib.validate(lib.parseYAML(text)), []);
});

test("normalize fills a bare document to the blank shape, except schema_version", () => {
  const n = lib.normalize({});
  assert.strictEqual(n.schema_version, undefined);
  const b = lib.blankDocument();
  n.schema_version = b.schema_version;
  assert.deepStrictEqual(n, b);
});

test("normalize never rewrites a present value", () => {
  const n = lib.normalize({preamble: false, protocol: {artifacts: "not-a-list"}});
  assert.strictEqual(n.preamble, false);
  assert.strictEqual(n.protocol.artifacts, "not-a-list");
});

test("a present protocol block without apply still fails on protocol.apply", () => {
  const keys = sortedKeys(lib.validate({schema_version: "1.0", protocol: {}}));
  assert.ok(keys.includes("protocol.apply"));
});
