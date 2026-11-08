/* The mission control server for one repo.

   Usage: node adp-server.mts <repo-root> <state-file>

   The launcher starts this process and never talks to it except over HTTP.
   We bind 127.0.0.1 on a free port, then write the state file the launcher
   waits for. We serve three trees and nothing else: the repo's .adp corpus,
   the skill's packs, and the page files at the top of scripts/. The shell
   builds its index in the browser from the corpus routes, so we never write
   an index to disk. */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import {DIST_DIR, PACKS_DIR, SCRIPTS_DIR, stamp, type Health, type State} from "./adp-runtime.mts";

const [rootArg, stateFile] = process.argv.slice(2);
if (!rootArg || !stateFile){
  process.stderr.write("usage: adp-server.mts <repo-root> <state-file>\n");
  process.exit(2);
}
const root = fs.realpathSync.native(rootArg);
const corpusRoot = path.join(root, ".adp");
const myStamp = stamp();

const PAGE_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
};

/* The pack files the skill ships, sorted, or null when the directory is
   absent. This listing is also the allow-list for /packs/<name>, so a name
   with a path separator or a traversal in it never reaches the disk. */
function packNames(): string[] | null {
  try {
    return fs.readdirSync(PACKS_DIR)
      .filter(f => f.endsWith(".pack.md") && fs.statSync(path.join(PACKS_DIR, f)).isFile()).sort();
  } catch { return null; }
}

/* The corpus root, resolved fresh on each request, or null while the repo
   has no .adp directory. Resolving it per request lets a run that creates
   .adp after launch see its corpus without a restart. */
function corpus(): string | null {
  try { return fs.realpathSync(corpusRoot); } catch { return null; }
}

function corpusFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, {withFileTypes: true})){
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) out.push(path.relative(dir, p).split(path.sep).join("/"));
    }
  };
  walk(dir);
  return out.sort();
}

/* We resolve the target with realpath, which collapses any ../ escape and
   follows symlinks. A target outside the base is a traversal attempt, so it
   gets the same plain 404 as a missing file. */
function inside(base: string, rel: string): string | null {
  let target: string;
  try { target = fs.realpathSync(path.join(base, rel)); } catch { return null; }
  if (!target.startsWith(base + path.sep)) return null;
  return fs.statSync(target).isFile() ? target : null;
}

function send(res: http.ServerResponse, status: number, type: string, body: string | Buffer){
  // We mark every response no-store. This server exists to show what is on
  // disk now, and a browser that guesses freshness shows a stale page.
  res.writeHead(status, {"Content-Type": type, "Content-Length": Buffer.byteLength(body), "Cache-Control": "no-store"});
  res.end(body);
}

const notFound = (res: http.ServerResponse, why: string) => send(res, 404, "text/plain; charset=utf-8", why + "\n");

/* The open pages learn of a corpus change through server-sent events. We
   check each file's path, size, and mtime once a second rather than trust
   fs.watch. A watcher misses an editor's rename on some platforms, needs a
   new watch for each new task directory, and fails without a word at the
   inotify limit. The check runs only while a page listens. */
const CHECK_MS = 1000;
const listeners = new Set<http.ServerResponse>();
let lastPrint: string | null = null;
let checker: NodeJS.Timeout | null = null;

function fingerprint(): string | null {
  const dir = corpus();
  if (!dir) return null;
  try {
    return corpusFiles(dir).map(f => {
      // A file removed between the listing and its stat simply leaves the
      // print. The next check sees the listing without it.
      try { const s = fs.statSync(path.join(dir, f)); return f + "\t" + s.size + "\t" + s.mtimeMs; }
      catch { return f; }
    }).join("\n");
  } catch { return null; }
}

function check(){
  const now = fingerprint();
  if (now === lastPrint) return;
  lastPrint = now;
  for (const res of listeners) res.write("data: change\n\n");
}

function listen(req: http.IncomingMessage, res: http.ServerResponse){
  if (!listeners.size){
    lastPrint = fingerprint();
    checker = setInterval(check, CHECK_MS);
    checker.unref();
  }
  listeners.add(res);
  req.on("close", () => {
    listeners.delete(res);
    if (!listeners.size && checker){ clearInterval(checker); checker = null; }
  });
  // The page reloads the corpus when the stream opens, so the headers go out
  // now rather than with the first change.
  res.writeHead(200, {"Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store"});
  res.flushHeaders();
}

function route(req: http.IncomingMessage, res: http.ServerResponse){
  // A page on another origin can rebind its own host name to 127.0.0.1 and
  // then read us as same-origin. Its requests still carry its own host name,
  // so we answer only the two names this server is reached by.
  const port = (server.address() as {port: number}).port;
  if (req.headers.host !== "127.0.0.1:" + port && req.headers.host !== "localhost:" + port)
    return send(res, 403, "text/plain; charset=utf-8", "unknown host\n");
  if (req.method !== "GET") return send(res, 405, "text/plain; charset=utf-8", "GET only\n");
  let p: string;
  try { p = decodeURIComponent(new URL(req.url ?? "/", "http://127.0.0.1").pathname); }
  catch { return notFound(res, "bad path"); }

  if (p === "/health"){
    const h: Health = {root, stamp: myStamp, pid: process.pid};
    return send(res, 200, "application/json; charset=utf-8", JSON.stringify(h));
  }
  if (p === "/events") return listen(req, res);
  if (p === "/corpus.json"){
    const dir = corpus();
    if (!dir) return notFound(res, "no corpus directory");
    return send(res, 200, "application/json; charset=utf-8",
      JSON.stringify({root: path.basename(root), files: corpusFiles(dir)}));
  }
  if (p.startsWith("/corpus/")){
    const dir = corpus();
    const target = dir && inside(dir, p.slice("/corpus/".length));
    if (!target) return notFound(res, "not in corpus");
    return send(res, 200, "text/plain; charset=utf-8", fs.readFileSync(target));
  }
  if (p === "/packs.json"){
    const names = packNames();
    if (!names) return notFound(res, "no packs directory");
    return send(res, 200, "application/json; charset=utf-8", JSON.stringify({packs: names}));
  }
  if (p.startsWith("/packs/")){
    const name = p.slice("/packs/".length);
    if (!packNames()?.includes(name)) return notFound(res, "not a pack");
    return send(res, 200, "text/markdown; charset=utf-8", fs.readFileSync(path.join(PACKS_DIR, name)));
  }
  // Page files sit at the top of scripts/ and carry a page extension. A name
  // with a slash in it never matches, so tests, sources, and the server's own
  // code stay unserved.
  const name = p.slice(1);
  const type = PAGE_TYPES[path.extname(name)];
  if (type && !name.includes("/") && !name.includes("\\")){
    // The build output sits beside the pages under one flat name space. We
    // resolve dist/ per request, because a rebuild removes and recreates it.
    let dist: string | null = null;
    try { dist = fs.realpathSync(DIST_DIR); } catch {}
    const target = inside(SCRIPTS_DIR, name) ?? (dist && inside(dist, name));
    if (target) return send(res, 200, type, fs.readFileSync(target));
  }
  return notFound(res, "not found");
}

const server = http.createServer(route);
server.listen(0, "127.0.0.1", () => {
  const addr = server.address();
  if (!addr || typeof addr === "string") process.exit(1);
  const state: State = {root, port: addr.port, pid: process.pid, stamp: myStamp};
  // We write beside the target and rename over it, so the launcher never
  // reads a half-written state file.
  const tmp = stateFile + "." + process.pid + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(state), {mode: 0o600});
  fs.renameSync(tmp, stateFile);
  setInterval(ownStateOrExit, 2000).unref();
});

/* A server whose state file no longer names it can never be found again, so
   it would run on as a second server for the repo. That happens when a
   launcher drops a state directory it cannot trust, or when the temp dir is
   cleaned. We check every two seconds and exit once the file is gone or names
   another process. */
function ownStateOrExit(){
  try {
    const s = JSON.parse(fs.readFileSync(stateFile, "utf8")) as State;
    if (s.pid === process.pid) return;
  } catch {}
  process.exit(0);
}

/* We remove the state file on a clean stop, but only while it still names
   this process. A newer server may own the file by then. */
function stop(){
  try {
    const s = JSON.parse(fs.readFileSync(stateFile, "utf8")) as State;
    if (s.pid === process.pid) fs.rmSync(stateFile);
  } catch {}
  process.exit(0);
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
