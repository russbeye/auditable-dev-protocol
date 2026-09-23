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

/* The declarations of one rule inside a media block, by the query text and
   the rule's exact selector text. */
function mediaDeclarationsOf(cssText, query, selector){
  const noComments = cssText.replace(/\/\*[\s\S]*?\*\//g, "");
  const out = {};
  for (const m of noComments.matchAll(/@media\(([^)]*)\)\{((?:[^{}]*\{[^{}]*\})*)\s*\}/g)) {
    if (m[1] !== query) continue;
    for (const r of m[2].matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (r[1].trim() !== selector) continue;
      for (const d of r[2].split(";")) {
        const i = d.indexOf(":");
        if (i > 0) out[d.slice(0, i).trim()] = d.slice(i + 1).trim();
      }
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
  // The block's own classes take the nt- prefix; the shell classes it
  // modifies are the ops button's armed state and the screen's width cap.
  const block = css.slice(css.indexOf("/* ---- new task ---- */"));
  const own = [...classesIn(block)].filter(c => !c.startsWith("nt-")).sort();
  assert.deepEqual(own, ["is-armed", "is-bad", "is-ok", "is-on", "is-unset", "is-warn", "op", "screen"]);
});

test("the builder's columns are fractions of the stage and fold before the task row starves", () => {
  const css = read("adp-shell.css");
  // The builder lifts the screen cap and shares the stage two to one with
  // the card, so no column carries a fixed width the stage cannot pay.
  assert.equal(declarationsOf(css, ".screen.nt-wide")["max-width"], "1400px");
  assert.equal(declarationsOf(css, ".nt-grid")["grid-template-columns"], "minmax(0,2fr) minmax(280px,1fr)");
  assert.equal(declarationsOf(css, ".nt-row4")["grid-template-columns"], "minmax(0,1fr) minmax(0,2fr) minmax(0,1fr) 120px");
  // The rail takes 240px of the viewport, so the grid folds at 1290px,
  // where the stage is 1050px wide.
  assert.equal(mediaDeclarationsOf(css, "max-width:1290px", ".nt-grid")["grid-template-columns"], "1fr");
  // Each row shape folds on its own. The task row has no delete cell and
  // keeps two columns. The three-input rows stack with the delete last.
  assert.equal(mediaDeclarationsOf(css, "max-width:1000px", ".nt-row4")["grid-template-columns"], "1fr 1fr");
  assert.equal(mediaDeclarationsOf(css, "max-width:1000px", ".nt-row3,.nt-rowr")["grid-template-columns"], "1fr");
  assert.equal(mediaDeclarationsOf(css, "max-width:1000px", ".nt-row3 .nt-del,.nt-rowr .nt-del")["justify-self"], "end");
  assert.deepEqual(mediaDeclarationsOf(css, "max-width:1000px", ".nt-row4,.nt-row3,.nt-rowr"), {});
  // The card's path breaks inside a token only when a whole token cannot
  // fit. The yaml panel has no grid row of its own.
  const dir = declarationsOf(css, ".nt-dir");
  assert.equal(dir["overflow-wrap"], "anywhere");
  assert.equal(dir["word-break"], undefined);
  assert.equal(classesIn(css).has("nt-yamlwrap"), false);
});

test("under the fold the export card heads the column and stops sticking", () => {
  const css = read("adp-shell.css");
  assert.equal(declarationsOf(css, ".nt-side")["position"], "sticky");
  // A sticky element below the whole form never engages, so the card goes
  // first and static once the grid is one column.
  assert.deepEqual(mediaDeclarationsOf(css, "max-width:1290px", ".nt-side"), {order: "-1", position: "static"});
  // The override has to follow the sticky rule, or the sticky rule wins.
  assert.ok(css.indexOf(".nt-side{position:sticky") < css.indexOf(".nt-side{order:-1;position:static}"));
});
