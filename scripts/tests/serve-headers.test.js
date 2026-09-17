/* We start adp-serve.py once and read its routes from outside the process,
   the way a browser does. The server exists so a page shows what is on disk
   now, so every response must carry Cache-Control: no-store, the static files
   included. The audit-log and corpus routes set the header themselves for a
   long time while the static path did not, so we check both kinds. */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {spawn} = require("node:child_process");

const SERVE = path.join(__dirname, "..", "adp-serve.py");

// The script finds the corpus root from the first ".adp" segment in the log
// path, so we put the temporary log under one to get the corpus routes too.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "adp-serve-"));
const logPath = path.join(root, ".adp", "T-001", "audit-log.md");
fs.mkdirSync(path.dirname(logPath), {recursive: true});
fs.writeFileSync(logPath, "# T-001\n\n## Problem Statement\n", "utf8");

let child = null;
let stdout = "";
let base = "";

function waitForUrl(proc){
  return new Promise((resolve, reject) => {
    let stderr = "";
    const timer = setTimeout(() => reject(new Error("adp-serve.py printed no URL in 5s\n" + stderr)), 5000);
    proc.stdout.on("data", d => {
      stdout += d;
      const m = stdout.match(/^(http:\/\/127\.0\.0\.1:\d+)\/ADP-Parser\.html\?file=/m);
      if (m){ clearTimeout(timer); resolve(m[1]); }
    });
    proc.stderr.on("data", d => { stderr += d; });
    // A missing interpreter emits error, not exit, so we name the requirement
    // here instead of leaving a bare ENOENT stack for the next machine.
    proc.on("error", e => { clearTimeout(timer); reject(new Error("adp-serve.py could not start (python3 must be on PATH): " + e.message)); });
    proc.on("exit", code => { clearTimeout(timer); reject(new Error("adp-serve.py exited " + code + "\n" + stderr)); });
  });
}

test.before(async () => {
  child = spawn("python3", [SERVE, logPath, "0"], {stdio: ["ignore", "pipe", "pipe"]});
  base = await waitForUrl(child);
});

test.after(() => {
  if (child) child.kill();
  fs.rmSync(root, {recursive: true, force: true});
});

for (const route of ["/adp-shell.css", "/mission-control.html", "/corpus.json", "/audit-log.md",
    "/packs.json", "/packs/resume-ticket.pack.md"]){
  test(`${route} answers with Cache-Control: no-store, once`, async () => {
    const res = await fetch(base + route);
    assert.equal(res.status, 200);
    // fetch joins a repeated header with a comma, so equality also proves
    // the header was sent exactly once.
    assert.equal(res.headers.get("cache-control"), "no-store");
  });
}

test("the script prints the URL and nothing else", () => {
  assert.equal(stdout.trim().split("\n").length, 1);
});

/* The packs routes serve the skill's own packs/ directory, whatever corpus
   the log lives in, so the shipped files answer here. The listing is the
   allow-list for the raw route: a name outside it, a traversal included,
   gets a plain 404 before any file is opened. */
const PACKS_DIR = path.join(__dirname, "..", "..", "packs");
const PACK_FILES = fs.readdirSync(PACKS_DIR).filter(f => f.endsWith(".pack.md")).sort();

test("/packs.json lists every shipped .pack.md, sorted", async () => {
  const res = await fetch(base + "/packs.json");
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {packs: PACK_FILES});
  assert.ok(PACK_FILES.includes("resume-ticket.pack.md"));
});

test("/packs/<name> serves a listed pack byte for byte", async () => {
  const res = await fetch(base + "/packs/resume-ticket.pack.md");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /^text\/markdown/);
  assert.equal(await res.text(), fs.readFileSync(path.join(PACKS_DIR, "resume-ticket.pack.md"), "utf8"));
});

test("/packs/<name> refuses a name the listing does not carry", async () => {
  for (const name of ["nope.pack.md", "..%2FSKILL.md", "../SKILL.md", "resume-ticket.pack.md%2F..%2F..%2FSKILL.md"]){
    const res = await fetch(base + "/packs/" + name);
    assert.equal(res.status, 404, name);
  }
});
