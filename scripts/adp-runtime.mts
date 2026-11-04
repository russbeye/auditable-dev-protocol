/* Shared ground for the launcher and the server. Both sides must agree on
   where a repo's state file lives and on the stamp that names the code a
   server runs, so the two derive them from this one module. Only node:
   builtins appear here, because the launcher runs before npm ci. */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The server's traversal guard compares realpaths, so the base must be one
// too, or a skill reached through a symlink would serve nothing.
export const SCRIPTS_DIR = fs.realpathSync(import.meta.dirname);
export const SKILL_DIR = path.dirname(SCRIPTS_DIR);
export const PACKS_DIR = path.join(SKILL_DIR, "packs");

export type State = {root: string, port: number, pid: number, stamp: string};
export type Health = {root: string, stamp: string, pid: number};

/* One spelling per repo. Windows paths compare without case, so we fold the
   case there, or two launches that spell the drive letter differently would
   start two servers for one repo. */
export function repoKey(root: string): string {
  const real = fs.realpathSync.native(root);
  return process.platform === "win32" ? real.toLowerCase() : real;
}

export function stateDir(): string {
  return path.join(os.tmpdir(), "adp-" + os.userInfo().username);
}

export function statePath(root: string): string {
  const hash = crypto.createHash("sha256").update(repoKey(root)).digest("hex").slice(0, 16);
  return path.join(stateDir(), hash + ".json");
}

/* The files whose bytes decide what a server serves and how. We hash them in
   a fixed order, so a pull that changes any of them gives a new stamp and the
   launcher restarts the server that runs the old code. */
function stampFiles(): string[] {
  const top = fs.readdirSync(SCRIPTS_DIR).filter(f => /\.(mts|html|css|js|svg)$/.test(f)).sort();
  const files = top.map(f => path.join(SCRIPTS_DIR, f));
  const lock = path.join(SKILL_DIR, "package-lock.json");
  if (fs.existsSync(lock)) files.push(lock);
  return files;
}

export function stamp(): string {
  const h = crypto.createHash("sha256");
  for (const f of stampFiles()){
    h.update(path.relative(SKILL_DIR, f) + "\0");
    h.update(fs.readFileSync(f));
    h.update("\0");
  }
  return h.digest("hex").slice(0, 16);
}
