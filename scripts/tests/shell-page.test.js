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

/* One full ticket and one prompt-only ticket. The full ticket carries every
   inspector surface: a spine with two statuses, a non-canonical section, a
   citing PR Summary, and watches both anchored and unanchored. */
const LOG = [
  "# Audit Log — AA1 alpha",
  "",
  "## Problem Statement",
  "",
  "**What the problem is:** demo.",
  "",
  "## Decision Log",
  "",
  "### [DL-001] First decision",
  "- **Decision:** pick a",
  "- **Confidence:** HIGH",
  "- **Status:** VALIDATED",
  "",
  "### [DL-002] Second decision",
  "- **Decision:** pick b",
  "- **Confidence:** LOW",
  "- **Status:** OPEN — rides",
  "",
  "## Aside Notes",
  "",
  "Some **prose** citing DL-002.",
  "",
  "## PR Summary",
  "",
  "Cites DL-001 and OT-AA1-2.",
  "",
  "## Obligation Ticket List",
  "",
  "| Ticket ID | Decision Log ref | Assumption to validate | Priority | Exit condition | Observation window |",
  "|---|---|---|---|---|---|",
  "| OT-AA1-1 | DL-002 | it holds | HIGH | done → VALIDATED | until 2099-01-01 |",
  "| OT-AA1-2 | DL-001 | other | LOW | done → VALIDATED | 60 days after merge |",
  ""
].join("\n");
const LISTING = {
  root: "demo",
  files: ["20260101-AA1-alpha/audit-log.md", "20260101-AA1-alpha/prompt.yaml", "AV-002-beta/prompt.yaml"]
};
const TEXTS = {"20260101-AA1-alpha/audit-log.md": LOG};
const NOW = new Date(2026, 7, 25, 12, 0, 0);

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

const bootCorpus = opts => bootShell(Object.assign({stored: "dark", fetch: corpusFetch(LISTING, TEXTS)}, opts));
const pick = (h, key) => h.click(h.$$(".rentry").find(r => r.getAttribute("data-key") === key));

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

test("loadCorpus builds the same bytes as a direct Node build and rides the texts along", async () => {
  const got = await S.loadCorpus(corpusFetch(LISTING, TEXTS), {now: NOW});
  const want = B.buildIndex(
    LISTING.files.map(p => (p in TEXTS ? {path: p, text: TEXTS[p]} : {path: p})),
    {project: "demo", generated: "2026-08-25", source: "working-tree"}
  );
  assert.equal(I.serializeIndex(got.index), I.serializeIndex(want));
  assert.deepEqual(I.validateIndex(got.index), []);
  assert.equal(got.index.source, "working-tree");
  assert.deepEqual(got.texts, {"20260101-AA1-alpha": LOG});
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
  const got = await S.loadCorpus(fetchFn, {now: NOW});
  assert.ok(urls.includes("corpus/T-1-a%20b%23c/audit-log.md"));
  assert.equal(got.index.tickets.length, 1);
});

// ---- lib: the chit ----

test("projectChitText separates a missing corpus from a nameless project", () => {
  assert.equal(S.projectChitText(null), "no corpus");
  assert.equal(S.projectChitText({project: null}), "project: —");
  assert.equal(S.projectChitText({project: "demo"}), "project: demo");
});

// ---- lib: the hash grammar ----

test("hashRead and hashWrite round-trip the t/s/item selection", () => {
  const sel = {t: "AA1", s: "sec-decision-log", item: "DL-002"};
  assert.equal(S.hashWrite(sel), "#t=AA1&s=sec-decision-log&item=DL-002");
  assert.deepEqual(S.hashRead(S.hashWrite(sel)), sel);
  assert.deepEqual(S.hashRead("#t=AA1"), {t: "AA1", s: null, item: null});
  assert.deepEqual(S.hashRead(""), {t: null, s: null, item: null});
  assert.equal(S.hashWrite({t: null}), "");
  // Reserved characters survive the trip encoded.
  const odd = {t: "a&b", s: "sec-x=y", item: null};
  assert.deepEqual(S.hashRead(S.hashWrite(odd)), odd);
});

// ---- lib: builders escape what they interpolate ----

test("rail and panel builders escape hostile harvested fields", () => {
  const hostile = `<img src=x onerror=alert(1)>`;
  const rail = S.railHtml([["needs attention", [{key: hostile, id: hostile, date: hostile,
    slug: hostile, closable: true, ribbon: {reasons: [{txt: hostile, tone: "warn"}], more: 0}}]]],
    null, new Set());
  assert.ok(!rail.includes("<img"));
  const panel = S.decisionsPanelHtml({label: hostile, pills: "", sort: {k: "id", d: 1},
    rows: [{id: hostile, title: hostile, conf: hostile, confKind: "other",
      statusKind: "open", watch: hostile, chips: [{key: hostile, label: hostile, title: hostile}], hl: false}]});
  assert.ok(!panel.includes("<img"));
  const nav = S.secNavHtml([{key: "k", title: hostile, phase: null, canonical: false, missing: false}],
    {k: {label: "non-canonical", tone: "warn"}}, "k");
  assert.ok(!nav.includes("<img"));
});

// ---- the real markup ----

test("mission-control.html carries the frame the harness models", () => {
  assert.match(HTML, /<link rel="stylesheet" href="adp-theme\.css" \/>/);
  assert.match(HTML, /<link rel="stylesheet" href="adp-shell\.css" \/>/);
  assert.match(HTML, /<button [^>]*id="themeBtn"/);
  assert.match(HTML, /<nav [^>]*role="tablist"/);
  assert.match(HTML, /<input type="file" id="openDoc"[^>]* multiple/);
  const srcs = [...HTML.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(srcs,
    ["adp-parser-lib.js", "adp-index-lib.js", "adp-index-builder-lib.js",
     "adp-derive-lib.js", "adp-shell-lib.js"]);
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
  const tabs = h.$$(".mtab");
  assert.deepEqual(tabs.map(t => t.getAttribute("data-s")), S.TAB_SCREENS);
  assert.equal(tabs[0].classList.contains("is-on"), true);
  assert.equal(tabs[0].getAttribute("aria-selected"), "true");
  assert.equal(h.$("#scrInspector").classList.contains("is-on"), true);
  assert.equal(h.$("#projChit").textContent, "no corpus");
  assert.match(h.$("#foot").textContent, /^no corpus/);
});

// ---- the page: switching ----

test("a tab click lands even while the seam is still pending", async () => {
  const h = bootShell({stored: "dark", fetch: () => new Promise(() => {})});
  h.click(h.$$(".mtab")[1]);
  assert.equal(h.$("#scrWatch").classList.contains("is-on"), true);
  assert.equal(h.$("#scrInspector").classList.contains("is-on"), false);
});

test("a tab switch keeps the same buttons, so focus survives the render", () => {
  const h = bootShell({stored: "dark"});
  const before = h.$$(".mtab");
  h.click(before[1]);
  const after = h.$$(".mtab");
  assert.equal(after.length, before.length);
  before.forEach((tab, i) => assert.equal(after[i], tab));
  assert.equal(before[1].getAttribute("aria-selected"), "true");
});

test("new task lights the accent button and clears the tab strip", () => {
  const h = bootShell({stored: "dark"});
  h.click(h.$("#newTaskBtn"));
  assert.equal(h.$("#newTaskBtn").classList.contains("is-on"), true);
  assert.equal(h.$("#scrNew").classList.contains("is-on"), true);
  assert.equal(h.$$(".mtab").some(t => t.classList.contains("is-on")), false);
});

// ---- the page: theme toggle ----

test("the theme toggle flips the attribute, the icon, and the stored key", () => {
  const h = bootShell({stored: "dark"});
  h.click(h.$("#themeBtn"));
  assert.equal(h.documentElement.getAttribute("data-theme"), "light");
  assert.equal(h.storage.get("adp-theme"), "light");
});

// ---- the page: the seam ----

test("a served corpus fills the chit, the footer, and the rail", async () => {
  const h = bootCorpus();
  await h.settle();
  assert.equal(h.$("#projChit").textContent, "project: demo");
  assert.match(h.$("#foot").textContent, /2 tickets/);
  const rail = h.$("#rail").innerHTML;
  assert.match(rail, /needs attention/);
  assert.match(rail, /in progress/);
  assert.match(rail, /WATCH UNANCHORED/);
  assert.match(rail, /AA1/);
});

test("a dead network leaves the no-corpus chrome standing, with a console trace", async () => {
  const h = bootShell({stored: "dark"});
  await h.settle();
  assert.equal(h.$("#projChit").textContent, "no corpus");
  assert.equal(h.warns.length, 1);
  assert.match(h.warns[0], /corpus load failed/);
  assert.match(h.$("#scrInspector").innerHTML, /open, paste, or drop audit logs/);
});

// ---- the inspector: R4 ----

test("the corpus boot selects the first rail entry; a full ticket renders its spine", async () => {
  const h = bootCorpus();
  await h.settle();
  // AA1 (shipped with missing sections) is actionable attention; AV002 is a
  // prompt-only ticket still in flight, so it sits in progress with its
  // missing-sections ribbon intact.
  const rail = h.$("#rail").innerHTML;
  assert.match(rail, /in progress[\s\S]*AV002/);
  assert.match(rail, /9 SECTIONS MISSING/);
  const scr = h.$("#scrInspector").innerHTML;
  // The section body went through adp-parser-lib's Decision Log renderer.
  assert.match(scr, /dl-card/);
  assert.match(scr, /DL-001/);
  // The nav lists 5 real sections plus 5 missing canonicals.
  assert.equal((h.$("#secSel").innerHTML.match(/<option/g) || []).length, 10);
  assert.equal(h.$("#secSel").value, "sec-decision-log");
  // The head chit reads the inferred lifecycle.
  assert.match(scr, /shipped · inferred/);
  // Decisions panel with both entries and their pills.
  assert.match(scr, /decisions cited by Decision Log/);
  assert.match(scr, /open 1/);
  assert.match(scr, /validated 1/);
  assert.equal(h.hashes[h.hashes.length - 1], "#t=AA1&s=sec-decision-log");
});

test("section navigation steps, drops, and marks section states", async () => {
  const h = bootCorpus();
  await h.settle();
  pick(h, "AA1");
  // Dropdown carries state suffixes for non-complete sections.
  const sel = h.$("#secSel");
  assert.match(sel.innerHTML, /Aside Notes — non-canonical/);
  assert.match(sel.innerHTML, /Knowledge Gap — missing/);
  assert.match(sel.innerHTML, /Obligation Ticket List — unanchored watches/);
  // next from the spine lands on the non-canonical section.
  const next = h.$$(".op").find(o => o.getAttribute("data-secstep") === "1");
  h.click(next);
  assert.equal(h.$("#secSel").value, "sec-aside-notes");
  assert.match(h.$("#scrInspector").innerHTML, /non-canonical/);
  // The dropdown reaches any section directly.
  h.change(h.$("#secSel"), "sec-pr-summary");
  assert.equal(h.hashes[h.hashes.length - 1], "#t=AA1&s=sec-pr-summary");
});

test("a phase-scoped section shows only what it cites, with backlink chips", async () => {
  const h = bootCorpus();
  await h.settle();
  pick(h, "AA1");
  h.change(h.$("#secSel"), "sec-pr-summary");
  const scr = h.$("#scrInspector").innerHTML;
  // PR Summary cites DL-001 and OT-AA1-2, nothing else.
  assert.match(scr, /decisions cited by PR Summary/);
  assert.ok(scr.includes("DL-001"));
  assert.ok(!scr.includes(`data-dl="DL-002"`));
  assert.match(scr, /watches cited by PR Summary/);
  assert.ok(scr.includes("OT-AA1-2"));
  assert.ok(!scr.includes(`data-item="OT-AA1-1"`));
  // Chips point back at the owner and the citing section.
  assert.match(scr, /class="pc"/);
});

test("a decision row opens its card and the back link returns", async () => {
  const h = bootCorpus();
  await h.settle();
  pick(h, "AA1");
  const row = h.$$(".dlrow").find(r => r.getAttribute("data-dl") === "DL-002");
  h.click(row);
  let scr = h.$("#scrInspector").innerHTML;
  assert.match(scr, /\[DL-002\]/);
  assert.match(scr, /back to Decision Log/);
  // The link scrolls the reader back to the nav and the content it changed.
  assert.equal(h.$(".secnav")._scrolled, 1);
  assert.equal(h.hashes[h.hashes.length - 1], "#t=AA1&s=sec-decision-log&item=DL-002");
  h.click(h.$(".backlink"));
  scr = h.$("#scrInspector").innerHTML;
  assert.ok(!scr.includes("backlink"));
  assert.equal(h.hashes[h.hashes.length - 1], "#t=AA1&s=sec-decision-log");
});

test("a watch link jumps to the obligation section with the row highlighted", async () => {
  const h = bootCorpus();
  await h.settle();
  pick(h, "AA1");
  const wl = h.$$(".wl").find(w => w.getAttribute("data-item") === "OT-AA1-1");
  h.click(wl);
  const scr = h.$("#scrInspector").innerHTML;
  assert.equal(h.$("#secSel").value, "sec-obligation-ticket-list");
  assert.match(scr, /is-hl/);
  assert.equal(h.$(".secnav")._scrolled, 1);
  assert.match(scr, /UNANCHORED/);
  assert.equal(h.hashes[h.hashes.length - 1], "#t=AA1&s=sec-obligation-ticket-list&item=OT-AA1-1");
});

test("the status pills filter the decisions table", async () => {
  const h = bootCorpus();
  await h.settle();
  pick(h, "AA1");
  const pill = h.$$(".fpill").find(p => p.getAttribute("data-dlf") === "open");
  h.click(pill);
  const scr = h.$("#scrInspector").innerHTML;
  assert.ok(scr.includes(`data-dl="DL-002"`));
  assert.ok(!scr.includes(`data-dl="DL-001"`));
});

// ---- focus across rebuilds ----

test("a filter pill keeps the keyboard through its own re-render", async () => {
  const h = bootCorpus();
  await h.settle();
  pick(h, "AA1");
  const pill = h.$$(".fpill").find(p => p.getAttribute("data-dlf") === "open");
  pill.focus();
  h.click(pill);
  // The click rebuilt the panel, so the focused element must be the fresh
  // twin — same mark, attached to the page — not the detached original.
  const now = h.document.activeElement;
  assert.notEqual(now, pill);
  assert.equal(now.getAttribute("data-dlf"), "open");
  assert.ok(h.$$(".fpill").includes(now));
});

test("the section dropdown keeps focus across its change re-render", async () => {
  const h = bootCorpus();
  await h.settle();
  pick(h, "AA1");
  h.$("#secSel").focus();
  h.change(h.$("#secSel"), "sec-pr-summary");
  assert.equal(h.document.activeElement, h.$("#secSel"));
});

test("a rail selection keeps the keyboard on the rebuilt entry", async () => {
  const h = bootCorpus();
  await h.settle();
  const entry = h.$$(".rentry").find(r => r.getAttribute("data-key") === "AA1");
  entry.focus();
  h.click(entry);
  const now = h.document.activeElement;
  assert.notEqual(now, entry);
  assert.equal(now.getAttribute("data-key"), "AA1");
  assert.ok(now.classList.contains("is-sel"));
});

test("a header click sorts the decisions table and flips on repeat", async () => {
  const h = bootCorpus();
  await h.settle();
  pick(h, "AA1");
  const conf = h.$$(".sth").find(t => t.getAttribute("data-k") === "conf");
  h.click(conf);
  let rows = h.$$(".dlrow").map(r => r.getAttribute("data-dl"));
  assert.deepEqual(rows, ["DL-002", "DL-001"]);
  h.click(h.$$(".sth").find(t => t.getAttribute("data-k") === "conf"));
  rows = h.$$(".dlrow").map(r => r.getAttribute("data-dl"));
  assert.deepEqual(rows, ["DL-001", "DL-002"]);
});

test("the full-log view renders every real section as a collapsible", async () => {
  const h = bootCorpus();
  await h.settle();
  pick(h, "AA1");
  const full = h.$$(".op").find(o => o.getAttribute("data-view") === "full");
  h.click(full);
  const secs = h.$$(".fsec");
  assert.equal(secs.length, 5);
  assert.ok(secs.every(s => s.open));
  const close = h.$$(".op").find(o => o.getAttribute("data-exp") === "close");
  h.click(close);
  assert.ok(h.$$(".fsec").every(s => s.open === false));
});

test("the rail collapses a group and a ticket click selects it", async () => {
  const h = bootCorpus();
  await h.settle();
  // Collapsing needs attention hides AA1; AV002 stays visible in progress.
  const sec = h.$$(".railsec").find(s => s.getAttribute("data-sec") === "needs attention");
  h.click(sec);
  assert.equal(h.$$(".rentry").length, 1);
  h.click(h.$$(".railsec").find(s => s.getAttribute("data-sec") === "needs attention"));
  assert.equal(h.$$(".rentry").length, 2);
  pick(h, "AV002");
  assert.match(h.$("#scrInspector").innerHTML, /no audit log yet/);
});

test("the permalink control copies the current address", async () => {
  const h = bootCorpus();
  await h.settle();
  pick(h, "AA1");
  h.click(h.$(".lnk"));
  assert.equal(h.clipboard.length, 1);
  assert.match(h.clipboard[0], /#t=AA1&s=sec-decision-log$/);
});

// ---- deep links: R7 ----

test("a hash set before boot lands the named view with the item highlighted", async () => {
  const h = bootCorpus({hash: "#t=AA1&s=sec-pr-summary&item=DL-001"});
  await h.settle();
  const scr = h.$("#scrInspector").innerHTML;
  assert.equal(h.$("#secSel").value, "sec-pr-summary");
  assert.match(scr, /\[DL-001\]/);
  assert.match(scr, /is-hl/);
});

test("an item-only link lands on the item's owning section", async () => {
  const h = bootCorpus({hash: "#t=AA1&item=OT-AA1-2"});
  await h.settle();
  assert.equal(h.$("#secSel").value, "sec-obligation-ticket-list");
  assert.match(h.$("#scrInspector").innerHTML, /is-hl/);
});

test("a link to a vanished section falls back with a visible notice", async () => {
  const h = bootCorpus({hash: "#t=AA1&s=sec-retitled-away"});
  await h.settle();
  const scr = h.$("#scrInspector").innerHTML;
  assert.match(scr, /was not found in this log/);
  assert.equal(h.$("#secSel").value, "sec-decision-log");
});

test("a link to an absent ticket shows a notice instead of a silent default", async () => {
  const h = bootCorpus({hash: "#t=ZZZ"});
  await h.settle();
  assert.match(h.$("#scrInspector").innerHTML, /"ZZZ" is not in this corpus/);
});

// ---- opened documents ----

test("paste opens the drawer and imports the text as an unindexed document", async () => {
  const h = bootCorpus();
  await h.settle();
  h.click(h.$$(".op").find(o => o.getAttribute("data-op") === "paste"));
  const area = h.$("#pasteArea");
  assert.ok(area);
  area.value = LOG;
  h.click(h.$("#pasteImport"));
  await h.settle();
  const rail = h.$("#rail").innerHTML;
  assert.match(rail, /opened documents/);
  assert.match(rail, /OPENED · UNINDEXED/);
  const scr = h.$("#scrInspector").innerHTML;
  assert.match(scr, /unindexed/);
  assert.match(scr, /dl-card/);
});

test("a document with no sections renders raw, flagged", async () => {
  const h = bootCorpus();
  await h.settle();
  h.click(h.$$(".op").find(o => o.getAttribute("data-op") === "paste"));
  h.$("#pasteArea").value = "just a note, no headings";
  h.click(h.$("#pasteImport"));
  await h.settle();
  const scr = h.$("#scrInspector").innerHTML;
  assert.match(scr, /no sections found — shown raw/);
  assert.match(scr, /just a note, no headings/);
});

test("the file input opens several documents at once", async () => {
  const h = bootCorpus();
  await h.settle();
  const input = h.$("#openDoc");
  input.files = [{name: "a.md", __text: LOG}, {name: "b.md", __text: "## Problem Statement\n\nx\n"}];
  h.change(input);
  await h.settle();
  const rail = h.$("#rail").innerHTML;
  assert.match(rail, /a\.md/);
  assert.match(rail, /b\.md/);
  assert.equal((rail.match(/OPENED · UNINDEXED/g) || []).length, 2);
});

test("a drop without filesystem handles opens one-shot documents", async () => {
  const h = bootCorpus();
  await h.settle();
  h.fireWindow("drop", {dataTransfer: {files: [{name: "dropped.md", __text: LOG}]}});
  await h.settle();
  assert.match(h.$("#rail").innerHTML, /dropped\.md/);
});

test("the drop mask follows dragenter and dragleave", async () => {
  const h = bootCorpus();
  await h.settle();
  h.fireWindow("dragenter", {});
  assert.equal(h.$("#shellmask").classList.contains("is-on"), true);
  h.fireWindow("dragleave", {});
  assert.equal(h.$("#shellmask").classList.contains("is-on"), false);
});

test("closing an opened document removes it and clears its selection", async () => {
  const h = bootCorpus();
  await h.settle();
  h.click(h.$$(".op").find(o => o.getAttribute("data-op") === "paste"));
  h.$("#pasteArea").value = LOG;
  h.click(h.$("#pasteImport"));
  await h.settle();
  h.click(h.$(".rclose"));
  await h.settle();
  const rail = h.$("#rail").innerHTML;
  assert.ok(!rail.includes("opened documents"));
  assert.match(h.$("#scrInspector").innerHTML, /select a ticket/);
});

// ---- open and watch ----

function makeHandle(name, text){
  const handle = {
    kind: "file",
    _text: text,
    _perm: "granted",
    queryPermission: async () => handle._perm,
    requestPermission: async () => handle._perm,
    getFile: async () => ({name, text: async () => handle._text})
  };
  return handle;
}

test("the picker path watches files and the poll re-renders on a real change", async () => {
  const handle = makeHandle("w.md", LOG);
  const h = bootCorpus({picker: async () => [handle]});
  await h.settle();
  h.click(h.$$(".op").find(o => o.getAttribute("data-op") === "openwatch"));
  await h.settle();
  assert.match(h.$("#rail").innerHTML, /WATCHING FILE · UNINDEXED/);
  assert.match(h.$("#scrInspector").innerHTML, /watching · live/);
  // A quiet poll leaves the render alone; a changed file re-harvests.
  handle._text = LOG + "\n## Amendment Notes\n\nlate news.\n";
  h.tick();
  await h.settle();
  assert.match(h.$("#secSel").innerHTML, /Amendment Notes/);
});

test("a poll re-render keeps a paste draft in composition", async () => {
  const handle = makeHandle("w.md", LOG);
  const h = bootCorpus({picker: async () => [handle]});
  await h.settle();
  h.click(h.$$(".op").find(o => o.getAttribute("data-op") === "openwatch"));
  await h.settle();
  h.click(h.$$(".op").find(o => o.getAttribute("data-op") === "paste"));
  h.$("#pasteArea").value = "half-typed amendment";
  h.$("#pasteArea").focus();
  // The watched file changes under the open drawer. The rebuild must land —
  // the new section proves it did — with the draft still in the textarea
  // and the keyboard still in the field.
  handle._text = LOG + "\n## Amendment Notes\n\nlate news.\n";
  h.tick();
  await h.settle();
  assert.match(h.$("#secSel").innerHTML, /Amendment Notes/);
  assert.equal(h.$("#pasteArea").value, "half-typed amendment");
  assert.equal(h.document.activeElement, h.$("#pasteArea"));
});

test("a lapsed permission flips the watch to its cached state", async () => {
  const handle = makeHandle("w.md", LOG);
  const h = bootCorpus({picker: async () => [handle]});
  await h.settle();
  h.click(h.$$(".op").find(o => o.getAttribute("data-op") === "openwatch"));
  await h.settle();
  handle._perm = "denied";
  h.tick();
  await h.settle();
  assert.match(h.$("#rail").innerHTML, /OPENED · UNINDEXED/);
  assert.match(h.$("#scrInspector").innerHTML, /cached · reload to resume/);
  assert.ok(h.warns.some(w => /watch stopped/.test(w)));
  // The reload gesture re-requests permission and resumes the watch.
  handle._perm = "granted";
  h.click(h.$$(".op").find(o => o.getAttribute("data-op") === "reload"));
  await h.settle();
  assert.match(h.$("#scrInspector").innerHTML, /watching · live/);
});

// ---- hostile documents ----

test("a hostile pasted log never lands markup in the page", async () => {
  const h = bootCorpus();
  await h.settle();
  h.click(h.$$(".op").find(o => o.getAttribute("data-op") === "paste"));
  h.$("#pasteArea").value = [
    "## <img src=x onerror=alert(1)> Evil Section",
    "",
    "<script>alert(2)</script>",
    "",
    "## Decision Log",
    "",
    "### [DL-001] <img src=y> title",
    "- **Decision:** <script>alert(3)</script>",
    '- **Confidence:** HIGH" onmouseover="alert(1)',
    "- **Status:** OPEN",
    ""
  ].join("\n");
  h.click(h.$("#pasteImport"));
  await h.settle();
  assert.ok(!h.$("#rail").innerHTML.includes("<img"));
  assert.ok(!h.$("#scrInspector").innerHTML.includes("<img"));
  assert.ok(!h.$("#scrInspector").innerHTML.includes("<script"));
  // The quote-bearing confidence lands in the decisions panel as the cf-high
  // class and inert cell text. The payload stays visible as content — esc
  // leaves quotes alone there — so the pin is that no tag ever carries the
  // handler, in the panel or anywhere else the harvest reaches.
  h.change(h.$("#secSel"), "sec-decision-log");
  const html = h.$("#scrInspector").innerHTML;
  assert.match(html, /class="cf-high"/);
  assert.ok(!/<[^>]*onmouseover/.test(html));
  assert.ok(!/<[^>]*onmouseover/.test(h.$("#rail").innerHTML));
});

test("an entry housed outside the spine still opens as a card", async () => {
  const h = bootCorpus();
  await h.settle();
  h.click(h.$$(".op").find(o => o.getAttribute("data-op") === "paste"));
  h.$("#pasteArea").value = [
    "## Decision Log",
    "",
    "(entries arrive in review responses)",
    "",
    "## Review Response — PR #1",
    "",
    "### [DL-009] Late ruling",
    "- **Decision:** re-cut",
    "- **Status:** OPEN",
    ""
  ].join("\n");
  h.click(h.$("#pasteImport"));
  await h.settle();
  const row = h.$$(".dlrow").find(r => r.getAttribute("data-dl") === "DL-009");
  h.click(row);
  const scr = h.$("#scrInspector").innerHTML;
  assert.match(scr, /\[DL-009\]/);
  assert.match(scr, /dl-card|dl-grid/);
  assert.ok(!scr.includes("not present in the loaded text"));
});

test("in the full log, the section selector jumps to the section and opens it", async () => {
  const h = bootCorpus();
  await h.settle();
  pick(h, "AA1");
  h.click(h.$$(".op").find(o => o.getAttribute("data-view") === "full"));
  h.click(h.$$(".op").find(o => o.getAttribute("data-exp") === "close"));
  assert.ok(h.$$(".fsec").every(s => s.open === false));
  h.change(h.$("#secSel"), "sec-pr-summary");
  const secs = h.$$(".fsec");
  const target = secs.find(s => s.getAttribute("data-key") === "sec-pr-summary");
  assert.equal(target.open, true);
  assert.equal(target._scrolled, 1);
  // The jump opens its target alone; the rest keep their collapsed state.
  assert.ok(secs.filter(s => s !== target).every(s => s.open === false));
  assert.equal(h.hashes[h.hashes.length - 1], "#t=AA1&s=sec-pr-summary");
});

test("prev/next in the full log jump too, and manual toggles survive renders", async () => {
  const h = bootCorpus();
  await h.settle();
  pick(h, "AA1");
  h.click(h.$$(".op").find(o => o.getAttribute("data-view") === "full"));
  // A summary click collapses just that section, page-managed.
  const ps = h.$$(".fsec").find(s => s.getAttribute("data-key") === "sec-problem-statement");
  h.click(ps.children.find(c => c.classList.contains("fsum")));
  assert.equal(ps.open, false);
  // Stepping from the spine to the next section re-renders; the bystander's
  // manual collapse holds and the step target opens and scrolls into view.
  h.click(h.$$(".op").find(o => o.getAttribute("data-secstep") === "1"));
  const after = h.$$(".fsec");
  assert.equal(h.$("#secSel").value, "sec-aside-notes");
  assert.equal(after.find(s => s.getAttribute("data-key") === "sec-problem-statement").open, false);
  const target = after.find(s => s.getAttribute("data-key") === "sec-aside-notes");
  assert.equal(target.open, true);
  assert.equal(target._scrolled, 1);
});

test("the closed group starts collapsed, and a click opens it", async () => {
  const h = bootCorpus();
  await h.settle();
  const closed = h.$$(".railsec").find(s => s.getAttribute("data-sec") === "closed");
  assert.match(closed.innerHTML, /▸/);
  h.click(closed);
  const after = h.$$(".railsec").find(s => s.getAttribute("data-sec") === "closed");
  assert.match(after.innerHTML, /▾/);
});
