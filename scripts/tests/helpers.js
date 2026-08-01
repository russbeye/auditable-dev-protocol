/* Shared plumbing for the adp-prompt-lib suite. Run everything from the repo
   root with one command on stock Node 20 or later:

     node --test scripts/tests/*.test.js

   Note: pass the files, not the directory. Newer Node treats a directory
   argument as a literal module path and fails. We resolve every path from
   this file's own directory, so the tests themselves do not care which
   directory they are launched from. */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const lib = require(path.join(__dirname, "..", "adp-prompt-lib.js"));

function readFixture(name){
  return fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8");
}

// The annotated template lives in references/ and is git-tracked. We read it
// in place instead of keeping a copy, so the suite always tests the file that
// developers actually copy from.
function readReference(name){
  return fs.readFileSync(path.join(__dirname, "..", "..", "references", name), "utf8");
}

// buildYaml expects the full state shape the builder's gather() produces, and
// it throws on a parsed document that omits an optional group. We fill the
// builder's default empty state first, mirroring what applyPromptData in
// prompt-builder.html guarantees. If that contract moves, move this with it.
function normalize(doc){
  const d = doc || {};
  return {
    task: Object.assign({id: "", title: "", author: "", date: ""}, d.task),
    preamble: d.preamble || "",
    role: Object.assign({lens: "", priorities: []}, d.role),
    prompt: d.prompt || "",
    constraints: Object.assign({out_of_scope: [], must_not: []}, d.constraints),
    context: Object.assign({background: "", references: [], links: []}, d.context),
    lessons_learned: Array.isArray(d.lessons_learned) ? d.lessons_learned : [],
    output: Object.assign({format: "", destination: "", structure: ""}, d.output),
    requirements: Array.isArray(d.requirements) ? d.requirements : [],
    protocol: Object.assign({
      apply: true,
      stake_single_recommendation: true,
      log_assumptions: true,
      flag_low_confidence: true,
      artifacts: lib.DEFAULT_ARTIFACTS.slice()
    }, d.protocol)
  };
}

module.exports = {lib, readFixture, readReference, normalize};
