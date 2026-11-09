/* The R8 text record. fixtures/screen-baseline.json holds what every screen
   of the vanilla page showed over the fixture corpus and the shipped packs:
   its text and every title and aria-label. The React screens must show the
   same record, so the app tests take it with the same code. */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const SCRIPTS = path.join(__dirname, "..");
const CORPUS = path.join(__dirname, "fixtures", "corpus");
const PACKS = path.join(SCRIPTS, "..", "packs");

// Due labels count days from today, so the baseline and every comparison run
// at one fixed local noon. Noon keeps the local calendar day the same in every zone CI uses.
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

module.exports = {record, snapshot, diskFetch, NOW};
