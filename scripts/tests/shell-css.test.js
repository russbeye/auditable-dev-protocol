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
  const orphans = [...used].filter(c => !shell.has(c)).sort();
  assert.deepEqual(orphans, []);
});
