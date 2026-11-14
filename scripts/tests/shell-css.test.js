"use strict";

import {test} from "vitest";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const S = require("../../src/lib/adp-shell-lib.ts");

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

/* The declarations of one top-level rule, by exact selector text. jsdom
   has no layout engine, so a layout rule is pinned here by what it
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

test("no page root in either sheet clips horizontal overflow", () => {
  // A clip on the page root hides content that runs past the window instead
  // of letting the reader scroll to it. Every page loads adp-theme.css, and
  // mission control adds adp-shell.css, so both sheets must leave the root
  // alone, media blocks included.
  for (const name of ["adp-theme.css", "adp-shell.css"]) {
    const noComments = read(name).replace(/\/\*[\s\S]*?\*\//g, "");
    for (const m of noComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      // A :root selector, with or without an attribute suffix, selects the
      // same element as html. We drop any statement such as an @import that
      // precedes the selector, since it ends in a semicolon.
      const roots = m[1].split(";").pop().split(",").map(s => s.trim())
        .filter(s => s === "html" || s === "body" || /^:root(\[[^\]]*\])*$/.test(s));
      if (!roots.length) continue;
      const props = m[2].split(";").map(d => d.slice(0, d.indexOf(":")).trim());
      assert.deepEqual(props.filter(p => p === "overflow" || p === "overflow-x"), [],
        name + " " + m[1].trim());
    }
  }
});



// The prompt view paints its cards from the shell sheet and borrows only the
// theme's document classes for markdown, lists, and tables inside a card.
test("the prompt view uses shell card classes and only the theme's document classes", () => {
  const shell = classesIn(read("adp-shell.css"));
  const borrowed = new Set(["md", "md-list", "md-tbl", "tbl-wrap"]);
  const html = S.promptViewHtml({schema_version: "1.0", task: {id: "x", note: ""}, prompt: "a\n- b",
    context: {links: ["https://e.com"], references: [{path: "p", note: "n"}]}, output: {structure: ""},
    protocol: {defers: [{phase: "x", reason: "y"}], artifacts: []}});
  const used = new Set();
  for (const m of html.matchAll(/class="([^"]+)"/g)) m[1].split(/\s+/).forEach(c => used.add(c));
  assert.deepEqual([...used].filter(c => !shell.has(c) && !borrowed.has(c)).sort(), []);
  const theme = classesIn(read("adp-theme.css"));
  assert.deepEqual([...borrowed].filter(c => !theme.has(c)), []);
  for (const c of ["pcards", "pcard", "pcard-head", "pcard-title", "pcard-val", "pcard-key", "pcard-grid",
                   "pcard-k", "pcard-v", "pcard-body", "pcard-none"]) assert.ok(used.has(c), c);
});

test("the rule reader returns the top-level rule, not its media override", () => {
  // A reader that folded nested rules in would return the media override.
  assert.deepEqual(declarationsOf("@media(max-width:1px){.x{a:1}} .x{a:2}", ".x"), {a: "2"});
  assert.deepEqual(declarationsOf("@supports(a:b){@media(c){.x{a:1}}}", ".x"), {});
});

test("the shell gives back the page scrollbar track the theme reserves", () => {
  // The theme reserves the track for pages that scroll. The shell scrolls
  // only inside the stage, so a reserved track would sit empty beside it.
  assert.equal(declarationsOf(read("adp-theme.css"), "html")["scrollbar-gutter"], "stable");
  assert.equal(declarationsOf(read("adp-shell.css"), "html")["scrollbar-gutter"], "auto");
});

test("the mono typeface and the one-line rule are separate classes", () => {
  const css = read("adp-shell.css");
  assert.equal(declarationsOf(css, ".mono")["white-space"], undefined);
  assert.equal(declarationsOf(css, ".mono")["font-family"], "var(--mono)");
  assert.equal(declarationsOf(css, ".nw")["white-space"], "nowrap");
});
