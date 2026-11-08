/* Checks on the repo as a whole. The skill runs on Node alone, so no
   tracked file may call Python or need it, and SKILL.md must name only the
   commands that exist. The scan skips .adp, because audit logs record the
   history of files that the repo no longer holds. */
import {test} from "vitest";
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

/* Corpus text reaches the page as React text, which React escapes. Only a
   component that takes the parser library's escaped render may hand React a
   string of HTML, and this list names every such component. We read src/
   from disk, so a file git does not track yet still counts. */
const HTML_OWNERS: string[] = [];

test("no source file outside the owner list passes HTML to React", () => {
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, {withFileTypes: true})){
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name) && fs.readFileSync(p, "utf8").includes("dangerouslySetInnerHTML"))
        hits.push(path.relative(ROOT, p).split(path.sep).join("/"));
    }
  };
  walk(path.join(ROOT, "src"));
  assert.deepEqual(hits.filter(f => !HTML_OWNERS.includes(f)), []);
});
