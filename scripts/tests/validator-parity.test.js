/* Validator parity suite. One fixture corpus, two
   entry points, zero tolerated drift.

   Every fixture under fixtures/parity/ is judged three ways. The manifest
   states the expected flagged keys, scripts/validate-prompt.mts runs on the
   file, and the lib's validate() runs directly on the parsed document. All
   three must produce the same key set. The manifest is the contract, so
   flipping one expectation must fail the run.

   The CLI refuses a mapping that parseYAML cannot read whole, and exits 2
   in place of a verdict. No fixture is such a mapping, so every fixture
   gets its verdict through the CLI.

   Runs with the rest of the suite:  npm test */
"use strict";

const {test} = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {spawnSync} = require("node:child_process");
const {lib} = require("./helpers.js");

const CORPUS = path.join(__dirname, "fixtures", "parity");
const VALIDATOR = path.join(__dirname, "..", "validate-prompt.mts");
const LIB = path.join(__dirname, "..", "adp-prompt-lib.js");
const MANIFEST = JSON.parse(fs.readFileSync(path.join(CORPUS, "manifest.json"), "utf8"));

const sortedKeys = errs => [...new Set(errs.map(e => e[0]))].sort();

function jsKeys(text){
  return sortedKeys(lib.validate(lib.parseYAML(text)));
}

function run(relPath){
  return spawnSync(process.execPath, [VALIDATOR, path.join(CORPUS, relPath)], {encoding: "utf8"});
}

function cliKeys(relPath){
  const res = run(relPath);
  if (res.status === 0) return [];
  if (res.status === 1){
    // Every message begins with the key it flags, so the first token is the
    // whole flagged-key contract. Message wording stays out of scope.
    const keys = res.stdout.split("\n")
      .filter(line => line.startsWith("  - "))
      .map(line => line.slice(4).split(/\s/, 1)[0]);
    return [...new Set(keys)].sort();
  }
  throw new Error(`validate-prompt.mts exited ${res.status} on ${relPath}: ${res.stderr || res.stdout}`);
}

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
    const js = jsKeys(fs.readFileSync(path.join(CORPUS, file), "utf8"));
    assert.deepStrictEqual(js, want, `${file}: the JS validate() disagrees with the manifest`);
    assert.deepStrictEqual(cliKeys(file), want, `${file}: validate-prompt.mts disagrees with the manifest`);
  });
}

test("the CLI prints VALID and exits 0 on a clean file", () => {
  const res = run("valid/minimal.yaml");
  assert.strictEqual(res.status, 0);
  assert.strictEqual(res.stdout, `VALID: ${path.join(CORPUS, "valid/minimal.yaml")}\n`);
});

test("the CLI gives the root verdict when the parse yields nothing, even with issues", () => {
  // root-list.yaml is a sequence at the root. parseYAML drops both lines and
  // returns {}, so no mapping exists to misjudge.
  const issues = [];
  lib.parseYAML(fs.readFileSync(path.join(CORPUS, "invalid/root-list.yaml"), "utf8"), issues);
  assert.ok(issues.length > 0);
  const res = run("invalid/root-list.yaml");
  assert.strictEqual(res.status, 1);
  assert.deepStrictEqual(cliKeys("invalid/root-list.yaml"), ["root"]);
});

test("the CLI exits 2 on a construct outside the subset and names it", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "adp-validate-"));
  const file = path.join(dir, "flow.yaml");
  const minimal = fs.readFileSync(path.join(CORPUS, "valid", "minimal.yaml"), "utf8");
  fs.writeFileSync(file, minimal + "constraints: {a: 1}\n");
  const res = spawnSync(process.execPath, [VALIDATOR, file], {encoding: "utf8"});
  fs.rmSync(dir, {recursive: true, force: true});
  assert.strictEqual(res.status, 2);
  assert.strictEqual(res.stdout, "");
  assert.match(res.stderr, /flow mapping/);
});

test("the CLI exits 2 on bytes that are not UTF-8", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "adp-validate-"));
  const file = path.join(dir, "latin1.yaml");
  const minimal = fs.readFileSync(path.join(CORPUS, "valid", "minimal.yaml"));
  fs.writeFileSync(file, Buffer.concat([minimal, Buffer.from("# caf\xe9\n", "latin1")]));
  const res = spawnSync(process.execPath, [VALIDATOR, file], {encoding: "utf8"});
  fs.rmSync(dir, {recursive: true, force: true});
  assert.strictEqual(res.status, 2);
  assert.match(res.stderr, /could not read/);
});

test("the CLI exits 2 on a usage error and on a missing file", () => {
  assert.strictEqual(spawnSync(process.execPath, [VALIDATOR], {encoding: "utf8"}).status, 2);
  const missing = spawnSync(process.execPath, [VALIDATOR, path.join(CORPUS, "no-such.yaml")], {encoding: "utf8"});
  assert.strictEqual(missing.status, 2);
  assert.match(missing.stderr, /could not read/);
});

/* Requirement R2: every rule in validate() has at least one fixture that
   trips it. BRANCHES lists every message-key family validate() can emit,
   with list indexes generalized to []. If you add a rule to validate() in
   adp-prompt-lib.js, add its family here and a fixture that trips it. */
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

test("every rule family is tripped by at least one fixture", () => {
  const covered = new Set(
    Object.values(MANIFEST).flat().map(k => k.replace(/\[\d+\]/g, "[]")));
  const missing = BRANCHES.filter(b => !covered.has(b));
  assert.deepStrictEqual(missing, [], "rule families with no fixture");
});

test("validate() has not grown rules the corpus does not know", () => {
  // A count pin is a blunt tripwire, and that is the point. A new rule site
  // fails this test until BRANCHES and the corpus grow with it.
  const src = fs.readFileSync(LIB, "utf8");
  const start = src.indexOf("function validate(raw)");
  const body = src.slice(start, src.indexOf("\n  }\n", start));
  assert.strictEqual((body.match(/e\.push\(/g) || []).length, 29, "e.push() sites in validate()");
  assert.strictEqual((body.match(/return \[\[/g) || []).length, 1, "early-return verdicts in validate()");
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

test("an empty parse gets the root verdict", () => {
  // parseYAML collapses an empty text to {}. An empty file has no mapping at
  // its root, so validate() answers with the root flag alone.
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
