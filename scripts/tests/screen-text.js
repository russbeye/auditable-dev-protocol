/* The R8 text baseline. We boot the real mission-control.html in jsdom over
   the fixture corpus and the shipped packs, walk every screen the page can
   reach from that corpus, and record what each one shows: its text and every
   title and aria-label. The React screens must later show the same record,
   so the record comes from a real DOM and not from the hand-written harness,
   whose parser loses the order of text inside mixed content. */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {JSDOM} = require("jsdom");

const SCRIPTS = path.join(__dirname, "..");
const CORPUS = path.join(__dirname, "fixtures", "corpus");
const PACKS = path.join(SCRIPTS, "..", "packs");
const LIBS_PATH = path.join(SCRIPTS, "..", "dist", "adp-libs.js");

// Due labels count days from today, so every capture runs at one fixed
// local noon. Noon keeps the local calendar day the same in every zone CI uses.
const NOW = new Date(2026, 10, 6, 12, 0, 0).getTime();

function corpusFiles(dir){
  const out = [];
  const walk = d => {
    for (const e of fs.readdirSync(d, {withFileTypes: true})){
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) out.push(path.relative(dir, p).split(path.sep).join("/"));
    }
  };
  walk(dir);
  return out.sort();
}

// The page fetches relative URLs, so this stub answers the same four routes
// the server does, from the same directories.
function diskFetch(){
  const ok = body => Promise.resolve({ok: true, json: async () => body, text: async () => body});
  const miss = () => Promise.resolve({ok: false});
  return u => {
    if (u === "corpus.json") return ok({root: "corpus", files: corpusFiles(CORPUS)});
    if (u === "packs.json") return ok({packs: fs.readdirSync(PACKS).filter(f => f.endsWith(".pack.md")).sort()});
    for (const [prefix, dir] of [["corpus/", CORPUS], ["packs/", PACKS]]){
      if (!u.startsWith(prefix)) continue;
      const rel = u.slice(prefix.length).split("/").map(decodeURIComponent).join("/");
      const p = path.join(dir, rel);
      return fs.existsSync(p) ? ok(fs.readFileSync(p, "utf8")) : miss();
    }
    return miss();
  };
}

function pageScripts(html){
  const blocks = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m => m[1]).filter(s => s.trim());
  const prePaint = blocks.find(s => s.includes("prefers-color-scheme"));
  const main = blocks.find(s => s.includes("ADPShellLib"));
  if (!prePaint || !main) throw new Error("expected scripts not found in mission-control.html");
  return {prePaint, main};
}

/* Boots the page and resolves once the corpus and the packs have loaded. The
   caller must call close(), because the page's poll interval keeps running. */
async function bootPage(){
  const html = fs.readFileSync(path.join(SCRIPTS, "mission-control.html"), "utf8");
  const dom = new JSDOM(html.replace(/<script[\s\S]*?<\/script>/g, ""),
    {url: "http://127.0.0.1:1/mission-control.html", runScripts: "outside-only", pretendToBeVisual: true});
  const w = dom.window;
  const RealDate = w.Date;
  w.Date = class extends RealDate {
    constructor(...a){ if (a.length) super(...a); else super(NOW); }
    static now(){ return NOW; }
  };
  w.matchMedia = () => ({matches: false, addEventListener(){}, removeEventListener(){}});
  w.fetch = diskFetch();
  w.localStorage.setItem("adp-theme", "dark");
  const {prePaint, main} = pageScripts(html);
  w.eval(prePaint);
  w.eval(fs.readFileSync(LIBS_PATH, "utf8"));
  w.eval(main);
  await settle(w);
  return {window: w, document: w.document, close: () => w.close()};
}

/* Lets the page's promise chains run. The boot needs many turns, because
   the corpus load awaits one fetch per file. A click renders synchronously,
   so one turn after it is enough. */
async function settle(w, turns = 20){
  for (let i = 0; i < turns; i++) await new Promise(r => w.setTimeout(r, 0));
}

const ATTRS = ["title", "aria-label", "placeholder", "alt"];

/* Sibling text nodes with no element between them read as one run of text.
   React renders "{n} slots used" as two such nodes, where a parsed HTML
   string gives one. A comment node shows nothing, so it does not end the
   run. */
function textRun(n){
  const w = n.ownerDocument.defaultView;
  let s = "";
  for (let m = n; m && (m.nodeType === w.Node.TEXT_NODE || m.nodeType === w.Node.COMMENT_NODE); m = m.nextSibling)
    if (m.nodeType === w.Node.TEXT_NODE) s += m.data;
  return s;
}

function runContinues(n){
  const w = n.ownerDocument.defaultView;
  for (let m = n.previousSibling; m; m = m.previousSibling){
    if (m.nodeType === w.Node.TEXT_NODE) return true;
    if (m.nodeType !== w.Node.COMMENT_NODE) return false;
  }
  return false;
}

/* What one region of the page shows. Each run of text becomes one entry with
   its whitespace collapsed, so a change in markup nesting or indentation
   does not count as a change in text. The attributes a person reads through
   a tooltip or a screen reader come next, in document order. */
function record(el){
  const w = el.ownerDocument.defaultView;
  const text = [], attrs = [];
  const tw = el.ownerDocument.createTreeWalker(el, w.NodeFilter.SHOW_ELEMENT | w.NodeFilter.SHOW_TEXT);
  for (let n = tw.currentNode; n; n = tw.nextNode()){
    if (n.nodeType === w.Node.TEXT_NODE){
      if (n.parentElement && /^(SCRIPT|STYLE)$/.test(n.parentElement.tagName)) continue;
      if (runContinues(n)) continue;
      const t = textRun(n).replace(/\s+/g, " ").trim();
      if (t) text.push(t);
    } else {
      for (const a of ATTRS){
        const v = n.getAttribute(a);
        if (v !== null && v.trim()) attrs.push(a + "=" + v.replace(/\s+/g, " ").trim());
      }
    }
  }
  return {text, attrs};
}

// The header, the rail, the footer, and the one screen on show. The other
// screens keep whatever they last rendered, which no one can see.
function snapshot(d){
  const screen = d.querySelector("section.screen.is-on");
  return {
    screen: screen ? screen.getAttribute("data-s") : null,
    header: record(d.querySelector(".shell > header")),
    rail: record(d.getElementById("rail")),
    main: screen ? record(screen) : null,
    footer: record(d.getElementById("foot"))
  };
}

/* Every screen the page reaches from the fixture corpus, keyed by how we got
   there. The inspector shows each section of each ticket, its full log, and
   its prompt. The resume pack screen shows each pack for each ticket. The
   corpus-wide boards and the new task screen show once each. */
async function captureAll(){
  const p = await bootPage();
  const d = p.document, w = p.window;
  const out = {};
  const click = el => { el.dispatchEvent(new w.MouseEvent("click", {bubbles: true})); return settle(w, 1); };
  const tab = name => click([...d.querySelectorAll(".mtab")].find(t => t.getAttribute("data-s") === name));
  try {
    out["boot"] = snapshot(d);
    const tickets = [...d.querySelectorAll(".rentry")].map(r => r.getAttribute("data-key"));
    for (const t of tickets){
      await tab("inspector");
      await click([...d.querySelectorAll(".rentry")].find(r => r.getAttribute("data-key") === t));
      await click(d.querySelector('[data-view="section"]'));
      const secs = [...d.querySelectorAll("#secSel option")].map(o => o.value);
      for (const s of secs){
        const sel = d.getElementById("secSel");
        sel.value = s;
        sel.dispatchEvent(new w.Event("change", {bubbles: true}));
        await settle(w, 1);
        out["inspector|" + t + "|section|" + s] = snapshot(d);
      }
      await click(d.querySelector('[data-view="full"]'));
      out["inspector|" + t + "|full"] = snapshot(d);
      await click(d.querySelector('[data-view="section"]'));
      await tab("resume pack");
      for (const pk of [...d.querySelectorAll(".pk")].map(b => b.getAttribute("data-pk"))){
        await click([...d.querySelectorAll(".pk")].find(b => b.getAttribute("data-pk") === pk));
        out["resume pack|" + t + "|" + pk] = snapshot(d);
      }
    }
    for (const name of ["reviews", "watchboard", "ledgers", "calibration"]){
      await tab(name);
      out[name] = snapshot(d);
    }
    await click(d.getElementById("newTaskBtn"));
    out["new task"] = snapshot(d);
  } finally { p.close(); }
  return out;
}

module.exports = {bootPage, settle, captureAll, record, snapshot, diskFetch, NOW};
