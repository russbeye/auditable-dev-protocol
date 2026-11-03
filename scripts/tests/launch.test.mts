/* We drive adp-launch.mts the way the skill does, as a child process, and
   read the server it starts from outside over HTTP. Every launch runs with
   its own temp dir in the environment, so os.tmpdir() points the state
   directory at a sandbox and no test touches a real user's servers. */
import test from "node:test";
import assert from "node:assert/strict";
import {spawn, spawnSync} from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SCRIPTS = path.join(import.meta.dirname, "..");
const LAUNCH = path.join(SCRIPTS, "adp-launch.mts");
const PACKS_DIR = path.join(SCRIPTS, "..", "packs");
const POSIX = process.platform !== "win32";

const sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "adp-launch-")));
const tmpEnv = (dir: string) => ({...process.env, TMPDIR: dir, TEMP: dir, TMP: dir});

function makeRepo(name: string): string {
  const root = path.join(sandbox, name);
  fs.mkdirSync(path.join(root, ".adp", "T-001"), {recursive: true});
  fs.writeFileSync(path.join(root, ".adp", "T-001", "audit-log.md"), "# T-001\n\n## Problem Statement\nA → B\n", "utf8");
  return fs.realpathSync(root);
}

type Run = {status: number | null, stdout: string, stderr: string};

function launchAsync(root: string, tmp: string): Promise<Run> {
  return new Promise(resolve => {
    const p = spawn(process.execPath, [LAUNCH, root], {env: tmpEnv(tmp)});
    let stdout = "", stderr = "";
    p.stdout.on("data", d => { stdout += d; });
    p.stderr.on("data", d => { stderr += d; });
    p.on("exit", status => resolve({status, stdout, stderr}));
  });
}

async function launch(root: string, tmp: string): Promise<string> {
  const r = await launchAsync(root, tmp);
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}

const baseOf = (url: string) => url.replace(/\/mission-control\.html$/, "");
const health = async (url: string) => (await fetch(baseOf(url) + "/health")).json();

function stateDirIn(tmp: string): string {
  return path.join(tmp, "adp-" + os.userInfo().username);
}

/* Every server a test starts gets stopped here, found through the state
   files the sandbox holds and through the pids the tests record. */
const pids = new Set<number>();
test.after(() => {
  for (const pid of pids){ try { process.kill(pid); } catch {} }
  fs.rmSync(sandbox, {recursive: true, force: true});
});
async function track(url: string){ pids.add((await health(url)).pid); }

/* One repo and one server serve the route tests. */
const repo = makeRepo("repo");
const tmpMain = fs.mkdtempSync(path.join(sandbox, "tmp-"));
let base = "";
let firstStdout = "";
test.before(async () => {
  const r = await launchAsync(repo, tmpMain);
  assert.equal(r.status, 0, r.stderr);
  firstStdout = r.stdout;
  base = baseOf(r.stdout.trim());
  await track(r.stdout.trim());
});

test("the launcher prints the mission control URL and nothing else", () => {
  assert.match(firstStdout, /^http:\/\/127\.0\.0\.1:\d+\/mission-control\.html\n$/);
});

for (const route of ["/adp-shell.css", "/mission-control.html", "/ADP-Parser.html", "/corpus.json",
    "/corpus/T-001/audit-log.md", "/packs.json", "/packs/resume-ticket.pack.md", "/health"]){
  test(`${route} answers no-store with a UTF-8 charset`, async () => {
    const res = await fetch(base + route);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.match(res.headers.get("content-type") ?? "", /; charset=utf-8$/);
  });
}

test("/health names the repo root this server serves", async () => {
  const h = await (await fetch(base + "/health")).json();
  assert.equal(h.root, repo);
  assert.equal(typeof h.pid, "number");
  assert.match(h.stamp, /^[0-9a-f]{16}$/);
});

test("/corpus.json lists every file under .adp with the repo name as root", async () => {
  fs.mkdirSync(path.join(repo, ".adp", "A-000"), {recursive: true});
  fs.writeFileSync(path.join(repo, ".adp", "A-000", "prompt.yaml"), "task:\n  id: A-000\n");
  const res = await fetch(base + "/corpus.json");
  assert.deepEqual(await res.json(), {root: "repo", files: ["A-000/prompt.yaml", "T-001/audit-log.md"]});
});

test("/corpus/<relpath> serves the file byte for byte, non-ASCII included", async () => {
  const res = await fetch(base + "/corpus/T-001/audit-log.md");
  assert.equal(await res.text(), fs.readFileSync(path.join(repo, ".adp", "T-001", "audit-log.md"), "utf8"));
});

test("/corpus/ refuses every escape from the .adp directory", async () => {
  for (const rel of ["../package.json", "..%2Fpackage.json", "T-001/..%2F..%2Fpackage.json", "%2e%2e/package.json", "T-001", "%E0%A4%A"]){
    const res = await fetch(base + "/corpus/" + rel);
    assert.equal(res.status, 404, rel);
  }
});

test("/corpus/ refuses a symlink that leaves the .adp directory", {skip: !POSIX}, async () => {
  fs.writeFileSync(path.join(repo, "secret.txt"), "outside\n");
  fs.symlinkSync(path.join(repo, "secret.txt"), path.join(repo, ".adp", "T-001", "link.md"));
  const res = await fetch(base + "/corpus/T-001/link.md");
  assert.equal(res.status, 404);
});

test("/packs.json lists every shipped .pack.md, sorted", async () => {
  const want = fs.readdirSync(PACKS_DIR).filter(f => f.endsWith(".pack.md")).sort();
  assert.deepEqual(await (await fetch(base + "/packs.json")).json(), {packs: want});
});

test("/packs/<name> serves a listed pack byte for byte", async () => {
  const res = await fetch(base + "/packs/resume-ticket.pack.md");
  assert.match(res.headers.get("content-type") ?? "", /^text\/markdown/);
  assert.equal(await res.text(), fs.readFileSync(path.join(PACKS_DIR, "resume-ticket.pack.md"), "utf8"));
});

test("/packs/<name> refuses a name the listing does not carry", async () => {
  for (const name of ["nope.pack.md", "..%2FSKILL.md", "../SKILL.md", "resume-ticket.pack.md%2F..%2F..%2FSKILL.md"]){
    assert.equal((await fetch(base + "/packs/" + name)).status, 404, name);
  }
});

test("the server serves no file outside the page files at the top of scripts/", async () => {
  for (const p of ["/adp-server.mts", "/adp-runtime.mts", "/adp-launch.mts", "/tests/helpers.js",
      "/tests%2Fhelpers.js", "/..%2FSKILL.md", "/../package.json", "/SKILL.md", "/"]){
    assert.equal((await fetch(base + p)).status, 404, p);
  }
});

test("the server answers anything but GET with 405", async () => {
  assert.equal((await fetch(base + "/corpus.json", {method: "POST"})).status, 405);
});

/* R1: a second launch reuses the live server. */
test("a second launch prints the same URL and starts no second server", async () => {
  const again = await launch(repo, tmpMain);
  assert.equal(baseOf(again), base);
  assert.equal(fs.readdirSync(stateDirIn(tmpMain)).length, 1);
});

test("two launches at the same moment agree on one server", async () => {
  const r = makeRepo("race");
  const tmp = fs.mkdtempSync(path.join(sandbox, "tmp-"));
  const [a, b] = await Promise.all([launchAsync(r, tmp), launchAsync(r, tmp)]);
  assert.equal(a.status, 0, a.stderr);
  assert.equal(b.status, 0, b.stderr);
  assert.equal(a.stdout, b.stdout);
  await track(a.stdout.trim());
});

test("two spellings of one Windows path share one server", {skip: POSIX}, async () => {
  const r = makeRepo("casefold");
  const tmp = fs.mkdtempSync(path.join(sandbox, "tmp-"));
  const a = await launch(r, tmp);
  await track(a);
  const b = await launch(r.toUpperCase(), tmp);
  assert.equal(b, a);
});

/* R2: a state file earns no trust that /health does not confirm. We let a
   real launch name each state file, so a planted state lands where the next
   launch looks. */
async function stateFileFor(root: string, tmp: string): Promise<{file: string, url: string}> {
  const url = await launch(root, tmp);
  await track(url);
  const dir = stateDirIn(tmp);
  const [name] = fs.readdirSync(dir);
  return {file: path.join(dir, name), url};
}

test("a state file whose pid is dead starts a new server", async () => {
  const r = makeRepo("dead");
  const tmp = fs.mkdtempSync(path.join(sandbox, "tmp-"));
  const {file, url} = await stateFileFor(r, tmp);
  const old = await health(url);
  process.kill(old.pid);
  await new Promise(res => setTimeout(res, 300));
  const dead = spawnSync(process.execPath, ["-e", "process.pid"]).pid!;
  fs.writeFileSync(file, JSON.stringify({root: r, port: Number(new URL(url).port), pid: dead, stamp: old.stamp}));
  const fresh = await launch(r, tmp);
  const h = await health(fresh);
  pids.add(h.pid);
  assert.equal(h.root, r);
  assert.notEqual(h.pid, old.pid);
});

test("a state file that points at another repo's server starts a new server", async () => {
  const a = makeRepo("mine");
  const b = makeRepo("theirs");
  const tmp = fs.mkdtempSync(path.join(sandbox, "tmp-"));
  const {file: fileA, url: urlA} = await stateFileFor(a, tmp);
  const hA = await health(urlA);
  const urlB = await launch(b, tmp);
  const hB = await health(urlB);
  pids.add(hB.pid);
  // We point repo A's state at repo B's live server. /health names B, so the
  // launcher for A must not hand out B's URL.
  process.kill(hA.pid);
  await new Promise(res => setTimeout(res, 300));
  fs.writeFileSync(fileA, JSON.stringify({root: a, port: Number(new URL(urlB).port), pid: hB.pid, stamp: hB.stamp}));
  const fresh = await launch(a, tmp);
  const h = await health(fresh);
  pids.add(h.pid);
  assert.equal(h.root, a);
  assert.notEqual(baseOf(fresh), baseOf(urlB));
});

test("a state directory with loose permissions is emptied and tightened, and its server retires", {skip: !POSIX}, async () => {
  const r = makeRepo("loose");
  const tmp = fs.mkdtempSync(path.join(sandbox, "tmp-"));
  const {url} = await stateFileFor(r, tmp);
  const old = await health(url);
  fs.chmodSync(stateDirIn(tmp), 0o777);
  const fresh = await launch(r, tmp);
  const h = await health(fresh);
  pids.add(h.pid);
  assert.notEqual(h.pid, old.pid, "the launcher trusted a file in a world-writable directory");
  assert.equal(fs.statSync(stateDirIn(tmp)).mode & 0o777, 0o700);
  // The old server loses its state file, so it exits within its two-second check.
  await new Promise(res => setTimeout(res, 2600));
  await assert.rejects(fetch(baseOf(url) + "/health"));
});

test("a state directory that is a symlink stops the launcher", {skip: !POSIX}, async () => {
  const r = makeRepo("symdir");
  const tmp = fs.mkdtempSync(path.join(sandbox, "tmp-"));
  const elsewhere = fs.mkdtempSync(path.join(sandbox, "elsewhere-"));
  fs.symlinkSync(elsewhere, stateDirIn(tmp));
  const run = await launchAsync(r, tmp);
  assert.equal(run.status, 1);
  assert.match(run.stderr, /not a directory this user owns/);
});
