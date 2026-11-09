/* Prints the URL of mission control for one repo, starting the server first
   when no live one serves that repo.

   Usage: node adp-launch.mts [repo-root]

   The repo root defaults to the working directory. Stdout carries exactly one
   line, the URL, so a caller can read it and go. Every repo gets one state
   file in a per-user directory under the temp dir, and we trust that file
   only as far as GET /health confirms it. */
import {spawn, spawnSync} from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {BUILD_MARK, installed, SCRIPTS_DIR, SKILL_DIR, stamp, stateDir, statePath, type Health, type State} from "./adp-runtime.mts";

const WAIT_MS = 10_000;
// The skill gives a launch 300 s. A build lock older than that belongs to a
// launcher its caller gave up on, whatever process now holds its pid.
const LOCK_MS = 300_000;
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

/* What the state path holds, with the exact text we judged, so a later
   removal can make sure the file still holds that text. "unsettled" is a file
   we cannot parse yet. Claims and states both land whole, by link and by
   rename, so only a stranger's write gives an unparseable file. We still
   wait out the start window before we drop one, because removing a file a
   live launcher just wrote would let two launchers start servers. */
type Read = {value: State | Claim, text: string} | "unsettled" | null;

function readState(file: string): Read {
  let st: fs.Stats;
  try { st = fs.lstatSync(file); } catch { return null; }
  if (!st.isFile() || (POSIX && st.uid !== process.getuid!())) { fs.rmSync(file, {force: true}); return null; }
  let text = "";
  try { text = fs.readFileSync(file, "utf8"); return {value: JSON.parse(text), text}; }
  catch {
    if (Date.now() - st.mtimeMs < WAIT_MS) return "unsettled";
    removeIfSame(file, text);
    return null;
  }
}

/* We remove the state file only while it still holds the text we judged. A
   successor's claim or state may have replaced it after our read. */
function removeIfSame(file: string, text: string){
  try { if (fs.readFileSync(file, "utf8") === text) fs.rmSync(file); } catch {}
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

// The build writes its marker only when it succeeds, so a failed build runs
// again on the next launch.
function built(): boolean {
  try { return fs.readFileSync(BUILD_MARK, "utf8") === stamp(); } catch { return false; }
}

/* Runs one step with its output on our stderr, because stdout carries only
   the URL. A failed step ends the launch, and the error the tool printed
   stays above our one line. */
function step(what: string, cmd: string, args: string[]){
  process.stderr.write(`adp-launch: ${what}\n`);
  // npm is a .cmd file on Windows, and only a shell can run one.
  const r = spawnSync(cmd, args, {cwd: SKILL_DIR, stdio: ["ignore", 2, 2], shell: !POSIX && cmd === "npm"});
  if (r.status !== 0) throw new Error(`${what} failed`);
}

/* Installs the dependencies when the lockfile changed, and builds the bundle
   when the sources changed. Launchers for two repos share this skill
   directory, so they take turns through a lock file in the state directory.
   A lock whose holder died, or that outlived the launch window, is taken
   over. A pid alone cannot prove the holder lives, because a reboot can hand
   a dead launcher's pid to another process. */
async function prepare(dir: string){
  const lock = path.join(dir, "build-" + crypto.createHash("sha256").update(SKILL_DIR).digest("hex").slice(0, 16) + ".lock");
  // The lock lands whole by link, like the claim, so a reader never sees it
  // empty and takes it for a dead holder's.
  const tmp = lock + "." + process.pid;
  fs.writeFileSync(tmp, String(process.pid), {mode: 0o600});
  let told = false;
  try {
    for (;;){
      try { fs.linkSync(tmp, lock); break; }
      catch (e: any) {
        if (e.code !== "EEXIST") throw e;
        let text = "", age = 0;
        try { text = fs.readFileSync(lock, "utf8"); age = Date.now() - fs.statSync(lock).mtimeMs; } catch { continue; }
        // A pid of 0 would probe our own process group and always answer.
        const holder = Number(text);
        if (holder > 0 && alive(holder) && age < LOCK_MS){
          if (!told) process.stderr.write("adp-launch: waiting for another launcher to install or build\n");
          told = true;
          await sleep(200);
          continue;
        }
        removeIfSame(lock, text);
      }
    }
  } finally { fs.rmSync(tmp, {force: true}); }
  try {
    if (!installed(SKILL_DIR)) step("installing dependencies (npm ci)", "npm", ["ci"]);
    if (!built()) step("building the app", process.execPath,
      [path.join(SKILL_DIR, "node_modules", "vite", "bin", "vite.js"), "build", "--logLevel", "warn"]);
  } finally { fs.rmSync(lock, {force: true}); }
}

const url = (port: number) => `http://127.0.0.1:${port}/app.html`;

async function launch(root: string): Promise<string> {
  await prepare(trustedStateDir());
  const file = statePath(root);
  const want = stamp();
  const deadline = Date.now() + WAIT_MS;

  while (Date.now() < deadline){
    const r = readState(file);
    if (r === "unsettled"){ await sleep(100); continue; }
    const s = r?.value;
    if (r && s && "port" in s){
      const h = await liveServer(s, root);
      if (h && h.stamp === want) return url(s.port);
      // A live server on old code stops, so one repo never has two servers.
      if (h) await stopServer(h.pid, s.port);
      removeIfSame(file, r.text);
      continue;
    }
    if (r && s && "claimant" in s){
      // Another launcher is starting a server. We wait for it, unless the
      // claimant died or the claim outlived the start window.
      if (alive(s.claimant) && Date.now() - s.at < WAIT_MS){ await sleep(100); continue; }
      removeIfSame(file, r.text);
      continue;
    }
    // We write the claim whole beside the state path, then link it into
    // place. The link fails when any file holds the path, so one launcher
    // wins, and no reader ever sees a claim half written.
    const claim: Claim = {claimant: process.pid, at: Date.now()};
    const tmp = file + "." + process.pid + ".claim";
    fs.writeFileSync(tmp, JSON.stringify(claim), {mode: 0o600});
    try { fs.linkSync(tmp, file); }
    catch (e: any) { if (e.code === "EEXIST") continue; throw e; }
    finally { fs.rmSync(tmp, {force: true}); }
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
