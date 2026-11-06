/* Checks on the repo as a whole. The skill runs on Node alone, so no
   tracked file may call Python or need it, and SKILL.md must name only the
   commands that exist. The scan skips .adp, because audit logs record the
   history of files that the repo no longer holds. */
import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(import.meta.dirname, "..", "..");
// We build the words from parts and keep them out of the test names, so this
// file does not trip its own scan once git tracks it.
const PY = "python";
// A call is the lowercase command with a flag or a script after it. Prose
// such as "Python 3.7" stays legal, because census advice in the references
// names the language without running it. A shebang counts as a call, so a
// script with no .py extension cannot slip past the file check.
const CALL = new RegExp(`\\b${PY}3?\\s+(-|\\S+\\.py\\b)|\\bpip3?\\s+install\\b|^#!.*\\b${PY}`);
const NEEDS = new RegExp(`\\bpy${"yaml"}\\b`, "i");

function tracked(): string[] {
  const res = spawnSync("git", ["ls-files", "-z"], {cwd: ROOT, encoding: "utf8"});
  assert.equal(res.status, 0, res.stderr);
  return res.stdout.split("\0").filter(f => f && !f.startsWith(".adp/"));
}

test("the repo tracks no Python file", () => {
  assert.deepEqual(tracked().filter(f => f.endsWith(".py")), []);
});

test("no tracked file calls Python, installs a Python package, or names its YAML library", () => {
  const hits: string[] = [];
  for (const f of tracked()){
    const text = fs.readFileSync(path.join(ROOT, f), "utf8");
    text.split("\n").forEach((line, i) => { if (CALL.test(line) || NEEDS.test(line)) hits.push(`${f}:${i + 1}: ${line.trim()}`); });
  }
  assert.deepEqual(hits, []);
});

test("SKILL.md launches mission control and validates through the Node scripts", () => {
  const skill = fs.readFileSync(path.join(ROOT, "SKILL.md"), "utf8");
  assert.ok(skill.includes("node <skill-dir>/scripts/adp-launch.mts"), "launcher command");
  assert.ok(skill.includes("node <skill-dir>/scripts/validate-prompt.mts <file>"), "validator command");
  for (const retired of ["adp-serve.py", "validate-prompt.py"]) assert.ok(!skill.includes(retired), retired);
});
