/* Prints the URL of mission control for one repo, starting the server first
   when no live one serves that repo.

   Usage: node adp-launch.mts [repo-root]

   The repo root defaults to the working directory. Stdout carries exactly one
   line, the URL, so a caller can read it and go. Every repo gets one state
   file in a per-user directory under the temp dir, and we trust that file
   only as far as GET /health confirms it. */
import {spawn} from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {SCRIPTS_DIR, stamp, stateDir, statePath, type Health, type State} from "./adp-runtime.mts";

const WAIT_MS = 10_000;
const POSIX = process.platform !== "win32";
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/* A claim is the placeholder a launcher writes while its server starts. The
   server replaces it with the full state once it listens. */
type Claim = {claimant: number, at: number};

/* We make the state directory ours and private before we read anything in
   it. A directory someone else owns, or a symlink, could hand us a state file
   that points at a stranger's server, so we refuse to run on it. A directory
   we own with loose permissions may hold files another user planted, so we
   tighten it and drop what it holds. Windows has no POSIX owner or mode, so
   there the /health check alone decides trust. */
function trustedStateDir(): string {
  const dir = stateDir();
  fs.mkdirSync(dir, {recursive: true, mode: 0o700});
  if (!POSIX) return dir;
  const st = fs.lstatSync(dir);
  if (!st.isDirectory() || st.uid !== process.getuid!())
    throw new Error(`state directory ${dir} is not a directory this user owns`);
  if ((st.mode & 0o077) !== 0){
    for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f), {recursive: true, force: true});
    fs.chmodSync(dir, 0o700);
  }
  return dir;
}

function readState(file: string): State | Claim | null {
  try {
    const st = fs.lstatSync(file);
    if (!st.isFile() || (POSIX && st.uid !== process.getuid!())) { fs.rmSync(file, {force: true}); return null; }
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e: any) {
    if (e.code === "ENOENT") return null;
    // An unreadable or half-written file names no server we can trust.
    fs.rmSync(file, {force: true});
    return null;
  }
}

async function health(port: number): Promise<Health | null> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, {signal: AbortSignal.timeout(1000)});
    return res.ok ? await res.json() as Health : null;
  } catch { return null; }
}

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (e: any) { return e.code === "EPERM"; }
}

/* A state file counts only when the server on its port answers /health with
   the same root and the same pid. A dead pid, a reused port, or another
   repo's server all fail that test. */
async function liveServer(s: State, root: string): Promise<Health | null> {
  if (typeof s.port !== "number") return null;
  const h = await health(s.port);
  return h && h.root === root && h.pid === s.pid ? h : null;
}

async function stopServer(pid: number, port: number){
  try { process.kill(pid, "SIGTERM"); } catch {}
  const end = Date.now() + WAIT_MS;
  while (Date.now() < end && await health(port)) await sleep(100);
}

const url = (port: number) => `http://127.0.0.1:${port}/mission-control.html`;

async function launch(root: string): Promise<string> {
  trustedStateDir();
  const file = statePath(root);
  const want = stamp();
  const deadline = Date.now() + WAIT_MS;

  while (Date.now() < deadline){
    const s = readState(file);
    if (s && "port" in s){
      const h = await liveServer(s, root);
      if (h && h.stamp === want) return url(s.port);
      // A live server on old code stops, so one repo never has two servers.
      if (h) await stopServer(h.pid, s.port);
      fs.rmSync(file, {force: true});
      continue;
    }
    if (s && "claimant" in s){
      // Another launcher is starting a server. We wait for it, unless the
      // claimant died or the claim outlived the start window.
      if (alive(s.claimant) && Date.now() - s.at < WAIT_MS){ await sleep(100); continue; }
      fs.rmSync(file, {force: true});
      continue;
    }
    let fd: number;
    try { fd = fs.openSync(file, "wx", 0o600); }
    catch (e: any) { if (e.code === "EEXIST") continue; throw e; }
    const claim: Claim = {claimant: process.pid, at: Date.now()};
    fs.writeSync(fd, JSON.stringify(claim));
    fs.closeSync(fd);
    // The server must outlive this launcher and the shell that ran it, so it
    // gets its own process group and no handle back to us.
    spawn(process.execPath, [path.join(SCRIPTS_DIR, "adp-server.mts"), root, file],
      {detached: true, stdio: "ignore", windowsHide: true}).unref();
  }
  throw new Error(`no mission control server answered for ${root} within ${WAIT_MS / 1000}s`);
}

// The native realpath reports the casing on disk, so two spellings of one
// Windows path give one root, and /health compares them equal.
const root = fs.realpathSync.native(process.argv[2] ?? process.cwd());
launch(root).then(
  u => { process.stdout.write(u + "\n"); },
  e => { process.stderr.write(`adp-launch: ${e.message}\n`); process.exit(1); });
