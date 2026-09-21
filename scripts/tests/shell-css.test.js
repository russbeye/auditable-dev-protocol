"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const S = require("../adp-shell-lib.js");

function read(name){
  return fs.readFileSync(path.join(__dirname, "..", name), "utf8");
}

/* Class names used in selectors. Selector text sits between a closing brace,
   or the file start, and the next opening brace, so declaration bodies never
   reach the class regex. */
function classesIn(cssText){
  const noComments = cssText.replace(/\/\*[\s\S]*?\*\//g, "");
  const out = new Set();
  for (const seg of noComments.split(/\{[^{}]*\}/)) {
    for (const m of seg.matchAll(/\.([A-Za-z_-][A-Za-z0-9_-]*)/g)) out.add(m[1]);
  }
  return out;
}

/* The declarations of one rule, by exact selector text. The page harness
   has no layout engine, so a layout rule is pinned here by what it declares:
   an edit that drops the declaration fails a test instead of a browser check. */
function declarationsOf(cssText, selector){
  const noComments = cssText.replace(/\/\*[\s\S]*?\*\//g, "");
  const out = {};
  for (const m of noComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1].trim() !== selector) continue;
    for (const d of m[2].split(";")) {
      const i = d.indexOf(":");
      if (i > 0) out[d.slice(0, i).trim()] = d.slice(i + 1).trim();
    }
  }
  return out;
}

test("adp-shell.css and adp-theme.css share no class name", () => {
  const shell = classesIn(read("adp-shell.css"));
  const theme = classesIn(read("adp-theme.css"));
  const shared = [...shell].filter(c => theme.has(c)).sort();
  assert.deepEqual(shared, []);
});

test("the shell page and its tab strip use only adp-shell.css classes", () => {
  const shell = classesIn(read("adp-shell.css"));
  const html = fs.readFileSync(path.join(__dirname, "..", "mission-control.html"), "utf8");
  const used = new Set();
  for (const m of html.matchAll(/class="([^"]+)"/g)) {
    m[1].split(/\s+/).forEach(c => used.add(c));
  }
  for (const m of S.tabsHtml("inspector").matchAll(/class="([^"]+)"/g)) {
    m[1].split(/\s+/).forEach(c => used.add(c));
  }
  // The one deliberate theme class in shell markup: rendered document bodies
  // are wrapped in .md, so adp-theme's document styles apply to parser-lib
  // output. Everything else the shell paints, the shell sheet owns.
  const allowed = new Set(["md"]);
  const orphans = [...used].filter(c => !shell.has(c) && !allowed.has(c)).sort();
  assert.deepEqual(orphans, []);
});


test("the ledger panel contains its floated pill row and every child after the heading clears it", () => {
  const css = read("adp-shell.css");
  // flow-root keeps a wide pill row inside the panel's border; the sibling
  // clear puts the table or the empty-state notice below it, never beside.
  assert.equal(declarationsOf(css, ".ipanel").display, "flow-root");
  assert.equal(declarationsOf(css, ".ipanel h2 ~ *").clear, "both");
  // A one-entry segment keeps a visible floor beside a forty-entry one.
  assert.equal(declarationsOf(css, ".calseg")["min-width"], "8px");
});
