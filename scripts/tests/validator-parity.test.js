/* Validator parity suite (PB-005-validator-parity). One fixture corpus, two
   validators, zero tolerated drift.

   Every fixture under fixtures/parity/ is judged three ways. The manifest
   states the expected flagged keys, scripts/validate-prompt.py runs on the
   file, and the lib's validate() runs on the parsed document through the
   docToModel adapter below. All three must produce the same key set. The
   manifest is the contract, so flipping one expectation must fail the run.

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

// Mirror of nonempty_str in validate-prompt.py.
const ne = v => typeof v === "string" && v.trim() !== "";
const isObj = x => x && typeof x === "object" && !Array.isArray(x);
const sortedKeys = errs => [...new Set(errs.map(e => e[0]))].sort();

/* docToModel maps a parsed document onto the gather()-shaped state that
   validate() expects. Unlike the browser import, it never repairs. Raw values
   pass through wherever validate() type-checks them, so a quoted "true" or a
   foreign schema_version is judged, not healed.

   The model cannot represent every wrong shape a document can take. For those
   shapes we emit a structural error that carries the exact key the Python
   validator uses, and we substitute a neutral placeholder that validate()
   accepts. That reproduces Python's control flow, where a failed isinstance
   guard skips the per-field checks inside the group.

   Keep semantic rules out of this adapter. If a rule can be expressed on the
   model, it belongs in validate(), where the browser badge also enforces it. */

const OK_TASK = {id: "-", title: "-", author: "-", date: "-"};
const OK_REQ = {id: "-", statement: "-", verify: "-"};
const OK_LESSON = {context: "-", takeaway: "-"};
const OK_PROTOCOL = {apply: true, stake_single_recommendation: true, log_assumptions: true, flag_low_confidence: true, artifacts: []};

function docToModel(doc){
  const structural = [];
  const flag = (key, why) => structural.push([key, why]);

  // parseYAML can only return a mapping. A root sequence, a root scalar, and
  // an empty file all collapse to an empty object with every line reported as
  // skipped. Python reads those same documents as a non-mapping root, so
  // "nothing recognized" maps to that verdict.
  if (!isObj(doc) || Object.keys(doc).length === 0){
    return {model: null, structural: [["root", "must be a mapping"]]};
  }

  const model = {schema_version: doc.schema_version};

  if (isObj(doc.task)){
    model.task = {id: doc.task.id, title: doc.task.title, author: doc.task.author, date: doc.task.date};
  } else {
    flag("task", "must be a mapping");
    model.task = {...OK_TASK};
  }

  model.role = {lens: "", priorities: []};
  if (isObj(doc.role)){
    model.role.lens = doc.role.lens;
    // The builder cannot hold "role present but empty", because its
    // serializer omits an empty role group. Python flags the lens whenever
    // the role key exists, so the guard lives here.
    if (!ne(doc.role.lens)) flag("role.lens", "must be a non-empty string");
    if ("priorities" in doc.role){
      if (Array.isArray(doc.role.priorities)) model.role.priorities = doc.role.priorities;
      else flag("role.priorities", "must be a list");
    }
  } else if ("role" in doc){
    flag("role", "must be a mapping");
  }

  model.preamble = "preamble" in doc ? doc.preamble : "";
  model.prompt = doc.prompt;

  // Python only checks that these two groups are mappings and never looks
  // inside them, so a neutral model shape is enough.
  model.constraints = {out_of_scope: [], must_not: []};
  if ("constraints" in doc && !isObj(doc.constraints)) flag("constraints", "must be a mapping");

  model.context = {background: "", references: [], links: []};
  if (isObj(doc.context)){
    if (Array.isArray(doc.context.references)){
      // Python's isinstance guard skips a non-mapping reference item, so we
      // substitute an empty reference to keep the later indexes aligned.
      model.context.references = doc.context.references.map(r =>
        isObj(r) ? {path: r.path, lines: r.lines, note: r.note} : {path: "", lines: "", note: ""});
    }
  } else if ("context" in doc){
    flag("context", "must be a mapping");
  }

  if (Array.isArray(doc.lessons_learned)){
    model.lessons_learned = doc.lessons_learned.map((x, i) => {
      if (!isObj(x)){
        flag(`lessons_learned[${i}]`, "must be a mapping");
        return {...OK_LESSON};
      }
      // An item with both fields empty is invisible to validate(), because
      // the builder treats an all-empty row as an absent row and never emits
      // one. Python still flags the item, so the guard lives here.
      if (!ne(x.context) && !ne(x.takeaway)){
        flag(`lessons_learned[${i}]`, "must have non-empty context and takeaway");
        return {...OK_LESSON};
      }
      return {context: x.context, takeaway: x.takeaway};
    });
  } else {
    model.lessons_learned = [];
    if ("lessons_learned" in doc) flag("lessons_learned", "must be a list");
  }

  if (isObj(doc.output)){
    model.output = {format: doc.output.format, destination: doc.output.destination, structure: ""};
  } else {
    flag("output", "must be a mapping");
    model.output = {format: "code", destination: "-", structure: ""};
  }

  if (Array.isArray(doc.requirements)){
    model.requirements = doc.requirements.map((r, i) => {
      if (!isObj(r)){
        flag(`requirements[${i}]`, "must be a mapping");
        return {...OK_REQ};
      }
      // Same builder blind spot as lessons. An all-empty requirement row
      // never survives serialization, so validate() filters it out. Python
      // flags all three fields, and so do we.
      if (!ne(r.id) && !ne(r.statement) && !ne(r.verify)){
        for (const k of ["id", "statement", "verify"]) flag(`requirements[${i}].${k}`, "must be a non-empty string");
        return {...OK_REQ};
      }
      return {id: r.id, statement: r.statement, verify: r.verify};
    });
  } else {
    // Absent and non-list both land on the "requirements" key, because
    // validate() flags an empty requirements list itself.
    model.requirements = [];
  }

  if (isObj(doc.protocol)){
    model.protocol = {
      apply: doc.protocol.apply,
      stake_single_recommendation: doc.protocol.stake_single_recommendation,
      log_assumptions: doc.protocol.log_assumptions,
      flag_low_confidence: doc.protocol.flag_low_confidence,
      artifacts: "artifacts" in doc.protocol ? doc.protocol.artifacts : []
    };
  } else {
    flag("protocol", "must be a mapping");
    model.protocol = {...OK_PROTOCOL};
  }

  return {model, structural};
}

function jsKeys(text){
  const doc = lib.parseYAML(text);
  const {model, structural} = docToModel(doc);
  const errs = model === null ? structural : structural.concat(lib.validate(model));
  return sortedKeys(errs);
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
  assert.strictEqual(requires, 23, "require() call sites in validate-prompt.py");
  assert.strictEqual(appends, 2, "errors.append() sites in validate-prompt.py");
});
