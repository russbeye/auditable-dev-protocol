/* The rules the ADP design system sets for mission control's two stylesheets.
   adp-tokens.css comes from the design system's tokens.json, and
   adp-bundle.css is a copy of its components/bundle.css. These tests hold
   both files to that source and to the system's grid, color, and texture
   rules. */
"use strict";

import {test} from "vitest";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {readFixture} = require("./helpers.js");
const {generate, PLAIN} = require("../gen-adp-tokens.mts");

const SCRIPTS = path.join(__dirname, "..");
const read = name => fs.readFileSync(path.join(SCRIPTS, name), "utf8");
const TOKENS = JSON.parse(readFixture("design-system-tokens.json"));
const tokensCss = read("adp-tokens.css");
const bundleCss = read("adp-bundle.css");

const noComments = css => css.replace(/\/\*[\s\S]*?\*\//g, "");

/* Every rule as its selector and its declarations, at-rule blocks included.
   A keyframe step reads as a rule too, which the scans below allow for. */
function rules(css){
  const out = [];
  for (const m of noComments(css).matchAll(/([^{};]+)\{([^{}]*)\}/g)){
    const decls = [];
    for (const d of m[2].split(";")){
      const i = d.indexOf(":");
      if (i > 0) decls.push({prop: d.slice(0, i).trim(), value: d.slice(i + 1).trim()});
    }
    out.push({sel: m[1].trim(), decls});
  }
  return out;
}
const props = r => Object.fromEntries(r.decls.map(d => [d.prop, d.value]));

// ---- R2: adp-tokens.css is tokens.json, both themes, nothing else ----

test("adp-tokens.css is what the generator writes from the checked-in tokens.json", () => {
  assert.equal(tokensCss, generate(TOKENS));
});

test("adp-tokens.css declares every token in tokens.json for both themes, and nothing else", () => {
  const blocks = Object.fromEntries(rules(tokensCss).map(r => [r.sel, props(r)]));
  const themes = TOKENS.color.themes.map(t => t.id);
  assert.deepEqual(Object.keys(blocks), [`:root, :root[data-theme="${themes[0]}"]`,
    ...themes.slice(1).map(id => `:root[data-theme="${id}"]`), ":root"]);
  for (const id of themes){
    const sel = id === themes[0] ? `:root, :root[data-theme="${id}"]` : `:root[data-theme="${id}"]`;
    const want = Object.fromEntries(TOKENS.color.tokens.map(t =>
      ["--" + t.name, typeof t.value === "string" ? t.value : t.value[id] ?? t.value[themes[0]]]));
    assert.deepEqual(blocks[sel], want, id);
  }
  const plain = {};
  for (const [name, stack] of Object.entries(TOKENS.type.families)) plain["--font-" + name] = stack;
  for (const fam of PLAIN) for (const t of TOKENS[fam].tokens) plain["--" + t.name] = t.value;
  assert.deepEqual(blocks[":root"], plain);
});

// The bundle reads tokens by name, so a name the token file lacks would
// leave a property unset with no error anywhere.
test("every token adp-bundle.css reads is one adp-tokens.css declares", () => {
  const declared = new Set([...tokensCss.matchAll(/(--[\w-]+)\s*:/g)].map(m => m[1]));
  const read = new Set([...noComments(bundleCss).matchAll(/var\((--[\w-]+)/g)].map(m => m[1]));
  assert.deepEqual([...read].filter(n => !declared.has(n)), []);
});

// ---- R5: the accent lights the live dot and nothing else ----

test("var(--accent) appears only in the live-dot rule across both new stylesheets", () => {
  const users = [...rules(tokensCss), ...rules(bundleCss)]
    .filter(r => r.decls.some(d => d.value.includes("var(--accent")))
    .map(r => r.sel);
  assert.deepEqual(users, [".adp-livedot"]);
});

// ---- R8: every vertical length sits on the system's scale ----

/* The scale by property, per DL-008. A margin, padding, or gap takes a
   space step. A box height or a line height may also take a named fixed
   height. Every exception is on the DL-006 list, by selector and value. */
const STEPS = [0, 4, 8, 12, 16, 20, 24, 32, 40, 48, 56, 80];
const FIXED = [20, 24, 28, 32, 36, 48, 52];
const OFF_SCALE = [
  ".adp-code padding 1", ".adp-prose code padding 1", ".adp-seg button height 26", ".adp-seg--full button height 30",
  ".adp-dl__body code padding 1", ".adp-table code padding 1", ".adp-cal__bar gap 2",
  ".adp-cal__legend i height 10", ".adp-empty__actions margin-top 28"
];
const px = v => /^-?[\d.]+(px)?$/.test(v) ? parseFloat(v) : null;

/* The vertical lengths one declaration sets, each with whether a fixed
   height may stand in for a step. A shorthand gives its top and bottom
   values, and a font shorthand gives its line height. */
function verticals({prop, value}){
  const parts = value.split(/\s+/);
  if (/^(height|min-height|max-height)$/.test(prop)) return [[px(value), true]];
  if (prop === "line-height") return [[px(value), true]];
  if (prop === "font"){ const m = value.match(/\/([\d.]+)px/); return m ? [[parseFloat(m[1]), true]] : []; }
  if (/^(margin|padding)-(top|bottom)$/.test(prop) || /^(top|bottom|row-gap)$/.test(prop)) return [[px(value), false]];
  if (prop === "margin" || prop === "padding") return [[px(parts[0]), false], [px(parts[2] ?? parts[0]), false]];
  if (prop === "gap") return [[px(parts[0]), false]];
  return [];
}

test("every vertical length in adp-bundle.css is on the spacing scale or on the DL-006 list", () => {
  const off = [];
  for (const r of rules(bundleCss)){
    if (r.sel.startsWith("@") || /^\d+%$/.test(r.sel)) continue;
    for (const d of r.decls) for (const [v, fixed] of verticals(d)){
      if (v === null || STEPS.includes(v) || (fixed && FIXED.includes(v))) continue;
      off.push(`${r.sel} ${d.prop} ${v}`);
    }
  }
  assert.deepEqual([...new Set(off)], OFF_SCALE);
});

// ---- R12: the film grain stays, and no badge pattern comes back ----

/* adp-theme.css drew this grain before the design pass. We keep its rule
   here, so the comparison still has its source after that sheet retires. */
const THEME_GRAIN = `content:"";position:fixed;inset:0;z-index:0;pointer-events:none;
  opacity:.08;mix-blend-mode:overlay;
  background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.72' numOctaves='4' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
  background-size:180px 180px;`;

test("the grain rule in adp-bundle.css equals the body::before rule that adp-theme.css drew", () => {
  const grain = rules(bundleCss).filter(r => r.sel === "body::before");
  assert.equal(grain.length, 1);
  assert.deepEqual(props(grain[0]), props(rules(`body::before{${THEME_GRAIN}}`)[0]));
});

test("no stylesheet the app loads names adp-bg.svg or draws a body::after layer", () => {
  const sheets = [...read("app.html").matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map(m => m[1]);
  assert.ok(sheets.includes("adp-tokens.css") && sheets.includes("adp-bundle.css"));
  for (const s of sheets){
    const css = noComments(read(s));
    assert.ok(!css.includes("adp-bg.svg"), s + " names adp-bg.svg");
    assert.ok(!/body::after/.test(css), s + " draws a body::after layer");
  }
});

// ---- R15: no hairline moves text off the 4px grid ----

// A box whose height comes from its content must draw its hairlines as
// inset box-shadows, so a border counts only where the rule fixes a height.
test("adp-bundle.css draws a border only on a rule that fixes its height", () => {
  const bad = [];
  for (const r of rules(bundleCss)){
    const p = props(r);
    if ("height" in p && p.height !== "auto") continue;
    for (const d of r.decls){
      if (!/^border(-top|-bottom)?$/.test(d.prop)) continue;
      const w = d.value.match(/(^|\s)([\d.]+)px/);
      if (w && parseFloat(w[2]) > 0) bad.push(`${r.sel} ${d.prop}: ${d.value}`);
    }
  }
  assert.deepEqual(bad, []);
});

// ---- local departures from the design system's bundle ----

// The two rules this copy changes (DL-049, DL-054): a decision card's field
// labels and a prose eyebrow heading read in blue-bright, so a label never
// blends into the text under it. A card's fields keep the source's 16px gap
// (DL-057). The header comment names the same changes.
test("card labels and prose eyebrows take blue-bright, and card fields keep the 16px gap", () => {
  const at = sel => props(rules(bundleCss).find(r => r.sel === sel));
  assert.equal(at(".adp-dl__body").gap, "16px");
  assert.equal(at(".adp-dl__body dt").color, "var(--blue-bright)");
  assert.equal(at(".adp-prose h3").color, "var(--blue-bright)");
  // The header is the comment that names the source version.
  const head = bundleCss.match(/\/\*[^*]*Copied from[\s\S]*?\*\//)[0].replace(/\s+/g, " ");
  assert.match(head, /Two rules depart from the source\. A decision card's field labels take blue-bright, not dim\./);
  assert.match(head, /A prose eyebrow heading takes blue-bright, not dim\./);
  assert.doesNotMatch(head, /24px/);
});
