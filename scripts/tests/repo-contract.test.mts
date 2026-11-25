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
  for (const retired of ["adp-serve.py", "validate-prompt.py", ...RETIRED_PAGES]) assert.ok(!skill.includes(retired), retired);
});

// The harness loads only SKILL.md, so a phase file that SKILL.md does not name
// never reaches the model, and a name with no file behind it sends the model
// to a failed Read.
test("SKILL.md names a phase file and an artifact file for every phase, and every file it names exists", () => {
  const skill = fs.readFileSync(path.join(ROOT, "SKILL.md"), "utf8");
  const named = new Set([...skill.matchAll(/<skill-dir>\/(references\/(?:(?:phases|artifacts)\/[\w-]+|sections)\.md)/g)].map(m => m[1]));
  for (const rel of named) assert.ok(fs.existsSync(path.join(ROOT, rel)), rel);
  for (const dir of ["phases", "artifacts"]){
    for (const f of fs.readdirSync(path.join(ROOT, "references", dir))) assert.ok(named.has(`references/${dir}/${f}`), `${dir}/${f} is not named`);
  }
  assert.ok(named.has("references/sections.md"), "references/sections.md is not named");
  for (let n = 1; n <= 9; n++){
    const row = skill.split("\n").find(l => l.startsWith(`| ${n} | `));
    assert.ok(row?.includes(`/references/phases/phase-${n}-`) && row.includes("/references/artifacts/"), `phase ${n} has no loading row`);
  }
});

// A run logs an assumption the moment it makes one, so its first Decision Log
// entry can come at Phase 2 or 3. The Phase 5 loading row is then too late,
// and a rule that names only some phases leaves the others without the template.
test("SKILL.md tells a run to read the Decision Log template before its first entry at any phase", () => {
  const skill = fs.readFileSync(path.join(ROOT, "SKILL.md"), "utf8");
  const rule = skill.split(/\n(?=- )|\n\n/).find(p => p.includes("references/artifacts/decision-log.md") && p.includes("first Decision Log entry"));
  assert.ok(rule, "no rule sends a run to the template before its first entry");
  assert.match(rule, /at any phase/);
  assert.doesNotMatch(skill, /Phases \d to \d, read/, "a phase range still limits the read");
});

const SKILL_FILES = ["SKILL.md", "references/sections.md",
  ...["phases", "artifacts"].flatMap(d => fs.readdirSync(path.join(ROOT, "references", d)).map(f => `references/${d}/${f}`))];

// Each line under references/ has one owner file. A second copy would drift
// from the first, and a copy in SKILL.md would load into every run. We check
// lines and not paragraphs, so a pasted part of a paragraph counts too. A line
// may repeat inside its own file, as the ticket table header does in the
// Phase 9 worked example, and bare fence markers repeat everywhere.
test("each phase rule and template sits in one file, and SKILL.md holds none of them", () => {
  const lines = Object.fromEntries(SKILL_FILES.map(f => [f, fs.readFileSync(path.join(ROOT, f), "utf8").split("\n")]));
  const total = new Map<string, number>();
  for (const f of SKILL_FILES) for (const l of lines[f]) total.set(l, (total.get(l) ?? 0) + 1);
  const copied: string[] = [];
  for (const f of SKILL_FILES.filter(f => f !== "SKILL.md")){
    for (const l of new Set(lines[f])){
      if (!l.trim() || /^```\w*$/.test(l)) continue;
      const own = lines[f].filter(x => x === l).length;
      if (total.get(l) !== own) copied.push(`${f}: ${l.slice(0, 60)}`);
    }
  }
  assert.deepEqual(copied, []);
});

// The phase rules and templates left SKILL.md, so a citation that pairs
// SKILL.md with one of their names sends a maintainer to the wrong file. We
// skip this file, because its own patterns name both.
const MOVED = /section (vocabulary|order)|phase \d|template|obligation|closure|re-anchor|\bgate\b/i;
test("no citation of SKILL.md names text that moved to references/", () => {
  const hits: string[] = [];
  for (const f of tracked().filter(f => /^(src|scripts|references)\/|^README\.md$/.test(f) && f !== "scripts/tests/repo-contract.test.mts")){
    fs.readFileSync(path.join(ROOT, f), "utf8").split("\n").forEach((line, i) => {
      if (line.includes("SKILL.md") && MOVED.test(line)) hits.push(`${f}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(hits, []);
});

/* The vanilla pages and the browser-globals bundle are gone, so no tracked
   file may send a reader to one. Two kinds of file keep the names: the
   frozen parity prompts, which are data the validator reads byte for byte,
   and the launch test, which asserts that each retired route answers 404.
   We build the names from parts, so this file does not match itself. */
const RETIRED_PAGES = ["ADP-" + "Parser.html", "prompt-" + "builder.html", "mission-" + "control.html", "adp-" + "libs.js", "Artifact " + "Viewer"];
const KEEPS_RETIRED = (f: string) => f.startsWith("scripts/tests/fixtures/parity/") || f === "scripts/tests/launch.test.mts";

test("no tracked file outside the parity fixtures and the launch test names a retired page", () => {
  const hits: string[] = [];
  for (const f of tracked()){
    if (KEEPS_RETIRED(f) || !fs.existsSync(path.join(ROOT, f))) continue;
    const text = fs.readFileSync(path.join(ROOT, f), "utf8");
    text.split("\n").forEach((line, i) => { if (RETIRED_PAGES.some(r => line.includes(r))) hits.push(`${f}:${i + 1}: ${line.trim()}`); });
  }
  assert.deepEqual(hits, []);
});

/* Corpus text reaches the page as React text, which React escapes. Only a
   component that takes the parser library's escaped render may hand React a
   string of HTML, and this list names every such component. We read src/
   from disk, so a file git does not track yet still counts. */
const HTML_OWNERS = ["src/app/Inspector.tsx"];

function sourcesHolding(needle: RegExp): string[] {
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, {withFileTypes: true})){
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name) && needle.test(fs.readFileSync(p, "utf8")))
        hits.push(path.relative(ROOT, p).split(path.sep).join("/"));
    }
  };
  walk(path.join(ROOT, "src"));
  return hits.sort();
}

test("no source file outside the owner list passes HTML to React", () => {
  assert.deepEqual(sourcesHolding(/dangerouslySetInnerHTML/), HTML_OWNERS);
});

/* The owner's prop takes the EscapedHtml brand. A cast is the only way to
   make a string carry it, so the parser library, which escapes every
   document character it renders, must be the only file that casts one. */
test("only the parser library makes a string into EscapedHtml", () => {
  assert.deepEqual(sourcesHolding(/as\s+EscapedHtml\b|<EscapedHtml>/), ["src/lib/adp-parser-lib.ts"]);
});
