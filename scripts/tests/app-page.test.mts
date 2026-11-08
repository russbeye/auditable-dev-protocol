// @vitest-environment jsdom
/* The React app's page tests. The first two hold the shell, the rail, the
   board, and the footer to the R8 baseline the vanilla page recorded over
   the fixture corpus. The rest carry the vanilla page tests for the same
   regions over, assertion for assertion, against the app. */
import {afterEach, test, vi} from "vitest";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import fs from "node:fs";
import path from "node:path";
import {createElement} from "react";
import {act, cleanup, fireEvent, render} from "@testing-library/react";
import {App} from "../../src/app/App.tsx";
import type {EventFeed} from "../../src/app/live.ts";
import type {FetchFn, FetchResponse} from "../../src/lib/adp-shell-lib.ts";

const require = createRequire(import.meta.url);
type Region = {text: string[]; attrs: string[]};
type Snapshot = {screen: string | null; header: Region; rail: Region; main: Region | null; footer: Region};
const {diskFetch, snapshot, NOW: BASELINE_NOW} = require("./screen-text.js") as
  {diskFetch(): FetchFn; snapshot(d: Document): Snapshot; NOW: number};
const {readFixture} = require("./helpers.js") as {readFixture(name: string): string};
const BASELINE = JSON.parse(readFixture("screen-baseline.json")) as Record<string, Snapshot>;

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  history.replaceState(null, "", "/");
});

/* The server's event stream, driven by hand. The app sets the handlers, and
   a test fires them the way the browser would. */
class FakeFeed {
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  close(){ this.closed = true; }
}

const ok = (body: unknown): Promise<FetchResponse> =>
  Promise.resolve({ok: true, json: async () => body, text: async () => body as string});
const miss = (): Promise<FetchResponse> => Promise.resolve({ok: false} as FetchResponse);

/* A served corpus the test can edit or take down between loads. It counts
   the listings, so a test can tell how many loads ran. */
function liveCorpus(listing: {root: string; files: string[]}, texts: Record<string, string>){
  const live = {down: false, listings: 0, hold: null as Promise<void> | null, listing, texts,
    fetch: (async (u: string) => {
      if (live.down) return miss();
      if (u === "corpus.json"){
        live.listings++;
        const l = live.listing;
        if (live.hold) await live.hold;
        return ok(l);
      }
      if (u.startsWith("corpus/")){
        const p = u.slice("corpus/".length).split("/").map(decodeURIComponent).join("/");
        return p in live.texts ? ok(live.texts[p]) : miss();
      }
      return miss();
    }) as FetchFn};
  return live;
}

const settle = async (turns = 8) => {
  for (let i = 0; i < turns; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)); });
};

type BootOpts = {fetch?: FetchFn; hash?: string; now?: number};
async function boot({fetch = () => new Promise<FetchResponse>(() => {}), hash = "", now = NOW}: BootOpts = {}){
  vi.useFakeTimers({toFake: ["Date"]});
  vi.setSystemTime(now);
  history.replaceState(null, "", "/" + hash);
  document.documentElement.setAttribute("data-theme", "dark");
  localStorage.clear();
  const hashes: string[] = [];
  const real = history.replaceState.bind(history);
  vi.spyOn(history, "replaceState").mockImplementation((d, u, url) => { hashes.push(String(url)); real(d, u, url); });
  const feed = new FakeFeed();
  const openFeed = () => feed as unknown as EventFeed;
  render(createElement(App, {fetchFn: fetch, openFeed}));
  await settle();
  return {hashes, feed};
}

const $ = (sel: string) => document.querySelector(sel) as HTMLElement;
const $$ = (sel: string) => [...document.querySelectorAll(sel)] as HTMLElement[];
const tabFor = (name: string) => $$(".mtab").find(t => t.getAttribute("data-s") === name)!;
const entry = (key: string) => $$(".rentry").find(r => r.getAttribute("data-key") === key)!;
const click = async (el: Element) => { fireEvent.click(el); await settle(1); };
const key = async (el: Element, k: string) => { fireEvent.keyDown(el, {key: k}); await settle(1); };
const wids = () => $$(".wbrow").map(r => r.getAttribute("data-wid"));
const isOn = (id: string) => $("#" + id).classList.contains("is-on");
const marked = () => $$(".rentry").filter(r => r.classList.contains("is-sel")).map(r => r.getAttribute("data-key"));
// React keeps its fiber on every element it renders. A failed equal on two
// elements makes Node compare those fiber graphs in depth before it writes
// its message, which never ends, so we compare identity and name the miss.
const same = (got: unknown, want: unknown, what: string) => assert.ok(got === want, what);

// ---- R8: the baseline ----

test("the app's header, rail, and footer show what the vanilla page showed at boot", async () => {
  await boot({fetch: diskFetch(), now: BASELINE_NOW});
  const got = snapshot(document), want = BASELINE["boot"];
  assert.equal(got.screen, want.screen);
  assert.deepEqual(got.header, want.header);
  assert.deepEqual(got.rail, want.rail);
  assert.deepEqual(got.footer, want.footer);
});

test("the app's watchboard state shows what the vanilla page showed, region for region", async () => {
  await boot({fetch: diskFetch(), now: BASELINE_NOW});
  await click(tabFor("watchboard"));
  assert.deepEqual(snapshot(document), BASELINE["watchboard"]);
});

// ---- the fixture the vanilla page tests use ----

const LOG = [
  "# Audit Log — AA1 alpha", "",
  "## Problem Statement", "", "**What the problem is:** demo.", "",
  "## Decision Log", "",
  "### [DL-001] First decision", "- **Decision:** pick a", "- **Confidence:** HIGH", "- **Status:** VALIDATED", "",
  "### [DL-002] Second decision", "- **Decision:** pick b", "- **Confidence:** LOW", "- **Status:** OPEN — rides", "",
  "## Aside Notes", "", "Some **prose** citing DL-002.", "",
  "## PR Summary", "", "Cites DL-001 and OT-AA1-2.", "",
  "## Obligation Ticket List", "",
  "| Ticket ID | Decision Log ref | Assumption to validate | Priority | Exit condition | Observation window |",
  "|---|---|---|---|---|---|",
  "| OT-AA1-1 | DL-002 | it holds | HIGH | done → VALIDATED | until 2099-01-01 |",
  "| OT-AA1-2 | DL-001 | other | LOW | done → VALIDATED | 60 days after merge |", ""
].join("\n");
const LOG_B = [
  "# Audit Log — BB2 beta", "",
  "## Problem Statement", "", "**What the problem is:** board demo.", "",
  "## Decision Log", "",
  "### [DL-001] Board decision", "- **Decision:** pick c", "- **Confidence:** HIGH", "- **Status:** OPEN — rides", "",
  "## Obligation Ticket List", "",
  "| Ticket ID | Decision Log ref | Assumption to validate | Priority | Exit condition | Observation window |",
  "|---|---|---|---|---|---|",
  "| OT-BB2-1 | DL-001 | overdue thing | HIGH | done → VALIDATED | until 2020-01-01 |",
  "| OT-BB2-2 | DL-001 | soon thing | MEDIUM | done → VALIDATED | 2026-09-01 |",
  "| OT-BB2-3 | DL-001 | settled thing | LOW | done → VALIDATED | 2026-08-01 |", "",
  "- **OT-BB2-3 CLOSED 2026-08-10 → VALIDATED.** The window ended quiet.", ""
].join("\n");
const NOW = new Date(2026, 7, 25, 12, 0, 0).getTime();
const LISTING = {root: "demo", files: ["20260101-AA1-alpha/audit-log.md", "20260102-BB2-beta/audit-log.md"]};
const TEXTS: Record<string, string> = {"20260101-AA1-alpha/audit-log.md": LOG, "20260102-BB2-beta/audit-log.md": LOG_B};
const bootBoard = (opts: BootOpts = {}) => boot({fetch: liveCorpus(LISTING, TEXTS).fetch, ...opts});

// ---- the shell ----

test("a tab click lands even while the corpus load is still pending", async () => {
  await boot();
  await click(tabFor("watchboard"));
  assert.equal(isOn("scrWatch"), true);
  assert.equal(isOn("scrInspector"), false);
});

test("a tab switch keeps the same buttons, so focus survives the render", async () => {
  await boot();
  const before = $$(".mtab");
  before[1].focus();
  await click(before[1]);
  const after = $$(".mtab");
  assert.equal(after.length, before.length);
  before.forEach((tab, i) => same(after[i], tab, "tab " + i + " was rebuilt"));
  assert.equal(before[1].getAttribute("aria-selected"), "true");
  same(document.activeElement, before[1], "focus left the tab it pressed");
});

test("new task lights the accent button and clears the tab strip", async () => {
  await boot();
  await click($("#newTaskBtn"));
  assert.equal($("#newTaskBtn").classList.contains("is-on"), true);
  assert.equal(isOn("scrNew"), true);
  assert.equal($$(".mtab").some(t => t.classList.contains("is-on")), false);
});

test("the theme toggle flips the attribute, the icon, and the stored key", async () => {
  await boot();
  assert.equal($("#ttIcon").textContent, "☾");
  await click($("#themeBtn"));
  assert.equal(document.documentElement.getAttribute("data-theme"), "light");
  assert.equal(localStorage.getItem("adp-theme"), "light");
  assert.equal($("#ttIcon").textContent, "☀");
});

/* The pre-paint script in app.html sets the theme before React loads, so
   the first paint never flashes the wrong theme. We run that inline script
   itself against a stub storage, media query, and root element. */
const PRE_PAINT = fs.readFileSync(path.join(import.meta.dirname, "..", "app.html"), "utf8")
  .match(/<script>\n([\s\S]*?)<\/script>/)![1];
function prePaint({stored = null as string | null, light = false, throws = false} = {}){
  const attrs: Record<string, string> = {};
  const storage = {getItem: (k: string) => { if (throws) throw new Error("blocked"); return k === "adp-theme" ? stored : null; }};
  const win = {matchMedia: (q: string) => ({matches: light && q === "(prefers-color-scheme: light)"})};
  const doc = {documentElement: {setAttribute: (k: string, v: string) => { attrs[k] = v; }}};
  new Function("window", "localStorage", "document", PRE_PAINT)(win, storage, doc);
  return attrs["data-theme"];
}

test("the pre-paint ladder honors a stored preference", () => {
  assert.equal(prePaint({stored: "light"}), "light");
  assert.equal(prePaint({stored: "dark", light: true}), "dark");
});

test("the pre-paint ladder falls back to the system preference", () => {
  assert.equal(prePaint({light: true}), "light");
  assert.equal(prePaint({stored: "sepia"}), "dark");
});

test("the pre-paint ladder lands on dark when storage is blocked", () => {
  assert.equal(prePaint({throws: true, light: true}), "dark");
});

test("a served corpus fills the chit, the footer, and the rail", async () => {
  await bootBoard();
  assert.equal($("#projChit").textContent, "project: demo");
  assert.equal($("#liveTxt").textContent, "WATCHING");
  assert.equal($("#liveChit").className, "chit poll poll-ok");
  assert.match($("#foot").textContent!, /2 tickets/);
  const rail = $("#rail").textContent!;
  assert.match(rail, /needs attention/);
  assert.match(rail, /AA1/);
  assert.match(rail, /BB2/);
});

test("with no corpus the chrome says so, and the live chit idles", async () => {
  await boot({fetch: () => miss()});
  assert.equal($("#projChit").textContent, "no corpus");
  assert.equal($("#liveTxt").textContent, "IDLE");
  assert.match($("#foot").textContent!, /^no corpus · /);
});

// ---- the rail ----

test("the corpus boot selects the first rail entry", async () => {
  const {hashes} = await bootBoard();
  const sel = $$(".rentry").filter(r => r.classList.contains("is-sel")).map(r => r.getAttribute("data-key"));
  assert.equal(sel.length, 1);
  assert.equal(sel[0], $$(".rentry")[0].getAttribute("data-key"));
  assert.equal(hashes[hashes.length - 1], "#t=" + sel[0]);
});

test("the rail collapses a group and a ticket click selects it", async () => {
  await bootBoard();
  const sec = () => $$(".railsec").find(s => s.getAttribute("data-sec") === "needs attention")!;
  const n = $$(".rentry").length;
  const inGroup = Number(sec().querySelector(".rcount")!.textContent);
  await click(sec());
  assert.equal($$(".rentry").length, n - inGroup);
  await click(sec());
  assert.equal($$(".rentry").length, n);
  await click(tabFor("watchboard"));
  await click(entry("AA1"));
  assert.equal(entry("AA1").classList.contains("is-sel"), true);
  // A rail pick from the board opens the ticket in the inspector.
  assert.equal(isOn("scrInspector"), true);
});

test("a rail selection keeps the keyboard on its entry", async () => {
  await bootBoard();
  entry("BB2").focus();
  await click(entry("BB2"));
  same(document.activeElement, entry("BB2"), "focus left the rail entry");
});

// ---- the watchboard ----

test("the board rows live watches by default, overdue first, unanchored flagged", async () => {
  await bootBoard();
  await click(tabFor("watchboard"));
  const scr = $("#scrWatch").textContent!;
  assert.deepEqual(wids(), ["OT-BB2-1", "OT-BB2-2", "OT-AA1-1", "OT-AA1-2"]);
  assert.match(scr, /4 live · 1 settled/);
  // The closed chip starts off, so the settled row waits behind it. The
  // unanchored row shows its window prose where the dated rows show a date.
  assert.ok(!scr.includes("OT-BB2-3"));
  assert.match(scr, /60 days after merge/);
  assert.match(scr, /UNANCHORED/);
  assert.match(scr, /OVERDUE \d+D/);
});

test("the status chips reveal settled rows with their ruling and hide a live state", async () => {
  const {hashes} = await bootBoard();
  await click(tabFor("watchboard"));
  const chip = (s: string) => $$(".fpill").find(p => p.getAttribute("data-ws") === s)!;
  assert.equal(chip("closed").textContent, "closed 1");
  await click(chip("closed"));
  assert.deepEqual(wids(), ["OT-BB2-1", "OT-BB2-2", "OT-AA1-1", "OT-AA1-2", "OT-BB2-3"]);
  assert.match($("#scrWatch").textContent!, /VALIDATED 2026-08-10/);
  await click($$(".wbl").find(a => a.getAttribute("data-item") === "OT-BB2-3")!);
  assert.equal(isOn("scrInspector"), true);
  assert.equal(hashes[hashes.length - 1], "#t=BB2&item=OT-BB2-3");
  // The chips keep their state across a visit to another screen.
  await click(tabFor("watchboard"));
  await click(chip("upcoming"));
  assert.deepEqual(wids(), ["OT-BB2-1", "OT-BB2-2", "OT-AA1-2", "OT-BB2-3"]);
});

test("a board ticket link selects the ticket and opens the inspector", async () => {
  const {hashes} = await bootBoard();
  await click(tabFor("watchboard"));
  await click($$(".wbl").find(a => a.getAttribute("data-t") === "BB2" && !a.getAttribute("data-item"))!);
  assert.equal(isOn("scrInspector"), true);
  assert.equal($$(".rentry").find(r => r.classList.contains("is-sel"))!.getAttribute("data-key"), "BB2");
  assert.equal(hashes[hashes.length - 1], "#t=BB2");
});

test("a board header sorts, flips on repeat, and keeps the keyboard", async () => {
  await bootBoard();
  await click(tabFor("watchboard"));
  const tidTh = () => $$(".sth").find(t => t.getAttribute("data-t") === "wb" && t.getAttribute("data-k") === "tid")!;
  tidTh().focus();
  await click(tidTh());
  assert.deepEqual(wids(), ["OT-AA1-1", "OT-AA1-2", "OT-BB2-1", "OT-BB2-2"]);
  assert.equal((document.activeElement as HTMLElement).getAttribute("data-k"), "tid");
  await click(tidTh());
  assert.deepEqual(wids(), ["OT-BB2-1", "OT-BB2-2", "OT-AA1-1", "OT-AA1-2"]);
});

test("a header sorts from the keyboard with Enter and Space", async () => {
  await bootBoard();
  await click(tabFor("watchboard"));
  const tidTh = () => $$(".sth").find(t => t.getAttribute("data-t") === "wb" && t.getAttribute("data-k") === "tid")!;
  assert.equal(tidTh().getAttribute("tabindex"), "0");
  tidTh().focus();
  await key(tidTh(), "Enter");
  assert.deepEqual(wids(), ["OT-AA1-1", "OT-AA1-2", "OT-BB2-1", "OT-BB2-2"]);
  assert.equal((document.activeElement as HTMLElement).getAttribute("data-k"), "tid");
  await key(document.activeElement!, " ");
  assert.deepEqual(wids(), ["OT-BB2-1", "OT-BB2-2", "OT-AA1-1", "OT-AA1-2"]);
});

test("the sorted header carries aria-sort and the arrow hides from the tree", async () => {
  await bootBoard();
  await click(tabFor("watchboard"));
  const th = (k: string) => $$(".sth").find(t => t.getAttribute("data-t") === "wb" && t.getAttribute("data-k") === k)!;
  assert.ok($$(".sth").every(t => t.getAttribute("scope") === "col"));
  assert.equal(th("due").getAttribute("aria-sort"), "ascending");
  assert.equal(th("tid").getAttribute("aria-sort"), null);
  await click(th("tid"));
  assert.equal(th("tid").getAttribute("aria-sort"), "ascending");
  assert.equal(th("due").getAttribute("aria-sort"), null);
  await click(th("tid"));
  assert.equal(th("tid").getAttribute("aria-sort"), "descending");
  assert.equal($$(".arr")[0].getAttribute("aria-hidden"), "true");
});

test("the status header orders the default board and a flip really reverses it", async () => {
  await bootBoard();
  await click(tabFor("watchboard"));
  const th = () => $$(".sth").find(t => t.getAttribute("data-t") === "wb" && t.getAttribute("data-k") === "state")!;
  await click(th());
  assert.deepEqual(wids(), ["OT-BB2-1", "OT-BB2-2", "OT-AA1-1", "OT-AA1-2"]);
  await click(th());
  assert.equal(th().getAttribute("aria-sort"), "descending");
  assert.deepEqual(wids(), ["OT-AA1-2", "OT-AA1-1", "OT-BB2-2", "OT-BB2-1"]);
});

test("with no corpus the board says so instead of rendering an empty table", async () => {
  await boot({fetch: () => miss()});
  await click(tabFor("watchboard"));
  assert.match($("#scrWatch").textContent!, /no corpus behind this page/);
  assert.equal($$(".wbrow").length, 0);
});

test("a watchless corpus boards the no-watches state, never the filtered one", async () => {
  const LOG_C = ["# Audit Log — CC3 gamma", "", "## Problem Statement", "", "**What the problem is:** young corpus.", ""].join("\n");
  await boot({fetch: liveCorpus({root: "demo", files: ["20260103-CC3-gamma/audit-log.md"]},
    {"20260103-CC3-gamma/audit-log.md": LOG_C}).fetch});
  await click(tabFor("watchboard"));
  const scr = $("#scrWatch").textContent!;
  assert.match(scr, /no watches on record yet/);
  assert.ok(!scr.includes("hidden by the status filters"));
  assert.match(scr, /0 live · 0 settled/);
});

test("an all-settled corpus says the filters hide it, and the closed chip shows it", async () => {
  const LOG_D = ["# Audit Log — DD4 delta", "", "## Decision Log", "",
    "### [DL-001] Settled decision", "- **Decision:** pick d", "- **Confidence:** HIGH", "- **Status:** OPEN", "",
    "## Obligation Ticket List", "",
    "| Ticket ID | Decision Log ref | Assumption to validate | Priority | Exit condition | Observation window |",
    "|---|---|---|---|---|---|",
    "| OT-DD4-1 | DL-001 | held | HIGH | done → VALIDATED | 2026-08-01 |", "",
    "- **OT-DD4-1 CLOSED 2026-08-10 → VALIDATED.** The window ended quiet.", ""].join("\n");
  await boot({fetch: liveCorpus({root: "demo", files: ["20260104-DD4-delta/audit-log.md"]},
    {"20260104-DD4-delta/audit-log.md": LOG_D}).fetch});
  await click(tabFor("watchboard"));
  assert.match($("#scrWatch").textContent!, /every watch here is hidden by the status filters/);
  await click($$(".fpill").find(p => p.getAttribute("data-ws") === "closed")!);
  assert.deepEqual(wids(), ["OT-DD4-1"]);
});

test("the board marks an anchored watch's due text as dated and an unanchored one as prose", async () => {
  await bootBoard();
  await click(tabFor("watchboard"));
  const cell = (text: string) => $$("#scrWatch td").find(td => td.textContent === text)!;
  assert.equal(cell("2099-01-01").className, "mono nw");
  assert.equal(cell("60 days after merge").className, "mono");
});

test("board links carry real hash hrefs, so the keyboard can reach them", async () => {
  await bootBoard();
  await click(tabFor("watchboard"));
  const w = $$(".wbl").find(a => a.getAttribute("data-item") === "OT-BB2-1")!;
  assert.equal(w.getAttribute("href"), "#t=BB2&item=OT-BB2-1");
  const t = $$(".wbl").find(a => a.getAttribute("data-t") === "BB2" && !a.getAttribute("data-item"))!;
  assert.equal(t.getAttribute("href"), "#t=BB2");
});

// ---- deep links ----

test("a view token in the hash lands the named screen on boot", async () => {
  await bootBoard({hash: "#v=watchboard"});
  assert.equal(isOn("scrWatch"), true);
  assert.ok($$(".wbrow").length);
});

test("a token naming no real screen is ignored", async () => {
  await bootBoard({hash: "#v=bogus&t=AA1"});
  assert.equal(isOn("scrInspector"), true);
  assert.equal(entry("AA1").classList.contains("is-sel"), true);
});

test("a tab switch writes its view token; the inspector clears it", async () => {
  const {hashes} = await bootBoard();
  await click(tabFor("watchboard"));
  assert.match(hashes[hashes.length - 1], /^#v=watchboard&t=/);
  await click(tabFor("inspector"));
  assert.match(hashes[hashes.length - 1], /^#t=/);
});

test("leaving the board with nothing selected clears the stale view token", async () => {
  const {hashes} = await boot({fetch: () => miss()});
  await click(tabFor("watchboard"));
  assert.equal(hashes[hashes.length - 1], "#v=watchboard");
  await click(tabFor("inspector"));
  assert.equal(hashes[hashes.length - 1], "#");
});

test("the boot never writes over a pending deep link", async () => {
  let release!: () => void;
  const live = liveCorpus(LISTING, TEXTS);
  live.hold = new Promise(r => { release = r; });
  const {hashes} = await boot({fetch: live.fetch, hash: "#t=BB2&item=OT-BB2-1"});
  assert.equal(hashes.length, 0);
  release();
  await settle();
  assert.equal(entry("BB2").classList.contains("is-sel"), true);
  assert.equal(hashes[hashes.length - 1], "#t=BB2&item=OT-BB2-1");
});

test("a served page waiting for its corpus carries the ticket link through its hash writes", async () => {
  const live = liveCorpus(LISTING, TEXTS);
  live.down = true;
  const {feed} = await boot({fetch: live.fetch, hash: "#t=AA1"});
  await click(tabFor("watchboard"));
  assert.equal(location.hash, "#v=watchboard&t=AA1");
  live.down = false;
  await act(async () => { feed.onopen!(); });
  await settle();
  // The link's ticket lands, and the screen the reader chose meanwhile stays.
  assert.equal(entry("AA1").classList.contains("is-sel"), true);
  assert.equal(isOn("scrWatch"), true);
});

test("a dead ticket link takes no default selection", async () => {
  await bootBoard({hash: "#t=ZZ9"});
  assert.equal($$(".rentry").some(r => r.classList.contains("is-sel")), false);
});

// ---- R5, the client half: live updates ----

test("a change event reloads the corpus, and the open screen shows the change", async () => {
  const live = liveCorpus({root: "demo", files: LISTING.files.slice()}, {...TEXTS});
  const {feed} = await boot({fetch: live.fetch});
  await click(tabFor("watchboard"));
  assert.deepEqual(wids(), ["OT-BB2-1", "OT-BB2-2", "OT-AA1-1", "OT-AA1-2"]);
  live.texts["20260102-BB2-beta/audit-log.md"] = LOG_B.replace("| OT-BB2-2 | DL-001 | soon thing | MEDIUM | done → VALIDATED | 2026-09-01 |\n", "");
  await act(async () => { feed.onmessage!(); });
  await settle();
  assert.deepEqual(wids(), ["OT-BB2-1", "OT-AA1-1", "OT-AA1-2"]);
  assert.match($("#scrWatch").textContent!, /3 live · 1 settled/);
});

test("an event during a load queues one more load, so the last change always lands", async () => {
  const live = liveCorpus({root: "demo", files: LISTING.files.slice()}, {...TEXTS});
  const {feed} = await boot({fetch: live.fetch});
  assert.equal(live.listings, 1);
  let release!: () => void;
  live.hold = new Promise(r => { release = r; });
  await act(async () => { feed.onmessage!(); });
  // More events land while the first reload waits on its listing, and the
  // change they announce happens after that listing was read.
  await act(async () => { feed.onmessage!(); feed.onmessage!(); });
  live.listing = {root: "demo", files: ["20260101-AA1-alpha/audit-log.md"]};
  live.hold = null;
  release();
  await settle();
  assert.equal(live.listings, 3);
  assert.equal($$(".rentry").length, 1);
  assert.match($("#foot").textContent!, /1 tickets/);
});

test("a broken stream or a failed reload marks the corpus CACHED, and a reopen recovers it", async () => {
  const live = liveCorpus(LISTING, TEXTS);
  const {feed} = await bootBoard({fetch: live.fetch});
  assert.equal($("#liveTxt").textContent, "WATCHING");
  await act(async () => { feed.onerror!(); });
  assert.equal($("#liveTxt").textContent, "CACHED");
  assert.equal($("#liveChit").className, "chit poll poll-warn");
  assert.match($("#rail").textContent!, /AA1/);
  await act(async () => { feed.onopen!(); });
  await settle();
  assert.equal($("#liveTxt").textContent, "WATCHING");
  live.down = true;
  await act(async () => { feed.onmessage!(); });
  await settle();
  assert.equal($("#liveTxt").textContent, "CACHED");
  assert.match($("#rail").textContent!, /AA1/);
});

test("a stream that breaks before the first corpus lands still marks that corpus CACHED", async () => {
  const live = liveCorpus(LISTING, TEXTS);
  let release!: () => void;
  live.hold = new Promise(r => { release = r; });
  const {feed} = await boot({fetch: live.fetch});
  assert.equal($("#liveTxt").textContent, "IDLE");
  await act(async () => { feed.onerror!(); });
  live.hold = null;
  release();
  await settle();
  assert.match($("#rail").textContent!, /AA1/);
  assert.equal($("#liveTxt").textContent, "CACHED");
  await act(async () => { feed.onopen!(); });
  await settle();
  assert.equal($("#liveTxt").textContent, "WATCHING");
});

test("a boot that failed honors its deep link when the corpus first answers", async () => {
  const live = liveCorpus(LISTING, TEXTS);
  live.down = true;
  const {feed, hashes} = await boot({fetch: live.fetch, hash: "#t=AA1&item=DL-002"});
  assert.equal($("#projChit").textContent, "no corpus");
  live.down = false;
  await act(async () => { feed.onopen!(); });
  await settle();
  assert.equal(entry("AA1").classList.contains("is-sel"), true);
  assert.equal(hashes[hashes.length - 1], "#t=AA1&item=DL-002");
});

test("a boot that failed takes the default selection when the corpus first answers", async () => {
  const live = liveCorpus(LISTING, TEXTS);
  live.down = true;
  const {feed, hashes} = await boot({fetch: live.fetch});
  assert.equal($$(".rentry").length, 0);
  live.down = false;
  await act(async () => { feed.onopen!(); });
  await settle();
  const first = $$(".rentry")[0].getAttribute("data-key");
  assert.deepEqual(marked(), [first]);
  assert.equal(hashes[hashes.length - 1], "#t=" + first);
});

test("the live pill's status region is written only when its state changes", async () => {
  const live = liveCorpus(LISTING, TEXTS);
  const {feed} = await boot({fetch: live.fetch});
  assert.equal($("#liveTxt").textContent, "WATCHING");
  // A live region reports every text write, so an unchanged word must not be
  // written again on ordinary navigation or a quiet reload.
  const writes: MutationRecord[] = [];
  new MutationObserver(m => writes.push(...m)).observe($("#liveTxt"), {childList: true, characterData: true, subtree: true});
  await click(entry("AA1"));
  await click(tabFor("watchboard"));
  await act(async () => { feed.onmessage!(); });
  await settle();
  assert.equal(writes.length, 0);
  live.down = true;
  await act(async () => { feed.onmessage!(); });
  await settle();
  assert.equal(writes.length, 1);
  assert.equal($("#liveTxt").textContent, "CACHED");
});

test("the open ticket keeps its rail mark when its id stops or starts being shared", async () => {
  const shared = (w: string) => LOG.replace("# Audit Log — AA1 alpha", "# Audit Log — " + w).replace(/OT-AA1-/g, "OT-A001-");
  const listing = {root: "demo", files: ["A-001-one/audit-log.md", "A-001-two/audit-log.md"]};
  const live = liveCorpus(listing, {"A-001-one/audit-log.md": shared("one"), "A-001-two/audit-log.md": shared("two")});
  const {feed} = await boot({fetch: live.fetch});
  assert.deepEqual($$(".rentry").map(r => r.getAttribute("data-key")).sort(), ["A-001-one", "A-001-two"]);
  await click(entry("A-001-two"));
  const marked = () => $$(".rentry").filter(r => r.classList.contains("is-sel")).map(r => r.getAttribute("data-key"));
  live.listing = {root: "demo", files: ["A-001-two/audit-log.md"]};
  await act(async () => { feed.onmessage!(); });
  await settle();
  assert.deepEqual(marked(), ["A001"]);
  live.listing = listing;
  await act(async () => { feed.onmessage!(); });
  await settle();
  assert.deepEqual(marked(), ["A-001-two"]);
});

test("a bare shared id selects neither ticket", async () => {
  const shared = (w: string) => LOG.replace("# Audit Log — AA1 alpha", "# Audit Log — " + w).replace(/OT-AA1-/g, "OT-A001-");
  await boot({hash: "#t=A001", fetch: liveCorpus({root: "demo", files: ["A-001-one/audit-log.md", "A-001-two/audit-log.md"]},
    {"A-001-one/audit-log.md": shared("one"), "A-001-two/audit-log.md": shared("two")}).fetch});
  assert.equal($$(".rentry").some(r => r.classList.contains("is-sel")), false);
});

const SHARED_TEXTS: Record<string, string> = {};
for (const w of ["one", "two"]) SHARED_TEXTS["A-001-" + w + "/audit-log.md"] =
  LOG.replace("# Audit Log — AA1 alpha", "# Audit Log — " + w).replace(/OT-AA1-/g, "OT-A001-");
const SHARED = {root: "demo", files: ["A-001-one/audit-log.md", "A-001-two/audit-log.md"]};

test("a hash for the second shared-id ticket reopens it", async () => {
  await boot({hash: "#t=A-001-two", fetch: liveCorpus(SHARED, SHARED_TEXTS).fetch});
  assert.deepEqual(marked(), ["A-001-two"]);
});

test("a directory hash for a ticket whose id is now unique marks its rail row", async () => {
  await boot({hash: "#t=A-001-two", fetch: liveCorpus({root: "demo", files: ["A-001-two/audit-log.md"]}, SHARED_TEXTS).fetch});
  assert.deepEqual(marked(), ["A001"]);
});

test("board links on shared-id tickets land on their own directories", async () => {
  const {hashes} = await boot({fetch: liveCorpus(SHARED, SHARED_TEXTS).fetch});
  for (const word of ["one", "two"]){
    await click(tabFor("watchboard"));
    await click($$(".wbl").find(a => a.getAttribute("data-t") === "A-001-" + word && a.getAttribute("data-item") === "OT-A001-1")!);
    assert.equal(isOn("scrInspector"), true);
    assert.deepEqual(marked(), ["A-001-" + word]);
    assert.equal(hashes[hashes.length - 1], "#t=A-001-" + word + "&item=OT-A001-1");
  }
});

// ---- the header menu ----

// jsdom has no layout, so a test sets the header's two widths by hand. The
// app reads them the way it reads a real box.
function headerWidths(scroll: number | (() => number), client: number){
  const hdr = $("header");
  Object.defineProperty(hdr, "scrollWidth", {configurable: true, get: typeof scroll === "function" ? scroll : () => scroll});
  Object.defineProperty(hdr, "clientWidth", {configurable: true, get: () => client});
  return hdr;
}
const resize = async () => { await act(async () => { window.dispatchEvent(new Event("resize")); }); };

test("the header folds into the menu only while the full row overflows", async () => {
  await boot();
  const hdr = $("header");
  assert.equal(hdr.classList.contains("is-compact"), false);
  headerWidths(1080, 705);
  await resize();
  assert.equal(hdr.classList.contains("is-compact"), true);
  headerWidths(1085, 1085);
  await resize();
  assert.equal(hdr.classList.contains("is-compact"), false);
});

test("the header folds when its labels would have to break to fit", async () => {
  await boot();
  const hdr = $("header");
  headerWidths(() => hdr.classList.contains("is-measuring") ? 1180 : 1085, 1085);
  await resize();
  assert.equal(hdr.classList.contains("is-compact"), true);
  assert.equal(hdr.classList.contains("is-measuring"), false);
});

test("every path that rewrites header text measures the header again", async () => {
  const live = liveCorpus(LISTING, TEXTS);
  const {feed} = await boot({fetch: live.fetch});
  const hdr = $("header");
  headerWidths(1080, 705);
  await click(tabFor("watchboard"));
  assert.equal(hdr.classList.contains("is-compact"), true);
  headerWidths(705, 705);
  await click($("#themeBtn"));
  assert.equal(hdr.classList.contains("is-compact"), false);
  headerWidths(1080, 705);
  live.down = true;
  await act(async () => { feed.onmessage!(); });
  await settle();
  assert.equal($("#liveTxt").textContent, "CACHED");
  assert.equal(hdr.classList.contains("is-compact"), true);
});

test("the menu button opens the menu and names the current screen", async () => {
  await boot();
  headerWidths(1080, 705);
  await resize();
  assert.equal($("#menuTxt").textContent, "inspector");
  await click($("#menuBtn"));
  assert.equal($("header").classList.contains("menu-open"), true);
  assert.equal($("#menuBtn").getAttribute("aria-expanded"), "true");
  await click($("#menuBtn"));
  assert.equal($("header").classList.contains("menu-open"), false);
  assert.equal($("#menuBtn").getAttribute("aria-expanded"), "false");
});

test("a pick from the open menu closes it and hands focus to the menu button", async () => {
  await boot();
  headerWidths(1080, 705);
  await resize();
  await click($("#menuBtn"));
  tabFor("ledgers").focus();
  await click(tabFor("ledgers"));
  assert.equal($("header").classList.contains("menu-open"), false);
  same(document.activeElement, $("#menuBtn"), "focus is not on the menu button");
  assert.equal($("#menuTxt").textContent, "ledgers");
  await click($("#menuBtn"));
  $("#newTaskBtn").focus();
  await click($("#newTaskBtn"));
  assert.equal($("header").classList.contains("menu-open"), false);
  same(document.activeElement, $("#menuBtn"), "focus is not on the menu button");
  assert.equal($("#menuTxt").textContent, "new task");
});

test("Escape closes the open menu and hands focus to the menu button", async () => {
  await boot();
  headerWidths(1080, 705);
  await resize();
  await click($("#menuBtn"));
  tabFor("ledgers").focus();
  await key(tabFor("ledgers"), "Escape");
  assert.equal($("header").classList.contains("menu-open"), false);
  same(document.activeElement, $("#menuBtn"), "focus is not on the menu button");
});

test("a click outside the menu closes it and leaves focus alone", async () => {
  await boot();
  headerWidths(1080, 705);
  await resize();
  await click($("#menuBtn"));
  $("#rail").tabIndex = -1;
  $("#rail").focus();
  await click($("#rail"));
  assert.equal($("header").classList.contains("menu-open"), false);
  same(document.activeElement, $("#rail"), "focus left the rail");
});

test("the open menu closes when the full header fits again", async () => {
  await boot();
  headerWidths(1080, 705);
  await resize();
  await click($("#menuBtn"));
  headerWidths(1385, 1385);
  await resize();
  assert.equal($("header").classList.contains("is-compact"), false);
  assert.equal($("header").classList.contains("menu-open"), false);
  assert.equal($("#menuBtn").getAttribute("aria-expanded"), "false");
});

// ---- what the app leaves out ----

test("the app offers no file input, no drop mask, and no opened-documents group", async () => {
  await bootBoard();
  assert.equal($$('input[type="file"]').length, 0);
  assert.equal($$(".shellmask").length, 0);
  assert.equal($$(".rclose").length, 0);
  assert.ok(!$$(".railsec").some(s => s.getAttribute("data-sec") === "opened documents"));
});

test("the app closes its event stream when it unmounts", async () => {
  const {feed} = await bootBoard();
  cleanup();
  assert.equal(feed.closed, true);
});
