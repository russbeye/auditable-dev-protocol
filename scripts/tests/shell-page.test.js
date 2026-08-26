"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const S = require("../adp-shell-lib.js");
const B = require("../adp-index-builder-lib.js");
const I = require("../adp-index-lib.js");
const {bootShell} = require("./shell-harness.js");

const HTML = fs.readFileSync(path.join(__dirname, "..", "mission-control.html"), "utf8");

// A small corpus with one full ticket and one prompt-only ticket, which is
// enough to exercise the seam's fetch selection and the builder handoff.
const LOG = [
  "# Audit Log — AA1 alpha",
  "",
  "## Problem Statement",
  "",
  "**What the problem is:** demo.",
  ""
].join("\n");
const LISTING = {
  root: "demo",
  files: ["20260101-AA1-alpha/audit-log.md", "20260101-AA1-alpha/prompt.yaml", "AV-002-beta/prompt.yaml"]
};
const TEXTS = {"20260101-AA1-alpha/audit-log.md": LOG};

// The stub decodes each segment the way the server unquotes its route, so an
// unencoded fetch of a path with reserved characters misses here too.
function corpusFetch(listing, texts){
  return u => {
    if (u === "corpus.json") return Promise.resolve({ok: true, json: async () => listing});
    if (u.startsWith("corpus/")) {
      const p = u.slice("corpus/".length).split("/").map(decodeURIComponent).join("/");
      if (p in texts) return Promise.resolve({ok: true, text: async () => texts[p]});
      return Promise.resolve({ok: false});
    }
    return Promise.resolve({ok: false});
  };
}

// ---- lib: localDate ----

test("localDate composes the local calendar day and satisfies IDX-004", () => {
  assert.equal(S.localDate(new Date(2026, 7, 25, 23, 30)), "2026-08-25");
  assert.equal(S.localDate(new Date(2026, 0, 5)), "2026-01-05");
  assert.equal(I.isDate(S.localDate(new Date(2026, 7, 25))), true);
});

// ---- lib: logPaths ----

test("logPaths keeps exactly the paths the builder reads text from", () => {
  const files = ["A-1-x/audit-log.md", "A-1-x/prompt.yaml", "A-1-x/references/audit-log.md",
                 "audit-log.md", "./C-3-z/audit-log.md", "B-2-y/audit-log.md"];
  assert.deepEqual(S.logPaths(files),
    ["A-1-x/audit-log.md", "./C-3-z/audit-log.md", "B-2-y/audit-log.md"]);
  assert.deepEqual(S.logPaths(files), files.filter(p => B.isLogPath(p)));
});

// ---- lib: the seam ----

test("loadCorpus builds the same bytes as a direct Node build", async () => {
  const now = new Date(2026, 7, 25, 12, 0, 0);
  const got = await S.loadCorpus(corpusFetch(LISTING, TEXTS), {now});
  const want = B.buildIndex(
    LISTING.files.map(p => (p in TEXTS ? {path: p, text: TEXTS[p]} : {path: p})),
    {project: "demo", generated: "2026-08-25", source: "working-tree"}
  );
  assert.equal(I.serializeIndex(got), I.serializeIndex(want));
  assert.deepEqual(I.validateIndex(got), []);
  assert.equal(got.source, "working-tree");
});

test("loadCorpus resolves null on every failure shape", async t => {
  const warn = t.mock.method(console, "warn", () => {});
  assert.equal(await S.loadCorpus(() => Promise.reject(new Error("down"))), null);
  assert.equal(await S.loadCorpus(() => Promise.resolve({ok: false})), null);
  assert.equal(await S.loadCorpus(() => Promise.resolve({ok: true, json: async () => ({})})), null);
  // The not-ok probe is the quiet offline mode. The other two shapes warn.
  assert.equal(warn.mock.callCount(), 2);
});

test("loadCorpus is all-or-null when one log is unreadable, and says which", async t => {
  const warn = t.mock.method(console, "warn", () => {});
  const got = await S.loadCorpus(corpusFetch(LISTING, {}));
  assert.equal(got, null);
  assert.equal(warn.mock.callCount(), 1);
  assert.match(String(warn.mock.calls[0].arguments.join(" ")), /unreadable corpus file/);
});

test("loadCorpus percent-encodes each path segment of a fetch", async () => {
  const listing = {root: "demo", files: ["T-1-a b#c/audit-log.md"]};
  const texts = {"T-1-a b#c/audit-log.md": LOG};
  const urls = [];
  const fetchFn = u => { urls.push(u); return corpusFetch(listing, texts)(u); };
  const got = await S.loadCorpus(fetchFn, {now: new Date(2026, 7, 25)});
  assert.ok(urls.includes("corpus/T-1-a%20b%23c/audit-log.md"));
  assert.equal(got.tickets.length, 1);
});

// ---- lib: the chit ----

test("projectChitText separates a missing corpus from a nameless project", () => {
  assert.equal(S.projectChitText(null), "no corpus");
  assert.equal(S.projectChitText({project: null}), "project: —");
  assert.equal(S.projectChitText({project: "demo"}), "project: demo");
});

// ---- the real markup ----

test("mission-control.html carries the frame the harness models", () => {
  assert.match(HTML, /<link rel="stylesheet" href="adp-theme\.css" \/>/);
  assert.match(HTML, /<link rel="stylesheet" href="adp-shell\.css" \/>/);
  assert.match(HTML, /<button [^>]*id="themeBtn"/);
  assert.match(HTML, /<nav [^>]*role="tablist"/);
  const srcs = [...HTML.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(srcs,
    ["adp-parser-lib.js", "adp-index-lib.js", "adp-index-builder-lib.js", "adp-shell-lib.js"]);
  const screens = [...HTML.matchAll(/<section class="screen" data-s="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(screens, S.SCREENS);
  for (const id of ["projChit", "themeBtn", "ttIcon", "tabs", "newTaskBtn", "rail", "foot", "shellmask"]) {
    assert.match(HTML, new RegExp('id="' + id + '"'));
  }
});

// ---- the page: theme boot ----

test("the pre-paint ladder honors a stored preference", () => {
  const h = bootShell({stored: "light"});
  assert.equal(h.documentElement.getAttribute("data-theme"), "light");
  assert.equal(h.$("#ttIcon").textContent, "☀");
});

test("the pre-paint ladder falls back to the system preference", () => {
  const h = bootShell({matchMediaLight: true});
  assert.equal(h.documentElement.getAttribute("data-theme"), "light");
});

test("the pre-paint ladder lands on dark when storage is blocked", () => {
  const h = bootShell({storageThrows: true});
  assert.equal(h.documentElement.getAttribute("data-theme"), "dark");
});

// ---- the page: boot render ----

test("the boot paints the no-corpus chrome synchronously", () => {
  const h = bootShell({stored: "dark"});
  const tabs = h.document.querySelectorAll(".mtab");
  assert.deepEqual(tabs.map(t => t.getAttribute("data-s")), S.TAB_SCREENS);
  assert.equal(tabs[0].classList.contains("is-on"), true);
  assert.equal(tabs[0].getAttribute("aria-selected"), "true");
  assert.equal(tabs[1].getAttribute("aria-selected"), "false");
  assert.equal(h.$("#scrInspector").classList.contains("is-on"), true);
  assert.equal(h.$("#scrWatch").classList.contains("is-on"), false);
  assert.equal(h.$("#projChit").textContent, "no corpus");
  assert.match(h.$("#foot").textContent, /^no corpus/);
  assert.equal(h.$("#ttIcon").textContent, "☾");
});

// ---- the page: switching ----

test("a tab click lands even while the seam is still pending", async () => {
  const h = bootShell({stored: "dark", fetch: () => new Promise(() => {})});
  h.click(h.document.querySelectorAll(".mtab")[1]);
  assert.equal(h.$("#scrWatch").classList.contains("is-on"), true);
  assert.equal(h.$("#scrInspector").classList.contains("is-on"), false);
  assert.equal(h.document.querySelectorAll(".mtab")[1].classList.contains("is-on"), true);
});

test("a tab switch keeps the same buttons, so focus survives the render", () => {
  const h = bootShell({stored: "dark"});
  const before = h.document.querySelectorAll(".mtab");
  h.click(before[1]);
  const after = h.document.querySelectorAll(".mtab");
  assert.equal(after.length, before.length);
  before.forEach((tab, i) => assert.equal(after[i], tab));
  assert.equal(before[1].getAttribute("aria-selected"), "true");
  assert.equal(before[0].getAttribute("aria-selected"), "false");
});

test("new task lights the accent button and clears the tab strip", () => {
  const h = bootShell({stored: "dark"});
  h.click(h.$("#newTaskBtn"));
  assert.equal(h.$("#newTaskBtn").classList.contains("is-on"), true);
  assert.equal(h.$("#scrNew").classList.contains("is-on"), true);
  assert.equal(h.document.querySelectorAll(".mtab").some(t => t.classList.contains("is-on")), false);
});

// ---- the page: theme toggle ----

test("the theme toggle flips the attribute, the icon, and the stored key", () => {
  const h = bootShell({stored: "dark"});
  h.click(h.$("#themeBtn"));
  assert.equal(h.documentElement.getAttribute("data-theme"), "light");
  assert.equal(h.$("#ttIcon").textContent, "☀");
  assert.equal(h.storage.get("adp-theme"), "light");
});

// ---- the page: the seam ----

test("a served corpus fills the chit and the footer counts in", async () => {
  const h = bootShell({stored: "dark", fetch: corpusFetch(LISTING, TEXTS)});
  await h.settle();
  assert.equal(h.$("#projChit").textContent, "project: demo");
  assert.match(h.$("#foot").textContent, /2 tickets/);
});

test("a dead network leaves the no-corpus chrome standing, with a console trace", async () => {
  const h = bootShell({stored: "dark"});
  await h.settle();
  assert.equal(h.$("#projChit").textContent, "no corpus");
  assert.match(h.$("#foot").textContent, /^no corpus/);
  assert.equal(h.warns.length, 1);
  assert.match(h.warns[0], /corpus load failed/);
});
