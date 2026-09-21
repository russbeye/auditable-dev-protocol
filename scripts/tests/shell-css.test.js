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

/* The declarations of one top-level rule, by exact selector text. The page
   harness has no layout engine, so a layout rule is pinned here by what it
   declares: an edit that drops the declaration fails a test instead of a
   browser check. At-rule blocks are stripped first, so a media override
   never reads as the rule it overrides. */
function stripAtRules(cssText){
  let out = "", depth = 0, i = 0;
  while (i < cssText.length) {
    if (depth === 0 && cssText[i] === "@") {
      // Skip to the block's matching close brace, counting nested pairs.
      while (i < cssText.length && cssText[i] !== "{") i++;
      depth = 1; i++;
      while (i < cssText.length && depth > 0) {
        if (cssText[i] === "{") depth++;
        else if (cssText[i] === "}") depth--;
        i++;
      }
      continue;
    }
    out += cssText[i++];
  }
  return out;
}
function declarationsOf(cssText, selector){
  const noComments = stripAtRules(cssText.replace(/\/\*[\s\S]*?\*\//g, ""));
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

test("the rule reader returns the top-level rule, not its media override", () => {
  const css = read("adp-shell.css");
  // The tile grid is four columns on the desktop and two under the phone
  // media query; a reader that folded nested rules in would return two.
  assert.equal(declarationsOf(css, ".caltiles")["grid-template-columns"], "repeat(4,1fr)");
  assert.deepEqual(declarationsOf("@media(max-width:1px){.x{a:1}} .x{a:2}", ".x"), {a: "2"});
  assert.deepEqual(declarationsOf("@supports(a:b){@media(c){.x{a:1}}}", ".x"), {});
});

test("the new task block scopes its element rules and prefixes its classes", () => {
  const css = read("adp-shell.css");
  const noComments = stripAtRules(css.replace(/\/\*[\s\S]*?\*\//g, ""));
  // A bare element selector at the top level would restyle the inspector's
  // paste textarea and the section select; every element rule sits under
  // the form.
  const selectors = noComments.split(/\{[^{}]*\}/).map(s => s.trim()).filter(Boolean);
  const bare = selectors.flatMap(s => s.split(",").map(x => x.trim()))
    .filter(s => /^(input|textarea|select|label)\b/.test(s));
  assert.deepEqual(bare, []);
  // The block's own classes take the nt- prefix; the one shell class it
  // modifies is the ops button's armed state.
  const block = css.slice(css.indexOf("/* ---- new task ---- */"));
  const own = [...classesIn(block)].filter(c => !c.startsWith("nt-")).sort();
  assert.deepEqual(own, ["is-armed", "is-bad", "is-ok", "is-on", "is-unset", "is-warn", "op"]);
});
