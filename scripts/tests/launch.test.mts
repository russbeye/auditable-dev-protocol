/* We drive adp-launch.mts the way the skill does, as a child process, and
   read the server it starts from outside over HTTP. Every launch runs with
   its own temp dir in the environment, so os.tmpdir() points the state
   directory at a sandbox and no test touches a real user's servers. */
import {afterAll, beforeAll, test} from "vitest";
import assert from "node:assert/strict";
import {spawn, spawnSync} from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import {repoKey, SKILL_DIR} from "../adp-runtime.mts";
import {requireInstall} from "./global-setup.mts";

const SCRIPTS = path.join(import.meta.dirname, "..");
const LAUNCH = path.join(SCRIPTS, "adp-launch.mts");
const PACKS_DIR = path.join(SCRIPTS, "..", "packs");
const POSIX = process.platform !== "win32";

// We resolve fixtures the way the launcher does. On Windows the temp dir can
// carry an 8.3 short name, and only the native realpath expands it.
const sandbox = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "adp-launch-")));
const tmpEnv = (dir: string) => ({...process.env, TMPDIR: dir, TEMP: dir, TMP: dir});

function makeRepo(name: string): string {
  const root = path.join(sandbox, name);
  fs.mkdirSync(path.join(root, ".adp", "T-001"), {recursive: true});
  fs.writeFileSync(path.join(root, ".adp", "T-001", "audit-log.md"), "# T-001\n\n## Problem Statement\nA → B\n", "utf8");
  return fs.realpathSync.native(root);
}

type Run = {status: number | null, stdout: string, stderr: string};

function launchAsync(root: string, tmp: string, launcher = LAUNCH): Promise<Run> {
  return new Promise(resolve => {
    const p = spawn(process.execPath, [launcher, root], {env: tmpEnv(tmp)});
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

const baseOf = (url: string) => url.replace(/\/app\.html$/, "");
const health = async (url: string) => (await fetch(baseOf(url) + "/health")).json();

function stateDirIn(tmp: string): string {
  return path.join(tmp, "adp-" + os.userInfo().username);
}

/* Every server a test starts gets stopped here, found through the state
   files the sandbox holds and through the pids the tests record. */
const pids = new Set<number>();
afterAll(() => {
  for (const pid of pids){ try { process.kill(pid); } catch {} }
  fs.rmSync(sandbox, {recursive: true, force: true});
});
async function track(url: string){ pids.add((await health(url)).pid); }

/* One repo and one server serve the route tests. */
const repo = makeRepo("repo");
const tmpMain = fs.mkdtempSync(path.join(sandbox, "tmp-"));
let base = "";
let firstStdout = "";
beforeAll(async () => {
  const r = await launchAsync(repo, tmpMain);
  assert.equal(r.status, 0, r.stderr);
  firstStdout = r.stdout;
  base = baseOf(r.stdout.trim());
  await track(r.stdout.trim());
});

test("the launcher prints the mission control URL and nothing else", () => {
  assert.match(firstStdout, /^http:\/\/127\.0\.0\.1:\d+\/app\.html\n$/);
});

for (const route of ["/adp-shell.css", "/mission-control.html", "/ADP-Parser.html", "/adp-libs.js", "/app.html", "/adp-app.js", "/corpus.json",
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

// Mode 000 stops only a process without root's override, so the test skips
// where permissions mean nothing.
const UNREADABLE_OK = POSIX && process.getuid?.() !== 0;
test("an unreadable corpus file or directory fails its own request and leaves the server up", {skip: !UNREADABLE_OK}, async () => {
  const r = makeRepo("unreadable-repo");
  fs.mkdirSync(path.join(r, ".adp", "U-001"));
  fs.mkdirSync(path.join(r, ".adp", "U-002"));
  const file = path.join(r, ".adp", "U-001", "prompt.yaml"), dir = path.join(r, ".adp", "U-002");
  fs.writeFileSync(file, "task:\n  id: U-001\n");
  fs.writeFileSync(path.join(dir, "audit-log.md"), "# U-002\n");
  fs.chmodSync(file, 0o000);
  fs.chmodSync(dir, 0o000);
  try {
    const url = await launch(r, fs.mkdtempSync(path.join(sandbox, "tmp-")));
    await track(url);
    const b = baseOf(url);
    assert.equal((await fetch(b + "/corpus/U-001/prompt.yaml")).status, 500);
    assert.equal((await fetch(b + "/health")).status, 200);
    // The listing skips the directory it cannot read and keeps the rest.
    assert.deepEqual((await (await fetch(b + "/corpus.json")).json()).files, ["T-001/audit-log.md", "U-001/prompt.yaml"]);
    assert.equal((await fetch(b + "/health")).status, 200);
  } finally {
    fs.chmodSync(file, 0o600);
    fs.chmodSync(dir, 0o700);
  }
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

function getWithHost(url: string, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    http.get(url, {headers: {host}}, res => { res.resume(); resolve(res.statusCode!); }).on("error", reject);
  });
}

test("the server refuses a request whose Host is not its own address", async () => {
  const port = new URL(base).port;
  for (const route of ["/corpus.json", "/corpus/T-001/audit-log.md", "/health", "/mission-control.html"]){
    assert.equal(await getWithHost(base + route, "attacker.example"), 403, route);
    assert.equal(await getWithHost(base + route, "attacker.example:" + port), 403, route);
    assert.equal(await getWithHost(base + route, "127.0.0.1:" + port), 200, route);
    assert.equal(await getWithHost(base + route, "localhost:" + port), 200, route);
  }
});

test("the server answers anything but GET with 405", async () => {
  assert.equal((await fetch(base + "/corpus.json", {method: "POST"})).status, 405);
});

/* An open event stream, read into one buffer. A read that outlives its
   wait keeps running, so we never start a second one that could take its
   chunk. */
async function openEvents(url: string){
  const ctl = new AbortController();
  const res = await fetch(url, {signal: ctl.signal});
  let text = "";
  const pump = (async () => {
    const dec = new TextDecoder();
    try { for await (const chunk of res.body!) text += dec.decode(chunk, {stream: true}); } catch {}
  })();
  const waitFor = async (want: string, ms: number) => {
    const end = Date.now() + ms;
    while (!text.includes(want) && Date.now() < end) await new Promise(r => setTimeout(r, 20));
    return text.includes(want);
  };
  return {res, get text(){ return text; }, waitFor, close: async () => { ctl.abort(); await pump; }};
}

/* R5, the server half. A page holds this stream open, and each change to
   the corpus on disk reaches it as one event inside the two-second bound. */
test("an open event stream hears a log edit and a new task within 2 s, and nothing while the corpus is quiet", {timeout: 15_000}, async () => {
  const root = makeRepo("events");
  // A state directory of its own keeps the route tests' one-server count true.
  const url = await launch(root, fs.mkdtempSync(path.join(sandbox, "tmp-")));
  await track(url);
  const ev = await openEvents(baseOf(url) + "/events");
  try {
    assert.equal(ev.res.status, 200);
    assert.equal(ev.res.headers.get("content-type"), "text/event-stream; charset=utf-8");
    assert.equal(ev.res.headers.get("cache-control"), "no-store");
    await new Promise(r => setTimeout(r, 1500));
    assert.equal(ev.text, "");
    let t0 = Date.now();
    fs.appendFileSync(path.join(root, ".adp", "T-001", "audit-log.md"), "\n## Decision Log\n", "utf8");
    assert.ok(await ev.waitFor("data: change\n\n", 2000), "no event within 2 s of the edit");
    const firstAt = Date.now() - t0;
    t0 = Date.now();
    fs.mkdirSync(path.join(root, ".adp", "T-002"));
    fs.writeFileSync(path.join(root, ".adp", "T-002", "audit-log.md"), "# T-002\n", "utf8");
    assert.ok(await ev.waitFor("data: change\n\ndata: change\n\n", 2000), "no event within 2 s of the new task");
    assert.ok(firstAt < 2000 && Date.now() - t0 < 2000);
  } finally { await ev.close(); }
  assert.equal(await getWithHost(baseOf(url) + "/events", "attacker.example"), 403);
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

test("a launch waits on a fresh unreadable claim and starts no server over it", async () => {
  const r = makeRepo("unsettled");
  const tmp = fs.mkdtempSync(path.join(sandbox, "tmp-"));
  const dir = stateDirIn(tmp);
  fs.mkdirSync(dir, {recursive: true, mode: 0o700});
  const file = path.join(dir, crypto.createHash("sha256").update(repoKey(r)).digest("hex").slice(0, 16) + ".json");
  // An empty file is what a launcher that writes in two steps leaves for an instant.
  fs.writeFileSync(file, "", {mode: 0o600});
  const p = spawn(process.execPath, [LAUNCH, r], {env: tmpEnv(tmp)});
  await new Promise(res => setTimeout(res, 1500));
  const after = fs.readFileSync(file, "utf8");
  const exited = p.exitCode !== null;
  p.kill();
  assert.equal(after, "", "the launch replaced a claim that was still inside its start window");
  assert.equal(exited, false);
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

/* The build lock for this checkout, planted in a sandbox state directory and
   naming this test process, which is always alive. The launcher would empty
   a state directory with loose permissions, so we create it private. */
function plantBuildLock(tmp: string): string {
  const dir = stateDirIn(tmp);
  fs.mkdirSync(dir, {mode: 0o700});
  const lock = path.join(dir, "build-" + crypto.createHash("sha256").update(SKILL_DIR).digest("hex").slice(0, 16) + ".lock");
  fs.writeFileSync(lock, String(process.pid), {mode: 0o600});
  return lock;
}

test("a build lock older than the launch window is taken over, whatever process holds its pid", {timeout: 20_000}, async () => {
  const r = makeRepo("stalelock");
  const tmp = fs.mkdtempSync(path.join(sandbox, "tmp-"));
  const lock = plantBuildLock(tmp);
  const old = new Date(Date.now() - 600_000);
  fs.utimesSync(lock, old, old);
  await track(await launch(r, tmp));
  assert.equal(fs.existsSync(lock), false);
});

test("a build lock whose holder died is taken over at once", {timeout: 20_000}, async () => {
  const r = makeRepo("deadlock");
  const tmp = fs.mkdtempSync(path.join(sandbox, "tmp-"));
  const lock = plantBuildLock(tmp);
  fs.writeFileSync(lock, String(spawnSync(process.execPath, ["-e", ""]).pid));
  const run = await launchAsync(r, tmp);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stderr, "");
  await track(run.stdout.trim());
});

test("a launch that waits on a live build lock says so, and goes on once the lock is gone", {timeout: 20_000}, async () => {
  const r = makeRepo("livelock");
  const tmp = fs.mkdtempSync(path.join(sandbox, "tmp-"));
  const lock = plantBuildLock(tmp);
  const p = spawn(process.execPath, [LAUNCH, r], {env: tmpEnv(tmp)});
  let stdout = "", stderr = "";
  p.stdout.on("data", d => { stdout += d; });
  const waiting = new Promise<void>(resolve => p.stderr.on("data", d => { stderr += d; if (/waiting for another launcher/.test(stderr)) resolve(); }));
  const exited = new Promise<number | null>(resolve => p.on("exit", resolve));
  await waiting;
  fs.rmSync(lock);
  assert.equal(await exited, 0, stderr);
  assert.equal(stderr, "adp-launch: waiting for another launcher to install or build\n");
  await track(stdout.trim());
});

test("the suite's setup refuses a checkout whose install is older than its lockfile", () => {
  const dir = fs.mkdtempSync(path.join(sandbox, "install-"));
  fs.mkdirSync(path.join(dir, "node_modules"));
  const record = path.join(dir, "node_modules", ".package-lock.json"), lockfile = path.join(dir, "package-lock.json");
  fs.writeFileSync(record, "{}");
  fs.writeFileSync(lockfile, "{}");
  const then = new Date(Date.now() - 60_000);
  fs.utimesSync(record, then, then);
  assert.throws(() => requireInstall(dir), /Run npm ci/);
  // A Date holds whole milliseconds and the file system keeps finer ones, so
  // "now" can land just before the lockfile's mtime. We clear it by a second.
  const later = new Date(fs.statSync(lockfile).mtimeMs + 1000);
  fs.utimesSync(record, later, later);
  requireInstall(dir);
});

test("the suite's setup checks the install before it builds", () => {
  const src = fs.readFileSync(path.join(import.meta.dirname, "global-setup.mts"), "utf8");
  const body = src.slice(src.indexOf("export default async function setup()"));
  const check = body.indexOf("requireInstall(SKILL_DIR)");
  assert.ok(check > 0 && check < body.indexOf("build("), "setup() must call requireInstall(SKILL_DIR) before build(");
});

/* A copy of the skill holds what a clone holds: the sources, the pages, the
   packs, and the package files, with no node_modules and no build. The copy
   never links this checkout's node_modules, because an npm ci in the copy
   would then empty the tree the running suite loads from. */
function copySkill(name: string): string {
  const skill = path.join(SCRIPTS, "..");
  const dst = path.join(sandbox, name);
  fs.mkdirSync(path.join(dst, "scripts"), {recursive: true});
  for (const f of fs.readdirSync(SCRIPTS))
    if (/\.(mts|html|css|svg)$/.test(f)) fs.copyFileSync(path.join(SCRIPTS, f), path.join(dst, "scripts", f));
  for (const d of ["src", "packs"]) fs.cpSync(path.join(skill, d), path.join(dst, d), {recursive: true});
  for (const f of ["package.json", "package-lock.json", "vite.config.mts"]) fs.copyFileSync(path.join(skill, f), path.join(dst, f));
  return dst;
}

const alivePid = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

test("a clone installs and builds on first launch, and a source edit rebuilds and replaces its server", async () => {
  const skill = copySkill("clone");
  const launcher = path.join(skill, "scripts", "adp-launch.mts");
  const r = makeRepo("clone-repo");
  const tmp = fs.mkdtempSync(path.join(sandbox, "tmp-"));

  const first = await launchAsync(r, tmp, launcher);
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stderr, /installing dependencies/);
  assert.match(first.stderr, /building the app/);
  const old = await health(first.stdout.trim());
  pids.add(old.pid);
  for (const route of ["/mission-control.html", "/adp-libs.js"])
    assert.equal((await fetch(baseOf(first.stdout.trim()) + route)).status, 200, route);

  // An unchanged clone reuses its install, its build, and its server.
  const again = await launchAsync(r, tmp, launcher);
  assert.equal(again.stdout, first.stdout);
  assert.equal(again.stderr, "");

  fs.appendFileSync(path.join(skill, "src", "lib", "adp-parser-lib.ts"), "\n// edited\n");
  const next = await launchAsync(r, tmp, launcher);
  assert.equal(next.status, 0, next.stderr);
  assert.doesNotMatch(next.stderr, /installing dependencies/);
  assert.match(next.stderr, /building the app/);
  const h = await health(next.stdout.trim());
  pids.add(h.pid);
  assert.notEqual(h.pid, old.pid);
  assert.notEqual(h.stamp, old.stamp);
  assert.equal(fs.readFileSync(path.join(skill, "dist", ".adp-build-stamp"), "utf8"), h.stamp);
  assert.equal(alivePid(old.pid), false, "the server on the old stamp still runs");
}, 300_000);
