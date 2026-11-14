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
import * as Bld from "../../src/lib/adp-index-builder-lib.ts";
import * as S from "../../src/lib/adp-shell-lib.ts";
import * as D from "../../src/lib/adp-derive-lib.ts";
import * as P from "../../src/lib/adp-parser-lib.ts";
import {App} from "../../src/app/App.tsx";
import {PromptCards, SPY_SLACK} from "../../src/app/Inspector.tsx";
import {gapNote, stripModel} from "../../src/app/PhaseStrip.tsx";
import {Rail} from "../../src/app/Rail.tsx";
import {ReviewBody} from "../../src/app/Reviews.tsx";
import * as PL from "../../src/lib/adp-prompt-lib.ts";
import {DecisionsPanel, Pills, WatchesPanel} from "../../src/app/panels.tsx";
import type {EventFeed} from "../../src/app/live.ts";
import type {FetchFn, FetchResponse} from "../../src/lib/adp-shell-lib.ts";

// The lint sweep runs through a pass-through spy, so a test can count the
// sweeps the app runs.
vi.mock("../../src/lib/adp-index-builder-lib.ts", async importOriginal => {
  const real = await importOriginal<typeof import("../../src/lib/adp-index-builder-lib.ts")>();
  return {...real, lintCorpus: vi.fn(real.lintCorpus)};
});

// jsdom has no ResizeObserver, so the full log gets one that never reports.
globalThis.ResizeObserver ??= class { observe(){} unobserve(){} disconnect(){} } as unknown as typeof ResizeObserver;

const require = createRequire(import.meta.url);
type Region = {text: string[]; attrs: string[]};
type Snapshot = {screen: string | null; header: Region | null; rail: Region | null; main: Region | null; footer: Region | null; drawer?: Region};
const {diskFetch, record, snapshot, NOW: BASELINE_NOW} = require("./screen-text.js") as
  {diskFetch(): FetchFn; record(el: Element): Region; snapshot(d: Document): Snapshot; NOW: number};
const {readFixture} = require("./helpers.js") as {readFixture(name: string): string};
const BASELINE = JSON.parse(readFixture("screen-baseline.json")) as Record<string, Snapshot>;

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  fakeTimeouts = false;
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

/* A test that fakes the timeouts sets this flag, because a zero timeout
   then never fires. settle flushes the microtasks alone in that mode. */
let fakeTimeouts = false;
const settle = async (turns = 8) => {
  for (let i = 0; i < turns; i++)
    await act(async () => { await (fakeTimeouts ? Promise.resolve() : new Promise(r => setTimeout(r, 0))); });
};

// A draft is the text New task finds under its storage key at boot, and
// stored holds any other keys the page finds there.
type BootOpts = {fetch?: FetchFn; hash?: string; now?: number; draft?: string; stored?: Record<string, string>};
async function boot({fetch = () => new Promise<FetchResponse>(() => {}), hash = "", now = NOW, draft, stored = {}}: BootOpts = {}){
  vi.useFakeTimers({toFake: ["Date"]});
  vi.setSystemTime(now);
  history.replaceState(null, "", "/" + hash);
  document.documentElement.setAttribute("data-theme", "dark");
  localStorage.clear();
  if (draft != null) localStorage.setItem("adp-mc-draft", draft);
  for (const [k, v] of Object.entries(stored)) localStorage.setItem(k, v);
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
/* The control that opens a screen. The top bar's views open Tickets,
   Watches, and Ledger. Calibration heads the Ledger, the resume pack opens
   as the Packs drawer, and reviews open from the phase strip's reviews box. */
const tabFor = (name: string) => name === "new task" ? $("#newTaskBtn") : name === "resume pack" ? $("#packsBtn")
  : name === "reviews" ? $('#phaseStrip [data-op="reviews"]')
  : $$(".adp-nav a").find(t => t.getAttribute("data-s") === (name === "calibration" ? "ledgers" : name))!;
const entry = (key: string) => $$("#rail [data-key]").find(r => r.getAttribute("data-key") === key)!;
const click = async (el: Element) => { fireEvent.click(el); await settle(1); };
const key = async (el: Element, k: string) => { fireEvent.keyDown(el, {key: k}); await settle(1); };
const wids = () => $$(".wbrow").map(r => r.getAttribute("data-wid"));
const isOn = (id: string) => $("#" + id).classList.contains("is-on");
const marked = () => $$("#rail [data-key]").filter(r => r.getAttribute("aria-current") === "true").map(r => r.getAttribute("data-key"));
// React keeps its fiber on every element it renders. A failed equal on two
// elements makes Node compare those fiber graphs in depth before it writes
// its message, which never ends, so we compare identity and name the miss.
const same = (got: unknown, want: unknown, what: string) => assert.ok(got === want, what);

// ---- R8: the baseline ----

test("the app's rail shows what the vanilla page showed at boot, under the new top bar and no footer", async () => {
  await boot({fetch: diskFetch(), now: BASELINE_NOW});
  const got = snapshot(document), want = restyled(BASELINE["boot"]);
  assert.equal(got.screen, want.screen);
  assert.deepEqual(got.header, want.header);
  assert.deepEqual(got.rail, want.rail);
  assert.deepEqual(got.footer, want.footer);
});

test("the app's watchboard state shows what the vanilla page showed, region for region", async () => {
  await boot({fetch: diskFetch(), now: BASELINE_NOW});
  await click(tabFor("watchboard"));
  assert.deepEqual(snapshot(document), restyled(BASELINE["watchboard"]));
});

/* The vanilla inspector's ops row held four controls that loaded a file
   from outside .adp: open and watch, reload, paste, and the drag-and-drop
   hint. The app has none of them, and the baseline still records them, so
   the comparison takes exactly these entries out of each inspector state
   and fails when the baseline lacks one. Every other entry must match. */
const REMOVED_OPS = {text: ["⌖ open", "↻ reload", "⌨ paste", "drag & drop .md anywhere"], attrs: ["title=pick audit logs to open"]};
function withoutOps(r: Region, gone: Region = REMOVED_OPS): Region {
  const drop = (list: string[], gone: string[]) => {
    const out = list.slice();
    for (const g of gone){
      const i = out.indexOf(g);
      assert.ok(i >= 0, "the baseline lacks " + g);
      out.splice(i, 1);
    }
    return out;
  };
  return {text: drop(r.text, gone.text), attrs: drop(r.attrs, gone.attrs)};
}
/* The prompt pane holds one control the vanilla page lacked: "start from
   this prompt", the one way a written prompt reaches New task. We take that
   entry out of the app's render of a prompt state, and fail when the app
   lacks it. */
const START_FROM = "start from this prompt";
function withoutStart(snap: Snapshot): Snapshot {
  const text = snap.main!.text.slice(), i = text.indexOf(START_FROM);
  assert.ok(i >= 0, "the prompt pane lacks " + START_FROM);
  text.splice(i, 1);
  return {...snap, main: {...snap.main!, text}};
}
const tabTo = (name: string) => click(tabFor(name));
const pickPack = async (name: string) => { fireEvent.change($("#packSel"), {target: {value: name}}); await settle(1); };

/* The top bar replaced the vanilla header and its footer (DL-012). The
   baseline still records the old chrome, so each comparison first checks
   that the old header and footer are exactly what the vanilla page showed,
   then expects the new bar in their place and no footer. The footer's words
   moved to the ⋯ menu's About section, which a test below checks. */
const OLD_TABS = ["inspector", "reviews", "watchboard", "ledgers", "calibration", "resume pack"];
const NEW_HEADER: Region = {text: ["corpus", "WATCHING", "ADP · Mission Control", "Tickets", "Watches", "Ledger", "Packs", "+ New task", "⋯"],
  attrs: ["aria-label=Views", "aria-label=Settings and theme"]};
function restyled(want: Snapshot, screen = want.screen): Snapshot {
  assert.deepEqual(want.header, {text: ["ADP ·", "MISSION CONTROL", "WATCHING", "☾", "theme", "≡", want.screen!, "project: corpus",
    ...OLD_TABS, "+ new task"], attrs: ["title=Toggle light / dark"]}, "the baseline header is not the vanilla header");
  assert.match(want.footer!.text.join(" "), /^schema adp-index\/1 · \d+ tickets · read-only · rebuilt in-memory from the working tree$/);
  return {...want, screen, header: NEW_HEADER, footer: null, rail: want.rail && regrouped(want.rail)};
}
/* The rail's groups follow the index states (DL-037). Every ticket in the
   baseline's "in progress" group is open, so that group becomes the open
   group whole. A group with no tickets leaves the rail, except closed. The
   rows themselves stay exactly as the baseline recorded them (DL-038). The
   rail gains a head with the ticket count and its fold button, and a filter
   field, ahead of the groups. */
const BASE_STATES = new Map((await S.loadCorpus(diskFetch()))!.index.tickets.map(t => [t.id || t.dir, t.state]));
const OLD_GROUPS = ["needs attention", "in progress", "shipped", "closed"];
/* The ticket head follows the Main board (DL-043). The vanilla head read
   "inspector", the directory, the two view toggles, the id, "state · source",
   and the PR. The new head reads a meta line of id, date, and directory, the
   title, the state word, where the state came from, the PR, the two view
   segments, and Resume pack. We check the old run against the ticket's own
   index fields, then put the new run, built from the same fields, in its
   place. The view group's label joins the attributes after the state's. */
const BASE_TICKETS = new Map((await S.loadCorpus(diskFetch()))!.index.tickets.map(t => [t.dir, t]));
const SOURCE_WORDS: Record<string, string> = {declared: "declared in front matter", inferred: "inferred from the log"};
function reheaded(main: Region): Region {
  const t = BASE_TICKETS.get(main.text[1]);
  assert.ok(t, "the baseline head names no ticket directory");
  const pr = t.pr ? ["pr " + t.pr] : [];
  const old = ["inspector", t.dir, "section", "full log", t.id || t.dir, t.state + " · " + t.state_source, ...pr];
  assert.deepEqual(main.text.slice(0, old.length), old, "the baseline head is not the vanilla head");
  const head = [[t.id, t.date, t.dir].filter(Boolean).join(" · "), t.title || t.slug || t.id || t.dir, t.state, SOURCE_WORDS[t.state_source],
    ...(t.pr ? ["·", "PR #" + t.pr] : []), "Section", "Full log", "Resume pack"];
  const lifecycle = "title=lifecycle state — declared in front matter, or inferred from section presence on legacy logs";
  const i = main.attrs.indexOf(lifecycle);
  assert.ok(i >= 0, "the baseline head has no lifecycle title");
  return {text: [...head, ...main.text.slice(old.length)], attrs: [...main.attrs.slice(0, i + 1), "aria-label=View", ...main.attrs.slice(i + 1)]};
}
function regrouped(rail: Region): Region {
  const text = rail.text.slice(), heads: number[] = [];
  for (let i = 1; i < text.length; i++) if (OLD_GROUPS.includes(text[i]) && /^[▾▸]$/.test(text[i - 1])) heads.push(i - 1);
  assert.deepEqual(heads.map(i => text[i + 1]), OLD_GROUPS, "the baseline rail does not hold the four vanilla groups");
  const block = (g: number) => text.slice(heads[g] + 3, g + 1 < heads.length ? heads[g + 1] : text.length);
  for (const id of block(1).filter(x => BASE_STATES.has(x))) assert.equal(BASE_STATES.get(id), "open", id + " is not open");
  const out: string[] = [];
  for (const [g, name] of OLD_GROUPS.entries()){
    const [glyph, , count] = text.slice(heads[g], heads[g] + 3);
    if (count === "0" && name !== "closed") continue;
    out.push(glyph, name === "in progress" ? "open" : name, count, ...block(g));
  }
  return {text: [BASE_STATES.size + " tickets", "«", ...out], attrs: ["aria-label=Tickets", "title=Hide tickets [",
    "aria-label=Hide tickets sidebar", "aria-label=Filter tickets", "placeholder=Filter tickets", ...rail.attrs]};
}
/* The phase strip and the missing-phases note above it are new, so the
   comparison takes each one's own record out of the app's render, as one
   unbroken run in place. Their own tests pin what they show. */
function withoutStrip(snap: Snapshot): Snapshot {
  const cut = (list: string[], run: string[]) => {
    const i = list.findIndex((_, j) => run.every((x, k) => list[j + k] === x));
    assert.ok(i >= 0, "the render lacks the run " + run.join(" | "));
    return [...list.slice(0, i), ...list.slice(i + run.length)];
  };
  for (const el of [$("#gapNote"), $("#phaseStrip")]){
    if (!el) continue;
    const r = record(el);
    snap = {...snap, main: {...snap.main!, text: cut(snap.main!.text, r.text), attrs: cut(snap.main!.attrs, r.attrs)}};
  }
  return snap;
}
/* The section select no longer carries a chip with the shown section's
   state (CD5). The option text still names every state but "complete", so
   the comparison takes the chip's word out of the baseline. */
const SECTION_STATES = ["complete", "current", "invalidated entries", "missing", "non-canonical", "open items", "overdue watches",
  "unanchored watches", "parse issues", "shown raw", "unreadable", "—"];
function withoutChip(want: Snapshot): Snapshot {
  const text = want.main!.text.slice(), i = text.indexOf("next ›");
  assert.ok(i >= 0 && SECTION_STATES.includes(text[i + 1]), "the baseline has no section chip after next ›");
  text.splice(i + 1, 1);
  return {...want, main: {...want.main!, text}};
}
/* The Packs drawer holds what the resume pack screen held, under new chrome
   (DL-014). We drop the old screen's chrome and the drawer's chrome by exact
   string, then every remaining entry must match in order: the pack names,
   the filled text, and the guide to writing a pack. */
function packChrome(old: Region, drawer: Region){
  const drop = (list: string[], gone: (string | RegExp)[]) => {
    const out = list.slice();
    for (const g of gone){
      const i = out.findIndex(x => typeof g === "string" ? x === g : g.test(x));
      assert.ok(i >= 0, "the region lacks " + g);
      out.splice(i, 1);
    }
    return out;
  };
  const file = old.text.find(x => x.startsWith("source: "))!.slice("source: ".length);
  const filled = old.text.includes("⧉ copy pack");
  const oldRest = drop(old.text, ["resume pack", "deterministic · copy into your next interactive session", "source: " + file,
    ...(filled ? ["⧉ copy pack"] : []), "add your own pack"]);
  const forTicket = drawer.text.some(x => /^for \S+$/.test(x));
  const newRest = drop(drawer.text, ["Packs", "Paste into your next session", "×", "Pack", ...(forTicket ? [/^for \S+$/] : []),
    ...(filled ? ["Copy pack", "Same index, same bytes"] : []), file, "▸", "Write your own pack"]);
  assert.deepEqual(newRest, oldRest);
  assert.deepEqual(drawer.attrs, [...old.attrs, "aria-label=Close packs"]);
}
/* The decision cards follow the DecisionCard component (DL-047). The
   vanilla pills led each word with its kind, "conf" or "status", as a run
   of its own. The new chips carry the kind as a title, and each head gains
   a fold caret. So the comparison takes out of the baseline, chip by chip
   in page order, the kind run that sits right before that chip's word. It
   takes the titles and carets out of the app's render, and each count must
   equal the chips and cards on show, so nothing else can leave. */
function decarded(got: Snapshot, want: Region): [Snapshot, Region] {
  // The head carries the two chips with a title. A token chip in a title or a
  // field is the log's own word, which the baseline holds as it is.
  const chips = $$("#scrInspector .adp-dl__head > span > .adp-chip[title]"), carets = $$("#scrInspector .adp-dl__caret").length;
  const cut = (list: string[], gone: string[], n: number, what: string) => {
    const out = list.filter(x => !gone.includes(x));
    assert.equal(list.length - out.length, n, what);
    return out;
  };
  const text = want.text.slice();
  let from = 0;
  for (const c of chips){
    const kind = c.getAttribute("title") === "confidence" ? "conf" : "status";
    const i = text.findIndex((x, j) => j >= from && x === kind && text[j + 1] === c.textContent);
    assert.ok(i >= 0, "the baseline has no " + kind + " pill for " + c.textContent);
    text.splice(i, 1);
    from = i;
  }
  const main = got.main!;
  return [{...got, main: {text: cut(main.text, ["▾", "▸"], carets, "carets"), attrs: cut(main.attrs, ["title=confidence", "title=status"], chips.length, "chip titles")}},
    {text, attrs: want.attrs}];
}
/* The Reading rules turn a bold run-in label into an eyebrow heading and the
   closing metadata lines into one footer (DL-052). The heading drops the
   label's colon, and the footer joins its pairs with " · ". So for each
   marked heading and footer, in page order, we find its own runs in the
   app's render and map them back: the heading's last run takes its colon
   again, and the footer loses its separators. */
// How many headings and footers the walk mapped back, so a test can show it met both.
const readSeen = {runin: 0, meta: 0};
function unread(snap: Snapshot): Snapshot {
  let got = snap;
  const text = got.main!.text.slice();
  let from = 0;
  for (const el of $$("#scrInspector h3[data-runin], #scrInspector footer[data-meta]")){
    const run = record(el).text;
    const i = text.findIndex((_, j) => j >= from && run.every((x, k) => text[j + k] === x));
    assert.ok(i >= 0, "the render lacks the run of " + el.outerHTML.slice(0, 60));
    const back = el.tagName === "H3" ? [...run.slice(0, -1), run.at(-1) + ":"] : run.filter(x => x !== "·");
    readSeen[el.tagName === "H3" ? "runin" : "meta"]++;
    text.splice(i, run.length, ...back);
    from = i + back.length;
  }
  // A prompt key's YAML name moved from beside its title into the title's
  // tooltip (DL-064). For each title in page order we put the name back as a
  // run after the title and its one-line value, and take the tooltip out of
  // the attributes.
  from = 0;
  const attrs = got.main!.attrs.slice();
  for (const el of $$("#scrInspector [data-p=title]")){
    const i = text.indexOf(el.textContent!, from);
    assert.ok(i >= 0, "the render lacks prompt title " + el.textContent);
    const val = el.nextElementSibling;
    const at = i + 1 + (val && val.getAttribute("data-p") === "val" ? record(val).text.length : 0);
    text.splice(at, 0, el.getAttribute("title")!);
    from = at + 1;
    const j = attrs.indexOf("title=" + el.getAttribute("title"));
    assert.ok(j >= 0, "the render lacks the tooltip of " + el.textContent);
    attrs.splice(j, 1);
  }
  got = {...got, main: {...got.main!, attrs}};
  // A numbered list shows its numbers as text (DL-062), where the vanilla
  // page drew them with a counter. We take each number run out in page order.
  from = 0;
  for (const el of $$("#scrInspector [data-num]")){
    const i = text.indexOf(el.textContent!, from);
    assert.ok(i >= 0, "the render lacks list number " + el.textContent);
    text.splice(i, 1);
    from = i;
  }
  return {...got, main: {...got.main!, text}};
}
const rentries = () => $$("#rail [data-key]").map(r => r.getAttribute("data-key")!);
const options = () => [...($("#secSel") as HTMLSelectElement).options].map(o => o.value);
async function pickSection(key: string){ fireEvent.change($("#secSel"), {target: {value: key}}); await settle(1); }
const baselineBoot = () => boot({fetch: diskFetch(), now: BASELINE_NOW});

/* We walk the app the way the baseline capture walked the vanilla page:
   every section of every ticket, then its full log, in rail order. */
test("the app's inspector shows what the vanilla page showed, for every section and full log of every ticket", async () => {
  await baselineBoot();
  const keys = Object.keys(BASELINE).filter(k => k.startsWith("inspector|"));
  const seen: string[] = [];
  for (const t of rentries()){
    await tabTo("inspector");
    await click(entry(t));
    await click($('[data-view="section"]'));
    for (const s of options()){
      await pickSection(s);
      const k = "inspector|" + t + "|section|" + s, want = BASELINE[k];
      assert.ok(want, "the baseline has no state " + k);
      const [got, main] = decarded(unread(withoutStrip(s === "prompt" ? withoutStart(snapshot(document)) : snapshot(document))),
        reheaded(withoutOps(withoutChip(want).main!)));
      assert.deepEqual(got, {...restyled(want), main}, k);
      seen.push(k);
    }
    await click($('[data-view="full"]'));
    const k = "inspector|" + t + "|full", want = BASELINE[k];
    const [got, main] = decarded(unread(withoutStrip(snapshot(document))), reheaded(withoutOps(withoutChip(want).main!)));
    assert.deepEqual(got, {...restyled(want), main}, k);
    seen.push(k);
  }
  assert.deepEqual(seen, keys);
  assert.ok(readSeen.runin > 0 && readSeen.meta > 0, "the walk met no run-in heading or no footer");
}, 120000);

test("the Packs drawer shows what the vanilla resume pack screen showed, for every pack and ticket", async () => {
  await baselineBoot();
  const keys = Object.keys(BASELINE).filter(k => k.startsWith("resume pack|"));
  const seen: string[] = [];
  for (const t of rentries()){
    if ($("#packDrawer")) await click($('[aria-label="Close packs"]'));
    await tabTo("inspector");
    await click(entry(t));
    await tabTo("resume pack");
    for (const pk of [...($("#packSel") as HTMLSelectElement).options].map(o => o.value)){
      await pickPack(pk);
      const k = "resume pack|" + t + "|" + pk, want = BASELINE[k], got = snapshot(document);
      assert.deepEqual(got.header, restyled(want).header, k);
      assert.deepEqual(got.rail, restyled(want).rail, k);
      packChrome(want.main!, got.drawer!);
      seen.push(k);
    }
  }
  assert.deepEqual(seen, keys);
}, 120000);

// The baseline took the boards after its walk, so the last rail ticket is
// the one the reviews screen shows.
// Calibration now heads the Ledger, so the Ledger shows the vanilla
// calibration screen's record, then the vanilla ledger screen's record.
test("the app's reviews and Ledger screens show what the vanilla reviews, calibration, and ledgers screens showed", async () => {
  await baselineBoot();
  await click(entry(rentries().at(-1)!));
  // The last ticket has no rounds, so no control opens its reviews screen.
  // Its old link still does.
  assert.ok(!$('#phaseStrip [data-op="reviews"]'), "a ticket with no rounds offers a reviews box");
  const last = rentries().at(-1)!;
  cleanup();
  vi.restoreAllMocks();
  await boot({fetch: diskFetch(), now: BASELINE_NOW, hash: "#v=reviews&t=" + encodeURIComponent(last)});
  /* The reviews screen leads with the ticket's head and phase strip (DL-066),
     where the vanilla screen named itself "reviews" and the directory. So the
     comparison takes the head's and the strip's own runs out of the app's
     render, where they open the screen, and the two vanilla runs out of the
     baseline, and every run after them must match. */
  const got = snapshot(document), want = restyled(BASELINE["reviews"]);
  const lead = [record($("#tickHead")), record($("#phaseStrip"))];
  const text = lead.flatMap(r => r.text), attrs = lead.flatMap(r => r.attrs);
  assert.deepEqual(got.main!.text.slice(0, text.length), text);
  assert.deepEqual(got.main!.attrs.slice(0, attrs.length), attrs);
  const dir = BASE_TICKETS.get([...BASE_TICKETS.values()].find(x => (x.id || x.dir) === last)!.dir)!.dir;
  assert.deepEqual(want.main!.text.slice(0, 2), ["reviews", dir]);
  assert.deepEqual({...got, main: {text: got.main!.text.slice(text.length), attrs: got.main!.attrs.slice(attrs.length)}},
    {...want, main: {...want.main!, text: want.main!.text.slice(2)}}, "reviews");
  await tabTo("ledgers");
  const cal = BASELINE["calibration"], led = restyled(BASELINE["ledgers"]);
  restyled(cal);
  assert.deepEqual(snapshot(document), {...led, main: {text: [...cal.main!.text, ...led.main!.text], attrs: [...cal.main!.attrs, ...led.main!.attrs]}});
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

test("a view switch keeps the same links, so focus survives the render", async () => {
  await boot();
  const before = $$(".adp-nav a");
  before[1].focus();
  await click(before[1]);
  const after = $$(".adp-nav a");
  assert.equal(after.length, before.length);
  before.forEach((tab, i) => same(after[i], tab, "view link " + i + " was rebuilt"));
  assert.equal(before[1].getAttribute("aria-current"), "page");
  same(document.activeElement, before[1], "focus left the link it pressed");
});

test("new task presses its button and leaves no view current", async () => {
  await boot();
  await click($("#newTaskBtn"));
  assert.equal($("#newTaskBtn").getAttribute("aria-pressed"), "true");
  assert.equal(isOn("scrNew"), true);
  assert.equal($$(".adp-nav a").some(t => t.hasAttribute("aria-current")), false);
});

// R6: the bar's controls, in the order the TopBar component and the Nav board draw them.
test("the top bar holds the live dot, the repo, the product label, three views, Packs, New task, and the menu, in that order", async () => {
  await bootBoard();
  const bar = $("#topbar");
  const parts = [...bar.querySelectorAll(".adp-livedot, [data-part=name], #liveTxt, .adp-topbar__product, .adp-nav a, #packsBtn, #newTaskBtn, #menuBtn")]
    .map(e => e.classList.contains("adp-livedot") ? "dot" : e.textContent);
  assert.deepEqual(parts, ["dot", "demo", "WATCHING", "ADP · Mission Control", "Tickets", "Watches", "Ledger", "Packs", "+ New task", "⋯"]);
  assert.equal($$(".adp-nav a").find(a => a.hasAttribute("aria-current"))!.textContent, "Tickets");
  assert.equal(document.title, "demo · ADP · Mission Control");
});

const themeOpt = (t: string) => $(`[data-theme-choice="${t}"]`);
test("the menu's theme choice sets the attribute and the stored key, and System stores nothing", async () => {
  await boot();
  await click($("#menuBtn"));
  assert.equal(themeOpt("system").getAttribute("aria-checked"), "true");
  await click(themeOpt("light"));
  assert.equal(document.documentElement.getAttribute("data-theme"), "light");
  assert.equal(localStorage.getItem("adp-theme"), "light");
  assert.equal(themeOpt("light").getAttribute("aria-checked"), "true");
  await click(themeOpt("dark"));
  assert.equal(document.documentElement.getAttribute("data-theme"), "dark");
  assert.equal(localStorage.getItem("adp-theme"), "dark");
  await click(themeOpt("system"));
  assert.equal(localStorage.getItem("adp-theme"), null);
});

// PM9: a choice stored before the run reads as that choice.
test("a theme stored before the run opens as that choice in the menu", async () => {
  await boot();
  cleanup();
  vi.restoreAllMocks();
  vi.useFakeTimers({toFake: ["Date"]});
  vi.setSystemTime(NOW);
  localStorage.setItem("adp-theme", "light");
  render(createElement(App, {fetchFn: () => new Promise<FetchResponse>(() => {}), openFeed: () => new FakeFeed() as unknown as EventFeed}));
  await settle();
  assert.equal(document.documentElement.getAttribute("data-theme"), "light");
  await click($("#menuBtn"));
  assert.equal(themeOpt("light").getAttribute("aria-checked"), "true");
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

const about = async () => {
  if (!$("#hdrMenu")) await click($("#menuBtn"));
  return [...$("#hdrMenu").querySelectorAll(".adp-menu__section:last-child .adp-meta")].map(p => p.textContent);
};
test("a served corpus fills the repo name, the live word, the menu's About lines, and the rail", async () => {
  await bootBoard();
  assert.equal($("[data-part=name]").textContent, "demo");
  assert.equal($("#liveTxt").textContent, "WATCHING");
  assert.equal($(".adp-livedot").className, "adp-livedot");
  assert.deepEqual(await about(), ["schema adp-index/1 · 2 tickets · read-only · rebuilt in-memory from the working tree", "demo · :" + location.port]);
  const lines = $$("#hdrMenu .adp-menu__section:last-child .adp-meta");
  assert.equal(lines[0].style.fontFamily, "");
  assert.equal(lines[1].style.fontFamily, "var(--font-mono)");
  const rail = $("#rail").textContent!;
  assert.match(rail, /needs attention/);
  assert.match(rail, /AA1/);
  assert.match(rail, /BB2/);
});

test("with no corpus the bar names no repo, the live word idles, and About says so", async () => {
  await boot({fetch: () => miss()});
  assert.equal($("[data-part=name]").textContent, "");
  assert.equal($("#liveTxt").textContent, "IDLE");
  assert.match($(".adp-livedot").className, /adp-livedot--cached/);
  assert.deepEqual(await about(), ["no corpus · launch mission control with adp-launch.mts to build the index in-memory"]);
});

// ---- the rail ----

test("the corpus boot selects the first rail entry", async () => {
  const {hashes} = await bootBoard();
  const sel = $$("#rail [data-key]").filter(r => r.getAttribute("aria-current") === "true").map(r => r.getAttribute("data-key"));
  assert.equal(sel.length, 1);
  assert.equal(sel[0], $$("#rail [data-key]")[0].getAttribute("data-key"));
  assert.equal(hashes[hashes.length - 1], "#t=" + sel[0] + "&s=sec-decision-log");
});

test("the rail collapses a group and a ticket click selects it", async () => {
  await bootBoard();
  const sec = () => $$("#rail [data-sec]").find(s => s.getAttribute("data-sec") === "needs attention")!;
  const n = $$("#rail [data-key]").length;
  const inGroup = Number(sec().querySelector("[data-part=count]")!.textContent);
  await click(sec());
  assert.equal($$("#rail [data-key]").length, n - inGroup);
  await click(sec());
  assert.equal($$("#rail [data-key]").length, n);
  await click(tabFor("watchboard"));
  await click(entry("AA1"));
  assert.equal(entry("AA1").getAttribute("aria-current") === "true", true);
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
  // The settled row's link lands the inspector like any board row's.
  await click($$(".wbl").find(a => a.getAttribute("data-item") === "OT-BB2-3")!);
  assert.equal(isOn("scrInspector"), true);
  assert.equal(($("#secSel") as HTMLSelectElement).value, "sec-obligation-ticket-list");
  assert.match($("#scrInspector").innerHTML, /is-hl/);
  assert.equal(hashes[hashes.length - 1], "#t=BB2&s=sec-obligation-ticket-list&item=OT-BB2-3");
  // The chips keep their state across a visit to another screen.
  await click(tabFor("watchboard"));
  await click(chip("upcoming"));
  assert.deepEqual(wids(), ["OT-BB2-1", "OT-BB2-2", "OT-AA1-2", "OT-BB2-3"]);
});

test("a board watch link lands the inspector on the owning section, item highlighted", async () => {
  const {hashes} = await bootBoard();
  await click(tabFor("watchboard"));
  await click($$(".wbl").find(a => a.getAttribute("data-item") === "OT-BB2-1")!);
  assert.equal(isOn("scrInspector"), true);
  assert.equal(($("#secSel") as HTMLSelectElement).value, "sec-obligation-ticket-list");
  assert.match($("#scrInspector").innerHTML, /is-hl/);
  assert.equal(hashes[hashes.length - 1], "#t=BB2&s=sec-obligation-ticket-list&item=OT-BB2-1");
});

test("a board ticket link selects the ticket and opens the inspector", async () => {
  const {hashes} = await bootBoard();
  await click(tabFor("watchboard"));
  await click($$(".wbl").find(a => a.getAttribute("data-t") === "BB2" && !a.getAttribute("data-item"))!);
  assert.equal(isOn("scrInspector"), true);
  assert.equal(($("#secSel") as HTMLSelectElement).value, "sec-decision-log");
  assert.equal($$("#rail [data-key]").find(r => r.getAttribute("aria-current") === "true")!.getAttribute("data-key"), "BB2");
  assert.equal(hashes[hashes.length - 1], "#t=BB2&s=sec-decision-log");
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
  assert.equal(entry("AA1").getAttribute("aria-current") === "true", true);
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
  assert.equal(entry("BB2").getAttribute("aria-current") === "true", true);
  assert.equal(hashes[hashes.length - 1], "#t=BB2&s=sec-obligation-ticket-list&item=OT-BB2-1");
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
  assert.equal(entry("AA1").getAttribute("aria-current") === "true", true);
  assert.equal(isOn("scrWatch"), true);
});

test("a dead ticket link takes no default selection", async () => {
  await bootBoard({hash: "#t=ZZ9"});
  assert.equal($$("#rail [data-key]").some(r => r.getAttribute("aria-current") === "true"), false);
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
  assert.equal($$("#rail [data-key]").length, 1);
  assert.match((await about())[0]!, /1 tickets/);
});

test("a broken stream or a failed reload marks the corpus CACHED, and a reopen recovers it", async () => {
  const live = liveCorpus(LISTING, TEXTS);
  const {feed} = await bootBoard({fetch: live.fetch});
  assert.equal($("#liveTxt").textContent, "WATCHING");
  await act(async () => { feed.onerror!(); });
  assert.equal($("#liveTxt").textContent, "CACHED");
  // PM7: the dot goes hollow and the word and the last update time say why.
  assert.equal($(".adp-livedot").className, "adp-livedot adp-livedot--cached");
  assert.match($(".adp-topbar__since").textContent!, /^last update \d\d:\d\d · reconnecting$/);
  assert.equal($("#liveTxt").getAttribute("role"), "status");
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
  assert.equal($("[data-part=name]").textContent, "");
  live.down = false;
  await act(async () => { feed.onopen!(); });
  await settle();
  assert.equal(entry("AA1").getAttribute("aria-current") === "true", true);
  assert.equal(hashes[hashes.length - 1], "#t=AA1&s=sec-decision-log&item=DL-002");
});

test("a boot that failed takes the default selection when the corpus first answers", async () => {
  const live = liveCorpus(LISTING, TEXTS);
  live.down = true;
  const {feed, hashes} = await boot({fetch: live.fetch});
  assert.equal($$("#rail [data-key]").length, 0);
  live.down = false;
  await act(async () => { feed.onopen!(); });
  await settle();
  const first = $$("#rail [data-key]")[0].getAttribute("data-key");
  assert.deepEqual(marked(), [first]);
  assert.equal(hashes[hashes.length - 1], "#t=" + first + "&s=sec-decision-log");
});

test("a boot that failed honors the screen token at once and the ticket token when the corpus answers", async () => {
  const live = liveCorpus(LISTING, TEXTS);
  live.down = true;
  const {feed} = await boot({fetch: live.fetch, hash: "#v=watchboard&t=AA1"});
  assert.equal($("#scrWatch").classList.contains("is-on"), true);
  live.down = false;
  await act(async () => { feed.onopen!(); });
  await settle();
  assert.equal($("#scrWatch").classList.contains("is-on"), true);
  assert.deepEqual(marked(), ["AA1"]);
});

test("a served page with no corpus directory probes quietly", async () => {
  const warn = vi.spyOn(console, "warn");
  const {feed} = await boot({fetch: () => miss()});
  await act(async () => { feed.onopen!(); });
  await settle();
  assert.equal(warn.mock.calls.length, 0);
  assert.equal($("[data-part=name]").textContent, "");
});

// The server answers 404 for the listing while the repo has no .adp/ folder.
test("a repo with no .adp/ folder shows the empty page, not the failed one, until a log appears", async () => {
  const live = liveCorpus(LISTING, TEXTS);
  let made = false;
  const fetch = (u: string) => made ? live.fetch(u) : Promise.resolve({ok: false, status: 404} as FetchResponse);
  const {feed} = await boot({fetch});
  await act(async () => { feed.onopen!(); });
  await settle();
  assert.equal($("#statusPage")?.getAttribute("data-status"), "empty");
  assert.equal($("#liveTxt").textContent, "IDLE");
  assert.equal($("#liveTxt").style.color, "var(--dim)");
  assert.equal($(".adp-livedot").style.boxShadow, "inset 0 0 0 2px var(--faint)");
  assert.ok(!$(".adp-topbar__since"), "a repo with no logs shows no failure note");
  made = true;
  await act(async () => { feed.onmessage!(); });
  await settle();
  assert.ok(!$("#statusPage"), "the first log replaces the empty page");
  assert.equal($("#liveTxt").textContent, "WATCHING");
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
  assert.deepEqual($$("#rail [data-key]").map(r => r.getAttribute("data-key")).sort(), ["A-001-one", "A-001-two"]);
  await click(entry("A-001-two"));
  const marked = () => $$("#rail [data-key]").filter(r => r.getAttribute("aria-current") === "true").map(r => r.getAttribute("data-key"));
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
  assert.equal($$("#rail [data-key]").some(r => r.getAttribute("aria-current") === "true"), false);
});

// Each log names its own decision, so a test can tell which one the
// inspector shows.
const SHARED_TEXTS: Record<string, string> = {};
for (const w of ["one", "two"]) SHARED_TEXTS["A-001-" + w + "/audit-log.md"] =
  LOG.replace("# Audit Log — AA1 alpha", "# Audit Log — " + w).replace("First decision", "Decision of " + w).replace(/OT-AA1-/g, "OT-A001-");
const SHARED = {root: "demo", files: ["A-001-one/audit-log.md", "A-001-two/audit-log.md"]};

test("a hash for the second shared-id ticket reopens it", async () => {
  await boot({hash: "#t=A-001-two", fetch: liveCorpus(SHARED, SHARED_TEXTS).fetch});
  assert.deepEqual(marked(), ["A-001-two"]);
});

test("a directory hash for a ticket whose id is now unique marks its rail row", async () => {
  await boot({hash: "#t=A-001-two", fetch: liveCorpus({root: "demo", files: ["A-001-two/audit-log.md"]}, SHARED_TEXTS).fetch});
  assert.deepEqual(marked(), ["A001"]);
});

test("a rail click on each shared-id ticket opens that directory", async () => {
  const {hashes} = await boot({fetch: liveCorpus(SHARED, SHARED_TEXTS).fetch});
  for (const word of ["one", "two"]){
    await click(entry("A-001-" + word));
    assert.match($("#scrInspector").innerHTML, new RegExp("Decision of " + word));
    assert.equal(hashes[hashes.length - 1], "#t=A-001-" + word + "&s=sec-decision-log");
  }
});

test("board and ledger links on shared-id tickets land on their own directories", async () => {
  const {hashes} = await boot({fetch: liveCorpus(SHARED, SHARED_TEXTS).fetch});
  for (const word of ["one", "two"]){
    await click(tabFor("watchboard"));
    await click($$(".wbl").find(a => a.getAttribute("data-t") === "A-001-" + word && a.getAttribute("data-item") === "OT-A001-1")!);
    assert.equal(isOn("scrInspector"), true);
    assert.equal(($("#secSel") as HTMLSelectElement).value, "sec-obligation-ticket-list");
    assert.deepEqual(marked(), ["A-001-" + word]);
    assert.equal(hashes[hashes.length - 1], "#t=A-001-" + word + "&s=sec-obligation-ticket-list&item=OT-A001-1");
    await click(tabFor("ledgers"));
    await click($$(".wbl").find(a => a.getAttribute("data-t") === "A-001-" + word && a.getAttribute("data-item") === "DL-001")!);
    assert.equal(isOn("scrInspector"), true);
    assert.match($("#scrInspector").innerHTML, new RegExp("Decision of " + word));
  }
});

// ---- the Tickets view before a ticket exists ----

const statusOf = () => $("#statusPage")?.getAttribute("data-status") ?? null;

test("while the first load runs, Tickets says it is building the index and shows no rail", async () => {
  await boot();
  assert.equal(statusOf(), "loading");
  assert.equal($("#rail"), null);
  assert.equal($("#statusPage h1").getAttribute("role"), "status");
  assert.match($("#statusPage").textContent!, /Building the index from the working tree/);
  assert.equal($(".adp-empty__path").textContent, "Reading .adp/");
  assert.equal($("#liveTxt").style.color, "var(--dim)");
  assert.ok(!$(".adp-topbar__since"), "a load still running shows no failure note");
});

// DL-027 V1: each status page sits in the middle of the stage, as the boards draw it.
test("a status page centers in a stage that lays it out as a column", async () => {
  await boot();
  assert.equal($(".main").style.display, "flex");
  assert.equal($(".main").style.flexDirection, "column");
  assert.equal($("#statusPage").style.margin, "auto");
});

test("a first load that fails says the server stopped answering, and Retry runs one more load", async () => {
  const live = liveCorpus(LISTING, TEXTS);
  live.down = true;
  await boot({fetch: live.fetch});
  assert.equal(statusOf(), "failed");
  assert.match($("#statusPage").textContent!, /server on .* stopped answering before the index arrived/);
  assert.ok(!$(".adp-empty__mark"), "the failed page draws no mark");
  assert.equal($(".adp-empty__path").textContent, "Watching .adp/");
  // DL-029: the word stays IDLE, and the bar marks the failure beside it.
  assert.equal($("#liveTxt").textContent, "IDLE");
  assert.equal($("#liveTxt").style.color, "var(--bad)");
  assert.equal($(".adp-livedot").style.boxShadow, "inset 0 0 0 2px var(--bad)");
  assert.equal($(".adp-topbar__since").textContent, "no index yet · retrying");
  live.down = false;
  await click($("#retryBtn"));
  await settle();
  assert.equal(statusOf(), null);
  assert.ok($$("#rail [data-key]").length > 0);
});

test("a repo with no logs offers New task and the bootstrap pack, and names the folder it watches", async () => {
  await boot({fetch: packsFetch(liveCorpus({root: "demo", files: []}, {}).fetch)});
  assert.equal(statusOf(), "empty");
  assert.match($("#statusPage").textContent!, /No audit logs in this repo yet/);
  assert.equal($(".adp-empty__path").textContent, "Watching demo/.adp/");
  assert.equal($("#statusPage .adp-empty__text code.adp-code").textContent, ".adp/");
  await click($$("#statusPage button").find(b => /Bootstrap pack/.test(b.textContent!))!);
  assert.deepEqual(selectedPacks(), ["bootstrap-project"]);
  await key(document.activeElement!, "Escape");
  await click($$("#statusPage button").find(b => b.textContent === "+ New task")!);
  assert.equal(isOn("scrNew"), true);
});

test("the other views still render while Tickets has nothing to show", async () => {
  await boot();
  await click(tabFor("watchboard"));
  assert.equal(statusOf(), null);
  assert.equal(isOn("scrWatch"), true);
});

// ---- the top bar's fold and its menu ----

/* jsdom has no layout, so a test sets the widths by hand. The bar adds up
   the widths its full row needs. With every part at zero that sum is 164px
   of padding, gaps, and the dot, so the actions block carries the rest. */
function barNeeds(need: number, client: number){
  const bar = $("#topbar");
  Object.defineProperty(bar, "clientWidth", {configurable: true, get: () => client});
  Object.defineProperty(bar.querySelector(".adp-topbar__actions")!, "scrollWidth", {configurable: true, get: () => need - 164});
  return bar;
}
const resize = async () => { await act(async () => { window.dispatchEvent(new Event("resize")); }); };
const folded = () => $("#topbar .adp-nav").style.flexBasis === "100%";

test("the bar folds its views onto a second row only while the full row overflows", async () => {
  await boot();
  // The zero floor keeps an overflowing row inside the bar, and a bar that
  // is not positioned leaves the film grain over it.
  assert.equal($("#topbar").style.minWidth, "0px");
  assert.equal($("#topbar").style.position, "");
  assert.equal(folded(), false);
  barNeeds(1080, 705);
  await resize();
  assert.equal(folded(), true);
  assert.equal($(".adp-topbar__product").style.visibility, "hidden");
  barNeeds(1085, 1085);
  await resize();
  assert.equal(folded(), false);
});

test("every path that rewrites the bar's text measures it again", async () => {
  const live = liveCorpus(LISTING, TEXTS);
  const {feed} = await boot({fetch: live.fetch});
  barNeeds(1080, 705);
  await click(tabFor("watchboard"));
  assert.equal(folded(), true);
  barNeeds(705, 705);
  await click($("#newTaskBtn"));
  assert.equal(folded(), false);
  barNeeds(1080, 705);
  live.down = true;
  await act(async () => { feed.onmessage!(); });
  await settle();
  assert.equal($("#liveTxt").textContent, "CACHED");
  assert.equal(folded(), true);
});

test("the bar measures again when the web fonts finish loading", async () => {
  // jsdom has no FontFaceSet, so we stand one in with a ready promise we settle by hand.
  let ready!: () => void;
  const fonts = Object.assign(new EventTarget(), {ready: new Promise<void>(r => { ready = r; })});
  Object.defineProperty(document, "fonts", {configurable: true, get: () => fonts});
  try {
    await boot();
    barNeeds(1080, 705);
    assert.equal(folded(), false);
    await act(async () => { ready(); await fonts.ready; });
    assert.equal(folded(), true);
    barNeeds(705, 705);
    await act(async () => { fonts.dispatchEvent(new Event("loadingdone")); });
    assert.equal(folded(), false);
  } finally {
    delete (document as {fonts?: unknown}).fonts;
  }
});

test("the ⋯ button opens the menu and says so", async () => {
  await boot();
  assert.equal($("#hdrMenu"), null);
  await click($("#menuBtn"));
  assert.ok($("#hdrMenu"));
  assert.equal($("#menuBtn").getAttribute("aria-expanded"), "true");
  assert.equal($("#topbar").style.position, "relative");
  assert.equal($("#menuBtn").style.background, "var(--panel-2)");
  assert.equal($("#menuBtn").style.borderColor, "var(--line-bright)");
  await click($("#menuBtn"));
  assert.equal($("#menuBtn").style.background, "");
  assert.equal($("#hdrMenu"), null);
  assert.equal($("#menuBtn").getAttribute("aria-expanded"), "false");
});

// DL-009: the menu lists a shortcut only once it works.
test("the menu lists the shortcuts that work, and f flips the ticket between section and full log", async () => {
  await bootBoard();
  await click($("#menuBtn"));
  assert.deepEqual([...$("#hdrMenu").querySelectorAll(".adp-keys dt, .adp-keys dd")].map(e => e.textContent),
    ["[", "Show or hide tickets", "← →", "Previous or next phase", "/", "Filter tickets", "f", "Section or full log"]);
  await key(document.body, "Escape");
  assert.equal(op("data-view", "section").getAttribute("aria-pressed") === "true", true);
  await key(document.body, "f");
  assert.equal(op("data-view", "full").getAttribute("aria-pressed") === "true", true);
  await key(document.body, "f");
  assert.equal(op("data-view", "section").getAttribute("aria-pressed") === "true", true);
});

test("f does nothing while the reader types in a field or another view shows", async () => {
  await bootBoard();
  const field = document.createElement("input");
  document.body.append(field);
  await key(field, "f");
  assert.equal(op("data-view", "section").getAttribute("aria-pressed") === "true", true);
  field.remove();
  await click(tabFor("watchboard"));
  await key(document.body, "f");
  await click(tabFor("inspector"));
  assert.equal(op("data-view", "section").getAttribute("aria-pressed") === "true", true);
});

test("Escape closes the open menu and hands focus to the ⋯ button", async () => {
  await boot();
  await click($("#menuBtn"));
  themeOpt("dark").focus();
  await key(themeOpt("dark"), "Escape");
  assert.equal($("#hdrMenu"), null);
  same(document.activeElement, $("#menuBtn"), "focus is not on the ⋯ button");
});

test("a click outside the menu closes it and leaves focus alone", async () => {
  await bootBoard();
  await click($("#menuBtn"));
  $("#rail").tabIndex = -1;
  $("#rail").focus();
  await click($("#rail"));
  assert.equal($("#hdrMenu"), null);
  same(document.activeElement, $("#rail"), "focus left the rail");
});

// ---- the inspector ----

/* The vanilla inspector tests ran over AA1 with its prompt and a
   prompt-only AV002, so the carried tests run over the same corpus. */
const PROMPT_AA1 = ['schema_version: "1.0"', "task:", '  id: "20260101-AA1-alpha"', '  title: "AA1 alpha"',
  '  author: "rbeye"', '  date: "2026-01-01"', "prompt: |", "  Make the **alpha** path work.", "  Keep it small.", ""].join("\n");
const PROMPT_AV2 = PROMPT_AA1.replace('"20260101-AA1-alpha"', '"AV-002-beta"').replace("AA1 alpha", "beta brief");
const LISTING_I = {root: "demo", files: ["20260101-AA1-alpha/audit-log.md", "20260101-AA1-alpha/prompt.yaml", "AV-002-beta/prompt.yaml"]};
const TEXTS_I: Record<string, string> = {"20260101-AA1-alpha/audit-log.md": LOG,
  "20260101-AA1-alpha/prompt.yaml": PROMPT_AA1, "AV-002-beta/prompt.yaml": PROMPT_AV2};
const bootCorpus = (opts: BootOpts = {}) => boot({fetch: liveCorpus(LISTING_I, TEXTS_I).fetch, ...opts});
// The control that carries one data attribute value, an op button or a view segment.
const op = (attr: string, v: string) => $$(`[${attr}]`).find(o => o.getAttribute(attr) === v)!;
const secVal = () => ($("#secSel") as HTMLSelectElement).value;
const insp = () => $("#scrInspector").innerHTML;
const last = (hashes: string[]) => hashes[hashes.length - 1];

// jsdom has no scrollIntoView, so a test that checks a jump installs one
// that records which elements asked to scroll.
function recordScrolls(){
  const seen: Element[] = [];
  Element.prototype.scrollIntoView = function(this: Element){ seen.push(this); };
  return seen;
}
function stubClipboard(write?: (t: string) => Promise<void>){
  const got: string[] = [];
  Object.defineProperty(navigator, "clipboard", {configurable: true,
    value: {writeText: write || (async (t: string) => { got.push(t); })}});
  return got;
}
afterEach(() => {
  delete (Element.prototype as {scrollIntoView?: unknown}).scrollIntoView;
  delete (navigator as {clipboard?: unknown}).clipboard;
});

test("the corpus boot selects the first rail entry; a full ticket renders its spine", async () => {
  const {hashes} = await bootCorpus();
  // AA1 is actionable attention, and AV002 is a prompt-only ticket still in
  // flight, so it sits in the open group with its missing-sections ribbon intact.
  assert.match($("#rail").innerHTML, /data-sec="open"[\s\S]*AV002/);
  assert.match($("#rail").innerHTML, /9 SECTIONS MISSING/);
  const scr = insp();
  // The section body went through the parser library's Decision Log renderer.
  assert.match(scr, /class="adp-dl-list"/);
  assert.match(scr, /DL-001/);
  // The nav lists the prompt, 5 real sections, and 5 missing canonicals.
  assert.equal($$("#secSel option").length, 11);
  assert.equal(secVal(), "sec-decision-log");
  assert.equal($("#tickHead .adp-chip").textContent, "shipped");
  assert.equal($("#tickHead .adp-chip + .adp-meta").textContent, "inferred from the log");
  assert.match(scr, /decisions cited by Decision Log/);
  assert.match(scr, /open 1/);
  assert.match(scr, /validated 1/);
  assert.equal(last(hashes), "#t=AA1&s=sec-decision-log");
});

test("section navigation steps, drops, and marks section states", async () => {
  const {hashes} = await bootCorpus();
  await click(entry("AA1"));
  const html = $("#secSel").innerHTML;
  assert.match(html, /Aside Notes — non-canonical/);
  assert.match(html, /Knowledge Gap — missing/);
  assert.match(html, /Obligation Ticket List — unanchored watches/);
  // Next from the spine lands on the non-canonical section.
  await click(op("data-secstep", "1"));
  assert.equal(secVal(), "sec-aside-notes");
  assert.match(insp(), /non-canonical/);
  await pickSection("sec-pr-summary");
  assert.equal(last(hashes), "#t=AA1&s=sec-pr-summary");
});

test("a phase-scoped section shows only what it cites, with backlink chips", async () => {
  await bootCorpus();
  await click(entry("AA1"));
  await pickSection("sec-pr-summary");
  const scr = insp();
  assert.match(scr, /decisions cited by PR Summary/);
  assert.ok(scr.includes("DL-001"));
  assert.ok(!scr.includes(`data-dl="DL-002"`));
  assert.match(scr, /watches cited by PR Summary/);
  assert.ok(scr.includes("OT-AA1-2"));
  assert.ok(!scr.includes(`data-item="OT-AA1-1"`));
  assert.match(scr, /class="pc"/);
});

test("a backlink chip names an ad hoc section by its kind instead of §", async () => {
  await bootCorpus();
  await click(entry("AA1"));
  const scr = insp();
  assert.match(scr, /data-key="sec-aside-notes"[^>]*>ad-hoc</);
  assert.match(scr, /data-key="sec-obligation-ticket-list"[^>]*>P9</);
  assert.ok(!/>§</.test(scr));
});

test("a decision row opens its card and the back link returns", async () => {
  const scrolls = recordScrolls();
  const {hashes} = await bootCorpus();
  await click(entry("AA1"));
  await click($$(".dlrow").find(r => r.getAttribute("data-dl") === "DL-002")!);
  assert.match(insp(), /\[DL-002\]/);
  assert.match(insp(), /back to Decision Log/);
  // The link scrolls the reader back to the nav and the content it changed.
  assert.equal(scrolls.filter(e => e.classList.contains("secnav")).length, 1);
  assert.equal(last(hashes), "#t=AA1&s=sec-decision-log&item=DL-002");
  await click($('#scrInspector [data-op="back"]'));
  assert.ok(!$('#scrInspector [data-op="back"]'), "the back link stays after it went back");
  assert.equal(last(hashes), "#t=AA1&s=sec-decision-log");
});

test("a watch link jumps to the obligation section with the row highlighted", async () => {
  const scrolls = recordScrolls();
  const {hashes} = await bootCorpus();
  await click(entry("AA1"));
  await click($$(".wl").find(w => w.getAttribute("data-item") === "OT-AA1-1")!);
  assert.equal(secVal(), "sec-obligation-ticket-list");
  assert.match(insp(), /is-hl/);
  assert.equal(scrolls.filter(e => e.classList.contains("secnav")).length, 1);
  assert.match(insp(), /UNANCHORED/);
  assert.equal(last(hashes), "#t=AA1&s=sec-obligation-ticket-list&item=OT-AA1-1");
});

test("the status pills filter the decisions table", async () => {
  await bootCorpus();
  await click(entry("AA1"));
  await click($$(".fpill").find(p => p.getAttribute("data-dlf") === "open")!);
  assert.ok(insp().includes(`data-dl="DL-002"`));
  assert.ok(!insp().includes(`data-dl="DL-001"`));
});

// React keeps the DOM nodes across a render, so the control a reader
// pressed is the control that still holds focus (DL-057).
test("a filter pill keeps the keyboard through its own re-render", async () => {
  await bootCorpus();
  await click(entry("AA1"));
  const pill = $$(".fpill").find(p => p.getAttribute("data-dlf") === "open")!;
  pill.focus();
  await click(pill);
  same(document.activeElement, pill, "focus left the pill it pressed");
  assert.ok($$(".fpill").includes(pill));
});

test("the section dropdown keeps focus across its change re-render", async () => {
  await bootCorpus();
  await click(entry("AA1"));
  $("#secSel").focus();
  await pickSection("sec-pr-summary");
  same(document.activeElement, $("#secSel"), "focus left the section selector");
});

test("a header click sorts the decisions table and flips on repeat", async () => {
  await bootCorpus();
  await click(entry("AA1"));
  const conf = () => $$(".sth").find(t => t.getAttribute("data-k") === "conf")!;
  await click(conf());
  assert.deepEqual($$(".dlrow").map(r => r.getAttribute("data-dl")), ["DL-002", "DL-001"]);
  await click(conf());
  assert.deepEqual($$(".dlrow").map(r => r.getAttribute("data-dl")), ["DL-001", "DL-002"]);
});

test("the full-log view renders every real section as a collapsible", async () => {
  await bootCorpus();
  await click(entry("AA1"));
  await click(op("data-view", "full"));
  const secs = $$(".fsec") as HTMLDetailsElement[];
  // The prompt block heads the five real sections.
  assert.equal(secs.length, 6);
  assert.equal(secs[0].getAttribute("data-key"), "prompt");
  assert.ok(secs.every(s => s.open));
  await click(op("data-exp", "close"));
  assert.ok(($$(".fsec") as HTMLDetailsElement[]).every(s => s.open === false));
  await click(op("data-exp", "open"));
  assert.ok(($$(".fsec") as HTMLDetailsElement[]).every(s => s.open));
});

test("a prompt-only ticket picked from the rail opens on its prompt", async () => {
  await bootCorpus();
  await click(entry("AV002"));
  assert.equal(secVal(), "prompt");
});

test("the permalink control copies the current address", async () => {
  const got = stubClipboard();
  await bootCorpus();
  await click(entry("AA1"));
  await click($("[data-permalink]"));
  assert.equal(got.length, 1);
  assert.match(got[0], /#t=AA1&s=sec-decision-log$/);
  assert.equal($("[data-permalink]").textContent, "copied");
});

test("a hash set before boot lands the named view with the item highlighted", async () => {
  await bootCorpus({hash: "#t=AA1&s=sec-pr-summary&item=DL-001"});
  assert.equal(secVal(), "sec-pr-summary");
  assert.match(insp(), /\[DL-001\]/);
  assert.match(insp(), /is-hl/);
});

test("an item-only link lands on the item's owning section", async () => {
  await bootCorpus({hash: "#t=AA1&item=OT-AA1-2"});
  assert.equal(secVal(), "sec-obligation-ticket-list");
  assert.match(insp(), /is-hl/);
});

test("a link to a vanished section falls back with a visible notice", async () => {
  await bootCorpus({hash: "#t=AA1&s=sec-retitled-away"});
  assert.match(insp(), /was not found in this log/);
  assert.equal(secVal(), "sec-decision-log");
});

/* Every hash the full fixture ticket could write before the prompt entry
   existed, with the section and heading each one opened then. The vanilla
   test captured the pairs from the page at 8cb020a. */
const PINNED_LANDINGS = [
  ["sec-problem-statement", "phase 1 · Problem Statement"],
  ["sec-decision-log", "phase 5 · Decision Log"],
  ["sec-aside-notes", "Aside Notes"],
  ["sec-pr-summary", "phase 7 · PR Summary"],
  ["sec-obligation-ticket-list", "phase 9 · Obligation Ticket List"],
  ["missing:Knowledge Gap", "phase 2 · Knowledge Gap"],
  ["missing:Recommendation Brief", "phase 3 · Recommendation Brief"],
  ["missing:Pre-Mortem Report", "phase 4 · Pre-Mortem Report"],
  ["missing:Test Adversary", "phase 6 · Test Adversary"],
  ["missing:Deployment Risk", "phase 8 · Deployment Risk"]
];

test("every section hash lands where it landed before the prompt entry", async () => {
  for (const [key, heading] of PINNED_LANDINGS){
    await bootCorpus({hash: "#t=AA1&s=" + encodeURIComponent(key)});
    assert.equal(secVal(), key);
    assert.match(insp(), new RegExp('<h2 class="adp-section"[^>]*>' + heading + "<"));
    assert.doesNotMatch(insp(), /was not found in this log/);
    cleanup();
    vi.restoreAllMocks();
  }
  const {hashes} = await bootCorpus({hash: "#t=AA1"});
  assert.equal(secVal(), "sec-decision-log");
  assert.equal(last(hashes), "#t=AA1&s=sec-decision-log");
});

test("a link to an absent ticket shows a notice instead of a silent default", async () => {
  await bootCorpus({hash: "#t=ZZZ"});
  assert.match(insp(), /"ZZZ" is not in this corpus/);
});

test("a link to a shared id names how many tickets carry it", async () => {
  await boot({hash: "#t=A001", fetch: liveCorpus(SHARED, SHARED_TEXTS).fetch});
  assert.match(insp(), /"A001" names 2 tickets in this corpus — pick one from the rail\./);
});

/* The vanilla test pasted this log. The app reads logs from the served
   corpus alone, so the same hostile text arrives as a served log. */
const HOSTILE = ["## <img src=x onerror=alert(1)> Evil Section", "", "<script>alert(2)</script>", "",
  "## Decision Log", "", "### [DL-001] <img src=y> title", "- **Decision:** <script>alert(3)</script>",
  '- **Confidence:** HIGH" onmouseover="alert(1)', "- **Status:** OPEN", ""].join("\n");

test("a hostile served log never lands markup in the page", async () => {
  await boot({fetch: liveCorpus({root: "demo", files: ["20260101-EV1-evil/audit-log.md"]},
    {"20260101-EV1-evil/audit-log.md": HOSTILE}).fetch});
  await click(entry("EV1"));
  for (const s of options()){
    await pickSection(s);
    assert.ok(!$("#rail").innerHTML.includes("<img"), s);
    assert.ok(!insp().includes("<img"), s);
    assert.ok(!insp().includes("<script"), s);
  }
  // The quote-bearing confidence lands in the decisions panel as the
  // cf-high class and inert cell text, and no tag carries the handler.
  await pickSection("sec-decision-log");
  assert.match(insp(), /class="cf-high nw"/);
  assert.ok(!/<[^>]*onmouseover/.test(insp()));
  assert.ok(!/<[^>]*onmouseover/.test($("#rail").innerHTML));
  await click(op("data-view", "full"));
  assert.ok(!insp().includes("<img"));
  assert.ok(!insp().includes("<script"));
});

test("an entry housed outside the spine still opens as a card", async () => {
  const log = ["## Decision Log", "", "(entries arrive in review responses)", "",
    "## Review Response — PR #1", "", "### [DL-009] Late ruling", "- **Decision:** re-cut", "- **Status:** OPEN", ""].join("\n");
  await boot({fetch: liveCorpus({root: "demo", files: ["20260101-LT1-late/audit-log.md"]}, {"20260101-LT1-late/audit-log.md": log}).fetch});
  await click(entry("LT1"));
  await click($$(".dlrow").find(r => r.getAttribute("data-dl") === "DL-009")!);
  assert.match(insp(), /\[DL-009\]/);
  assert.match(insp(), /class="adp-dl[ "]/);
  assert.ok(!insp().includes("not present in the loaded text"));
});

test("in the full log, the section selector jumps to the section and opens it", async () => {
  const scrolls = recordScrolls();
  const {hashes} = await bootCorpus();
  await click(entry("AA1"));
  await click(op("data-view", "full"));
  await click(op("data-exp", "close"));
  assert.ok(($$(".fsec") as HTMLDetailsElement[]).every(s => s.open === false));
  await pickSection("sec-pr-summary");
  const secs = $$(".fsec") as HTMLDetailsElement[];
  const target = secs.find(s => s.getAttribute("data-key") === "sec-pr-summary")!;
  assert.equal(target.open, true);
  assert.equal(scrolls.filter(e => e === target).length, 1);
  // The jump opens its target alone, and the rest keep their collapsed state.
  assert.ok(secs.filter(s => s !== target).every(s => s.open === false));
  assert.equal(last(hashes), "#t=AA1&s=sec-pr-summary");
});

test("prev/next in the full log jump too, and manual toggles survive renders", async () => {
  const scrolls = recordScrolls();
  await bootCorpus();
  await click(entry("AA1"));
  await click(op("data-view", "full"));
  const fsec = (k: string) => ($$(".fsec") as HTMLDetailsElement[]).find(s => s.getAttribute("data-key") === k)!;
  await click(fsec("sec-problem-statement").querySelector(".fsum")!);
  assert.equal(fsec("sec-problem-statement").open, false);
  await click(op("data-secstep", "1"));
  assert.equal(secVal(), "sec-aside-notes");
  assert.equal(fsec("sec-problem-statement").open, false);
  assert.equal(fsec("sec-aside-notes").open, true);
  assert.equal(scrolls.filter(e => e === fsec("sec-aside-notes")).length, 1);
});

test("a jump scrolls once, and a screen that mounts again does not replay it", async () => {
  const scrolls = recordScrolls();
  await bootCorpus();
  await click(entry("AA1"));
  await click($$(".dlrow").find(r => r.getAttribute("data-dl") === "DL-002")!);
  assert.equal(scrolls.length, 1);
  await click(tabFor("watchboard"));
  await click(tabFor("inspector"));
  assert.equal(scrolls.length, 1);
});

/* V15: the full log marks the section in view as the stage scrolls. jsdom
   has no layout, so the test places each section by hand: the stage's top
   sits at 100 and each section sits 300 below the last. */
test("the scroll spy names the full-log section that reached the top of the stage", async () => {
  const {hashes} = await bootCorpus();
  await click(entry("AA1"));
  await click(op("data-view", "full"));
  const stage = $(".stage");
  let scrolled = 0;
  const rect = (top: number) => ({top, bottom: top + 300, left: 0, right: 0, width: 0, height: 300, x: 0, y: top, toJSON(){}}) as DOMRect;
  stage.getBoundingClientRect = () => rect(100);
  // A stage far from its end, so the spy holds no picked section.
  Object.defineProperty(stage, "scrollHeight", {configurable: true, value: 100000});
  $$(".fsec").forEach((s, i) => { s.getBoundingClientRect = () => rect(100 + i * 300 - scrolled); });
  const scrollTo = async (y: number) => {
    scrolled = y;
    fireEvent.scroll(stage);
    await act(async () => { await new Promise(r => requestAnimationFrame(() => r(null))); });
    await settle(1);
  };
  // The keys run prompt, problem statement, decision log, aside notes, and
  // so on, 300 apart. A section counts once its top is no more than 20
  // below the stage's top.
  await scrollTo(599 - SPY_SLACK);
  assert.equal(secVal(), "sec-problem-statement");
  await scrollTo(600 - SPY_SLACK);
  assert.equal(secVal(), "sec-decision-log");
  assert.equal(last(hashes), "#t=AA1&s=sec-decision-log");
  await scrollTo(905);
  assert.equal(secVal(), "sec-aside-notes");
  assert.equal(last(hashes), "#t=AA1&s=sec-aside-notes");
  // The section view has one section, so its scroll marks nothing.
  await click(op("data-view", "section"));
  await scrollTo(0);
  assert.equal(secVal(), "sec-aside-notes");
});

/* A fake observer stands in for the browser's: it reports once when it
   starts, as the browser's does, and the test calls it again to stand for
   a font that loads and moves the sections with no scroll event. */
test("the scroll spy marks again when the full log's size changes without a scroll", async () => {
  const reports: (() => void)[] = [];
  vi.stubGlobal("ResizeObserver", class {
    cb: () => void;
    constructor(cb: () => void){ this.cb = cb; }
    observe(){ reports.push(this.cb); this.cb(); }
    disconnect(){}
  });
  try {
    await bootCorpus();
    await click(entry("AA1"));
    const opened = secVal();
    await click(op("data-view", "full"));
    // jsdom places every section at 0, so a spy run here would mark the
    // last. A size change before the first scroll keeps the selection.
    reports.forEach(cb => cb());
    await act(async () => { await new Promise(r => requestAnimationFrame(() => r(null))); });
    assert.equal(secVal(), opened);
    const stage = $(".stage");
    let shift = 0;
    const rect = (top: number) => ({top, bottom: top + 300, left: 0, right: 0, width: 0, height: 300, x: 0, y: top, toJSON(){}}) as DOMRect;
    stage.getBoundingClientRect = () => rect(100);
    Object.defineProperty(stage, "scrollHeight", {configurable: true, value: 100000});
    $$(".fsec").forEach((s, i) => { s.getBoundingClientRect = () => rect(100 + i * 300 - 599 + SPY_SLACK - shift); });
    const frame = async () => { await act(async () => { await new Promise(r => requestAnimationFrame(() => r(null))); }); await settle(1); };
    fireEvent.scroll(stage);
    await frame();
    assert.equal(secVal(), "sec-problem-statement");
    shift = 10;
    assert.ok(reports.length > 0);
    reports.forEach(cb => cb());
    await frame();
    assert.equal(secVal(), "sec-decision-log");
  } finally {
    vi.unstubAllGlobals();
  }
});

/* A rail pick keeps the full log on, and the new ticket's log has not been
   scrolled yet. Its size report must keep the section the pick opened, as
   the first report on any full log does. Only the newest observer counts,
   because a real one stops reporting once it is disconnected. */
test("a rail pick in the full log starts the scroll spy over, so a size change before the next scroll keeps the selection", async () => {
  const reports: (() => void)[] = [];
  vi.stubGlobal("ResizeObserver", class {
    cb: () => void;
    constructor(cb: () => void){ this.cb = cb; }
    observe(){ reports.push(this.cb); this.cb(); }
    disconnect(){}
  });
  try {
    // Two tickets that both hold a log, so the full log stays on through the pick.
    await boot({fetch: liveCorpus(LISTING, TEXTS).fetch});
    await click(entry("AA1"));
    await click(op("data-view", "full"));
    const frame = async () => { await act(async () => { await new Promise(r => requestAnimationFrame(() => r(null))); }); await settle(1); };
    fireEvent.scroll($(".stage"));
    await frame();
    await click(entry("BB2"));
    assert.ok($$(".fsec").length > 1, "the pick kept the full log on");
    const opened = secVal();
    // jsdom places every section at 0, so a spy run here would mark the last.
    reports.at(-1)!();
    await frame();
    assert.equal(secVal(), opened);
  } finally {
    vi.unstubAllGlobals();
  }
});

/* A short section at the end of a log never reaches the top of the stage.
   The stage here is 600 tall and scrolled to its end, with the last
   section's top at 400, so the spy alone would name the one before it. */
test("a pick or a step onto a section that cannot reach the stage's top survives the scroll it causes", async () => {
  recordScrolls();
  const {hashes} = await bootCorpus();
  await click(entry("AA1"));
  await click(op("data-view", "full"));
  const stage = $(".stage");
  const secs = $$(".fsec");
  const keys = secs.map(s => s.getAttribute("data-key")!);
  const n = secs.length;
  let scrolled = 0;
  const rect = (top: number, height: number) => ({top, bottom: top + height, left: 0, right: 0, width: 0, height, x: 0, y: top, toJSON(){}}) as DOMRect;
  stage.getBoundingClientRect = () => rect(100, 600);
  secs.forEach((s, i) => { s.getBoundingClientRect = () => rect(100 + i * 300 - scrolled, 300); });
  const end = (n - 1) * 300 - 300;
  Object.defineProperty(stage, "clientHeight", {configurable: true, value: 600});
  Object.defineProperty(stage, "scrollHeight", {configurable: true, value: end + 600});
  const scrollTo = async (y: number) => {
    scrolled = y;
    stage.scrollTop = y;
    fireEvent.scroll(stage);
    await act(async () => { await new Promise(r => requestAnimationFrame(() => r(null))); });
    await settle(1);
  };
  await pickSection(keys[n - 1]);
  await scrollTo(end);
  assert.equal(secVal(), keys[n - 1]);
  assert.equal(last(hashes), "#t=AA1&s=" + keys[n - 1]);
  // The reader's own scroll back up moves the mark again.
  await scrollTo(end - 100);
  assert.equal(secVal(), keys[n - 3]);
  await scrollTo(end);
  assert.equal(secVal(), keys[n - 2]);
  await click(op("data-secstep", "1"));
  await scrollTo(end);
  assert.equal(secVal(), keys[n - 1]);
});

// The two builder checks of the vanilla page, held against the component
// that replaced the builder.
const panelRow = (statusKind: "validated" | "open") => ({id: "DL-001", title: "t", conf: "HIGH", confKind: "high" as const, statusKind,
  watch: null, settled: {wid: "OT-1", outcome: "VALIDATED", closed: "2026-09-01"}, chips: [], hl: false});
const panelProps = {label: "x", pills: null, sort: {k: "id", d: 1}, onSort(){}, onRow(){}, onWatch(){}, onChip(){}};

test("a settled decision's watch cell keeps the id and puts the ruling on hover", () => {
  const {container} = render(createElement(DecisionsPanel, {...panelProps, rows: [panelRow("validated")]}));
  assert.ok(container.innerHTML.includes(`title="closed VALIDATED 2026-09-01">OT-1</a>`));
  // The ruled state lives in the status column, and the cell never repeats it.
  assert.ok(!container.innerHTML.includes(`st-closed`));
});

test("an open decision with only a settled watch leads with the marker", () => {
  const {container} = render(createElement(DecisionsPanel, {...panelProps, rows: [panelRow("open")]}));
  assert.ok(container.innerHTML.includes(`<span class="st-unanchored nw">no watch</span> <a class="wl"`));
  assert.ok(container.innerHTML.includes(`title="closed VALIDATED 2026-09-01"`));
});

// ---- the inspector under live updates ----

/* Two logged tickets and one prompt-only ticket, every file editable
   between events, so a test can change one ticket while the reader works
   in another. */
const LOG_BB2 = LOG.replace("AA1 alpha", "BB2 beta").replace(/OT-AA1-/g, "OT-BB2-");
const LOG_GROWN = LOG.replace("## Aside Notes", "## Test Adversary Document\n\nGrown while watched.\n\n## Aside Notes");
const twoTickets = () => liveCorpus({root: "demo", files: ["20260101-AA1-alpha/audit-log.md",
  "20260101-BB2-beta/audit-log.md", "20260101-CC3-gamma/prompt.yaml"]}, {"20260101-AA1-alpha/audit-log.md": LOG,
  "20260101-BB2-beta/audit-log.md": LOG_BB2, "20260101-CC3-gamma/prompt.yaml": PROMPT_AA1.replace(/AA1/g, "CC3")});
const change = async (feed: FakeFeed) => { await act(async () => { feed.onmessage!(); }); await settle(); };

test("a served log that grows re-renders on its change event", async () => {
  const live = liveCorpus(LISTING_I, {...TEXTS_I});
  const {feed} = await boot({fetch: live.fetch});
  assert.doesNotMatch(insp(), /Test Adversary Document/);
  assert.match(entry("AA1").innerHTML, /5 SECTIONS MISSING/);
  live.texts["20260101-AA1-alpha/audit-log.md"] = LOG_GROWN;
  await change(feed);
  assert.match(insp(), /Test Adversary Document/);
  // The rail re-rendered too: AA1's own ribbon counts one section fewer.
  assert.match(entry("AA1").innerHTML, /4 SECTIONS MISSING/);
});

test("an unchanged reload renders nothing and disturbs no reader state", async () => {
  const live = liveCorpus(LISTING_I, {...TEXTS_I});
  const {feed, hashes} = await boot({fetch: live.fetch});
  await click(entry("AA1"));
  const before = {rail: $("#rail").innerHTML, insp: insp(), writes: hashes.length, hash: location.hash};
  await change(feed);
  // Every render that changes the selection writes the hash, so an
  // unchanged count is no render that moved anything.
  assert.equal(hashes.length, before.writes);
  assert.equal($("#rail").innerHTML, before.rail);
  assert.equal(insp(), before.insp);
  assert.equal(location.hash, before.hash);
});

test("a change to another ticket leaves the inspector's controls in place and still updates the rail", async () => {
  const live = twoTickets();
  const {feed} = await boot({fetch: live.fetch});
  await click(entry("AA1"));
  const sel = $("#secSel");
  assert.match(entry("BB2").innerHTML, /5 SECTIONS MISSING/);
  live.texts["20260101-BB2-beta/audit-log.md"] = LOG_BB2.replace("## Aside Notes", "## Test Adversary Document\n\nGrown elsewhere.\n\n## Aside Notes");
  await change(feed);
  same($("#secSel"), sel, "the selector was rebuilt");
  assert.match(entry("BB2").innerHTML, /4 SECTIONS MISSING/);
});

test("an append to the shown section rewrites the pane and keeps the selector element", async () => {
  const live = twoTickets();
  const {feed} = await boot({fetch: live.fetch});
  await click(entry("AA1"));
  await pickSection("sec-aside-notes");
  const sel = $("#secSel");
  live.texts["20260101-AA1-alpha/audit-log.md"] = LOG.replace("Some **prose** citing DL-002.", "Some **prose** citing DL-002.\n\nA line the run just wrote.");
  await change(feed);
  assert.match(insp(), /A line the run just wrote/);
  same($("#secSel"), sel, "the selector was rebuilt");
  assert.equal(secVal(), "sec-aside-notes");
});

test("a new section on the shown ticket patches the selector in place and keeps its value", async () => {
  const live = twoTickets();
  const {feed} = await boot({fetch: live.fetch});
  await click(entry("AA1"));
  const sel = $("#secSel"), was = secVal();
  live.texts["20260101-AA1-alpha/audit-log.md"] = LOG_GROWN;
  await change(feed);
  same($("#secSel"), sel, "the selector was rebuilt");
  assert.equal(secVal(), was);
  assert.ok([...sel.querySelectorAll("option")].some(o => /Test Adversary Document/.test(o.textContent!)));
  assert.equal($("#scrInspector").querySelectorAll("select").length, 1);
});

test("a change event keeps focus on the focused control and scrolls nothing", async () => {
  const scrolls = recordScrolls();
  const live = twoTickets();
  const {feed} = await boot({fetch: live.fetch});
  await click(entry("AA1"));
  const prev = op("data-secstep", "-1");
  prev.focus();
  live.texts["20260101-AA1-alpha/audit-log.md"] = LOG_GROWN;
  await change(feed);
  same(document.activeElement, prev, "focus left the prev button");
  assert.equal(scrolls.length, 0);
});

test("a prompt-only ticket that gains its log on a change shows the full ticket view", async () => {
  const live = twoTickets();
  const {feed} = await boot({fetch: live.fetch});
  await click(entry("CC3"));
  assert.equal(secVal(), "prompt");
  live.listing = {...live.listing, files: live.listing.files.concat("20260101-CC3-gamma/audit-log.md")};
  live.texts["20260101-CC3-gamma/audit-log.md"] = LOG.replace("AA1 alpha", "CC3 gamma").replace(/OT-AA1-/g, "OT-CC3-");
  await change(feed);
  assert.equal($("#scrInspector").querySelectorAll("select").length, 1);
  assert.ok($$("#secSel option").some(o => /Decision Log/.test(o.textContent!)));
  assert.equal(secVal(), "prompt");
});

test("the full log keeps a collapsed section collapsed across change events", async () => {
  const live = twoTickets();
  const {feed} = await boot({fetch: live.fetch});
  await click(entry("AA1"));
  await click(op("data-view", "full"));
  const fsec = (k: string) => ($$(".fsec") as HTMLDetailsElement[]).find(d => d.getAttribute("data-key") === k)!;
  await click(fsec("sec-aside-notes").querySelector(".fsum")!);
  assert.equal(fsec("sec-aside-notes").open, false);
  const held = fsec("sec-aside-notes");
  live.texts["20260101-BB2-beta/audit-log.md"] = LOG_BB2 + "\nlate prose.\n";
  await change(feed);
  same(fsec("sec-aside-notes"), held, "the collapsed section was rebuilt");
  assert.equal(held.open, false);
  live.texts["20260101-AA1-alpha/audit-log.md"] = LOG_GROWN;
  await change(feed);
  assert.ok($$(".fsec").some(d => /Test Adversary Document/.test(d.innerHTML)));
  assert.equal(fsec("sec-aside-notes").open, false);
});

test("a hidden screen shows the change when the reader opens it", async () => {
  const live = twoTickets();
  const {feed} = await boot({fetch: live.fetch});
  await click(entry("AA1"));
  live.texts["20260101-BB2-beta/audit-log.md"] = LOG_BB2.replace("| OT-BB2-2 |",
    "| OT-BB2-3 | DL-002 | late watch | LOW | done → VALIDATED | until 2099-01-01 |\n| OT-BB2-2 |");
  await change(feed);
  await click(tabFor("watchboard"));
  assert.match($("#scrWatch").innerHTML, /OT-BB2-3/);
});

// ---- the ledgers ----

const lgRows = () => $$(".lgrow").filter(r => r.getAttribute("data-dl"));

test("the ledger rows every decision, open debt first, settled outcomes last", async () => {
  await bootBoard();
  await click(tabFor("ledgers"));
  assert.deepEqual(lgRows().map(r => r.getAttribute("data-t") + "/" + r.getAttribute("data-dl")), ["AA1/DL-002", "BB2/DL-001", "AA1/DL-001"]);
  // Watches never row here, because the board is the one watch surface.
  assert.equal($$(".lgrow").filter(r => r.getAttribute("data-wid")).length, 0);
  // Calibration heads the Ledger and names every outcome in its legend, so
  // we read the ledger's own part alone.
  const scr = $("#scrLedgers").innerHTML.replace($("#scrCalib").outerHTML, "");
  assert.match(scr, /open 2/);
  assert.match(scr, /validated 1/);
  assert.ok(!scr.includes("invalidated"));
});

test("the ledger pills filter corpus-wide and leave the inspector's filter alone", async () => {
  await bootBoard();
  await click(entry("AA1"));
  await click($$(".fpill").find(p => p.getAttribute("data-dlf") === "validated")!);
  assert.deepEqual($$(".dlrow").map(r => r.getAttribute("data-dl")), ["DL-001"]);
  await click(tabFor("ledgers"));
  await click($$(".fpill").find(p => p.getAttribute("data-lgf") === "open")!);
  assert.deepEqual(lgRows().map(r => r.getAttribute("data-dl")), ["DL-002", "DL-001"]);
  await click(tabFor("inspector"));
  assert.deepEqual($$(".dlrow").map(r => r.getAttribute("data-dl")), ["DL-001"]);
  assert.match($$(".fpill").find(p => p.getAttribute("data-dlf") && p.classList.contains("is-on"))!.textContent!, /validated/);
  // The ledger's own filter held through the round trip too.
  await click(tabFor("ledgers"));
  assert.match($$(".fpill").find(p => p.getAttribute("data-lgf") && p.classList.contains("is-on"))!.textContent!, /open/);
});

test("a ledger entry link lands the inspector on the item in its owning section", async () => {
  const {hashes} = await bootBoard();
  await click(tabFor("ledgers"));
  await click($$(".wbl").find(a => a.getAttribute("data-item") === "DL-002")!);
  assert.equal(isOn("scrInspector"), true);
  assert.equal(secVal(), "sec-decision-log");
  assert.match(insp(), /\[DL-002\]/);
  assert.equal(last(hashes), "#t=AA1&s=sec-decision-log&item=DL-002");
});

test("a ledger coverage link lands the watch, and a ticket link the default view", async () => {
  await bootBoard();
  await click(tabFor("ledgers"));
  await click($$(".wbl").find(a => a.getAttribute("data-item") === "OT-AA1-1")!);
  assert.equal(secVal(), "sec-obligation-ticket-list");
  assert.match(insp(), /is-hl/);
  await click(tabFor("ledgers"));
  await click($$(".wbl").find(a => a.getAttribute("data-t") === "BB2" && !a.getAttribute("data-item"))!);
  assert.equal(secVal(), "sec-decision-log");
});

test("a ledgers deep link boots to the screen and a tab visit writes its token", async () => {
  await bootBoard({hash: "#v=ledgers"});
  assert.equal(isOn("scrLedgers"), true);
  assert.ok($$(".lgrow").length > 0);
  cleanup();
  vi.restoreAllMocks();
  const {hashes} = await bootBoard();
  await click(tabFor("ledgers"));
  assert.match(last(hashes), /^#v=ledgers/);
});

test("with no corpus the ledgers say so instead of rendering empty tables", async () => {
  await boot();
  await click(tabFor("ledgers"));
  assert.match($("#scrLedgers").innerHTML, /no corpus behind this page/);
  assert.ok(!$("#scrLedgers").innerHTML.includes("lgrow"));
});

test("the ledger's sorted header carries aria-sort and the arrow hides from the tree", async () => {
  await bootBoard();
  await click(tabFor("ledgers"));
  const th = (k: string) => $$(".sth").find(t => t.getAttribute("data-t") === "la" && t.getAttribute("data-k") === k)!;
  assert.ok($$(".sth").every(t => t.getAttribute("scope") === "col"));
  assert.equal(th("status").getAttribute("aria-sort"), "ascending");
  assert.equal(th("id").getAttribute("aria-sort"), null);
  await click(th("id"));
  assert.equal(th("id").getAttribute("aria-sort"), "ascending");
  assert.equal(th("status").getAttribute("aria-sort"), null);
  await click(th("id"));
  assert.equal(th("id").getAttribute("aria-sort"), "descending");
  assert.equal($$(".arr")[0].getAttribute("aria-hidden"), "true");
});

test("the ledger renders hostile harvested fields as text, and a pill carries the mark it was given", async () => {
  const hostile = "<img src=x onerror=alert(1)>";
  const log = ["## Decision Log", "", "### [DL-001] " + hostile, "- **Confidence:** " + hostile, "- **Status:** OPEN", "",
    "## Obligation Ticket List", "", "| Ticket ID | Decision Log ref | Assumption to validate | Priority | Exit condition | Observation window |",
    "|---|---|---|---|---|---|", "| OT-HX1-1 | DL-001 | " + hostile + " | HIGH | done → VALIDATED | " + hostile + " |", ""].join("\n");
  await boot({fetch: liveCorpus({root: "demo", files: ["20260101-HX1-hostile/audit-log.md"]}, {"20260101-HX1-hostile/audit-log.md": log}).fetch});
  await click(tabFor("ledgers"));
  assert.ok(!$("#scrLedgers").innerHTML.includes("<img"));
  assert.ok($("#scrLedgers").textContent!.includes(hostile));
  cleanup();
  const {container} = render(createElement(Pills, {counts: {all: 1, open: 1}, active: "all", mark: "data-lgf", onPick(){}}));
  assert.match(container.innerHTML, /data-lgf="open"/);
});

// ---- the resume pack ----

/* The pack tests serve the shipped packs from disk, so the screen renders
   the real files. The corpus is the board's pair, which carries an open
   decision, live and settled watches, and an overdue one. */
const PACKS_ROOT = path.join(import.meta.dirname, "..", "..", "packs");
const PACK_FILES = fs.readdirSync(PACKS_ROOT).filter(f => f.endsWith(".pack.md")).sort();
const PACK_NAMES = PACK_FILES.map(f => f.replace(/\.pack\.md$/, ""));
const packText = (f: string) => fs.readFileSync(path.join(PACKS_ROOT, f), "utf8");
function packsFetch(inner: FetchFn, listing?: {packs: string[]}): FetchFn {
  return u => {
    if (u === "packs.json") return ok(listing || {packs: PACK_FILES});
    if (u.startsWith("packs/")){
      const f = decodeURIComponent(u.slice("packs/".length));
      return PACK_FILES.includes(f) ? ok(packText(f)) : miss();
    }
    return inner(u);
  };
}
const bootPacks = (opts: BootOpts = {}, texts = TEXTS) => {
  const live = liveCorpus(LISTING, texts);
  return boot({fetch: packsFetch(live.fetch), ...opts}).then(b => ({...b, live}));
};
const selectedPacks = () => [($("#packSel") as HTMLSelectElement).value];
const packNames = () => [...($("#packSel") as HTMLSelectElement).options].map(o => o.value);
const packBlock = () => document.getElementById("packText");

/* What the page must show for a ticket: the same corpus built the way the
   seam builds it, swept the way the app sweeps it, and filled by the
   library for that ticket on the index's day. */
function expectedPack(name: string, key: string | null, texts = TEXTS){
  const files = LISTING.files.map(p => (p in texts ? {path: p, text: texts[p]} : {path: p}));
  const index = Bld.buildIndex(files, {project: "demo", generated: S.localDate(), source: "working-tree"});
  const t = index.tickets.find(x => (x.id || x.dir) === key) || null;
  return S.fillPack(packText(name + ".pack.md"), S.packContext(index, t, index.generated, Bld.lintCorpus(files)));
}
const marking = () => $$("#rail [data-key]").find(r => r.getAttribute("aria-current") === "true")!.getAttribute("data-key")!;

test("the pack screen rows every pack in listing order with resume-ticket selected by default", async () => {
  await bootPacks();
  await click(tabFor("resume pack"));
  assert.deepEqual(packNames(), PACK_NAMES);
  assert.deepEqual(selectedPacks(), ["resume-ticket"]);
  assert.equal($("#packSrc").textContent, "packs/resume-ticket.pack.md");
  assert.match($("#packDrawer").innerHTML, /Write your own pack/);
  // DL-027 V8 and V9: the title shares the head row with its subtitle, and the
  // pack path rides the copy row at its right end.
  assert.ok($(".adp-drawer__title").parentElement === $(".adp-drawer__sub").parentElement, "title and subtitle share the head row");
  assert.ok($("#packSrc").parentElement === $("[data-op=copypack]")?.parentElement, "the pack path sits in the copy row");
  assert.equal($("#packSrc").style.marginLeft, "auto");
  assert.equal($("#packText").style.flexGrow, "1");
  assert.equal($(".adp-drawer__body").style.overflowY, "auto");
  assert.match($("#packSlots").textContent!, /\{\{index\.generated\}\}/);
});

test("the block carries the lib's fill for the selected ticket, and a rail pick refills it in place", async () => {
  await bootPacks();
  await click(tabFor("resume pack"));
  const first = marking();
  assert.equal(packBlock()!.textContent, expectedPack("resume-ticket", first));
  const other = first === "BB2" ? "AA1" : "BB2";
  await click(entry(other));
  assert.equal(!!$("#packDrawer"), true);
  assert.equal(packBlock()!.textContent, expectedPack("resume-ticket", other));
  assert.notEqual(expectedPack("resume-ticket", first), expectedPack("resume-ticket", other));
});

test("the pack select switches the pack, refills the block, and keeps the keyboard", async () => {
  await bootPacks();
  await click(tabFor("resume pack"));
  const key = marking();
  const sel = $("#packSel");
  sel.focus();
  await pickPack("audit-sweep");
  assert.deepEqual(selectedPacks(), ["audit-sweep"]);
  assert.equal($("#packSrc").textContent, "packs/audit-sweep.pack.md");
  assert.equal(packBlock()!.textContent, expectedPack("audit-sweep", key));
  same(document.activeElement, sel, "focus left the pack select");
});

test("copy writes the block's text to the clipboard and the label reports it, then rests", async () => {
  const got = stubClipboard();
  await bootPacks();
  await click(tabFor("resume pack"));
  const key = marking();
  const copy = () => $('[data-op="copypack"]');
  vi.useFakeTimers({toFake: ["Date", "setTimeout", "clearTimeout"]});
  vi.setSystemTime(NOW);
  fireEvent.click(copy());
  await act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); });
  assert.deepEqual(got, [expectedPack("resume-ticket", key)]);
  assert.equal(copy().textContent, "copied");
  await act(async () => { vi.advanceTimersByTime(1200); });
  assert.equal(copy().textContent, "Copy pack");
});

test("a denied clipboard write says so and copies nothing", async () => {
  const got = stubClipboard(() => Promise.reject(new Error("denied")));
  await bootPacks();
  await click(tabFor("resume pack"));
  await click($('[data-op="copypack"]'));
  assert.deepEqual(got, []);
  assert.match($('[data-op="copypack"]').textContent!, /copy failed/);
});

// DL-015: the drawer is not a screen, so opening it writes no view token.
test("a resume pack deep link opens the drawer over Tickets, and opening the drawer writes no view token", async () => {
  await bootPacks({hash: "#v=resume%20pack"});
  assert.equal(!!$("#packDrawer"), true);
  assert.equal(isOn("scrInspector"), true);
  assert.ok(packBlock());
  cleanup();
  vi.restoreAllMocks();
  const {hashes} = await bootPacks();
  const before = last(hashes);
  await click(tabFor("resume pack"));
  assert.equal(!!$("#packDrawer"), true);
  assert.equal(last(hashes), before);
  assert.doesNotMatch(last(hashes), /v=/);
});

// PM5: the drawer is modal, Escape closes it, and focus returns to its opener.
test("the Packs drawer takes focus, makes the page behind it inert, and hands focus back on Escape or close", async () => {
  await bootPacks();
  $("#packsBtn").focus();
  await click($("#packsBtn"));
  same(document.activeElement, $("#packSel"), "focus did not move into the drawer");
  assert.equal($(".main").hasAttribute("inert"), true);
  assert.equal($("#topbar").hasAttribute("inert"), true);
  assert.equal($("#packDrawer").getAttribute("aria-modal"), "true");
  await key(document.activeElement!, "Escape");
  assert.equal($("#packDrawer"), null);
  assert.equal($(".main").hasAttribute("inert"), false);
  same(document.activeElement, $("#packsBtn"), "focus did not return to the Packs button");
  await click($("#packsBtn"));
  await click($('[aria-label="Close packs"]'));
  assert.equal($("#packDrawer"), null);
  same(document.activeElement, $("#packsBtn"), "focus did not return after the close button");
});

// A record naming a ticket id with no card: the advisory sweep's phantom.
const LOG_PHANTOM = LOG_B.replace("- **OT-BB2-3 CLOSED 2026-08-10 → VALIDATED.** The window ended quiet.",
  "- **OT-BB2-3 CLOSED 2026-08-10 → VALIDATED.** The window ended quiet.\n- **OT-BB2-9 CLOSED 2026-08-11 → VALIDATED.** No row carries this id.");

test("the ledger-integrity pack fills from the sweep over the served corpus", async () => {
  const {feed, live} = await bootPacks({}, {...TEXTS});
  await click(tabFor("resume pack"));
  await pickPack("ledger-integrity");
  assert.equal(packBlock()!.textContent, expectedPack("ledger-integrity", marking()));
  assert.match(packBlock()!.textContent!, /the corpus linted clean/);
  // A record appended under the watched log reaches the pack on its change event.
  live.texts["20260102-BB2-beta/audit-log.md"] = LOG_PHANTOM;
  await change(feed);
  assert.match(packBlock()!.textContent!, /\[phantom\] BB2 OT-BB2-9/);
  assert.equal(packBlock()!.textContent, expectedPack("ledger-integrity", marking(), live.texts));
});

/* The sweep costs a second walk of every log, so it runs once per corpus
   that lands and never on a reload that changed nothing. */
test("a reload that adopts nothing runs no advisory sweep", async () => {
  const {feed, live} = await bootPacks({}, {...TEXTS});
  await click(tabFor("resume pack"));
  await pickPack("ledger-integrity");
  const sweeps = vi.mocked(Bld.lintCorpus).mock.calls.length;
  const before = packBlock()!.textContent;
  await change(feed);
  assert.equal(vi.mocked(Bld.lintCorpus).mock.calls.length, sweeps);
  assert.equal(packBlock()!.textContent, before);
  live.texts["20260102-BB2-beta/audit-log.md"] = LOG_PHANTOM;
  await change(feed);
  assert.equal(vi.mocked(Bld.lintCorpus).mock.calls.length, sweeps + 1);
  assert.notEqual(packBlock()!.textContent, before);
});

test("a corpus that never loads leaves the screen on its notice", async () => {
  await boot({fetch: packsFetch(miss)});
  await click(tabFor("resume pack"));
  await pickPack("ledger-integrity");
  assert.match($("#packDrawer").innerHTML, /no corpus behind this page/);
  assert.equal(packBlock(), null);
});

test("with no packs behind the page the screen says so and rows nothing", async () => {
  await bootBoard();
  await click(tabFor("resume pack"));
  assert.match($("#packDrawer").innerHTML, /no packs behind this page/);
  assert.equal($("#packSel"), null);
  assert.equal(packBlock(), null);
});

test("an empty packs directory is named as empty, not as absent", async () => {
  await boot({fetch: packsFetch(liveCorpus(LISTING, TEXTS).fetch, {packs: []})});
  await click(tabFor("resume pack"));
  assert.match($("#packDrawer").innerHTML, /packs directory is empty/);
});

test("with packs but no corpus the screen rows the packs and says there is no corpus to fill from", async () => {
  await boot({fetch: packsFetch(miss)});
  await click(tabFor("resume pack"));
  assert.deepEqual(packNames(), PACK_NAMES);
  assert.match($("#packDrawer").innerHTML, /no corpus behind this page/);
  assert.equal(packBlock(), null);
});

test("a corpus-wide pack fills with no ticket selected, and a ticket pack still asks for one", async () => {
  await bootPacks({hash: "#t=ZZZ"});
  await click(tabFor("resume pack"));
  assert.match($("#packDrawer").innerHTML, /"ZZZ" is not in this corpus/);
  assert.equal(packBlock(), null);
  await pickPack("watch-audit");
  assert.equal(packBlock()!.textContent, expectedPack("watch-audit", null));
  assert.doesNotMatch($("#packDrawer").innerHTML, /select a ticket/);
  await pickPack("close-watch");
  assert.equal(packBlock(), null);
  // Picking a ticket fills the pack without leaving the screen.
  await click(entry("AA1"));
  assert.equal(!!$("#packDrawer"), true);
  assert.equal(packBlock()!.textContent, expectedPack("close-watch", "AA1"));
});

// ---- calibration ----

const calTab = () => click(tabFor("calibration"));

test("the calibration screen tiles the corpus and rows every confidence with the ledger's counts", async () => {
  await bootBoard();
  // The overdue count moves with the date, so the board's chip states it.
  await click(tabFor("watchboard"));
  const overdue = $$(".fpill").find(p => p.getAttribute("data-ws") === "overdue")!.textContent!.match(/overdue (\d+)/)![1];
  await calTab();
  const scr = $("#scrCalib").innerHTML;
  assert.deepEqual($$(".caltile-n").map(t => t.textContent), ["2", "2", "3", overdue + "+1"]);
  assert.deepEqual($$(".caltile").map(t => t.getAttribute("data-tile")), ["tickets", "shipped", "decisions", "watches"]);
  assert.deepEqual($$(".calrow").map(r => r.getAttribute("data-conf")), ["high", "medium", "low"]);
  assert.match(scr, /1 validated/);
  assert.match(scr, /1 of 1 ruled validated/);
  assert.match(scr, /none ruled yet/);
  // The separator leads the count it belongs to, so no line can end on one.
  assert.match(scr, /<span class="calnw">· 1 open<\/span>/);
  assert.ok(!/·\s*<\/span>/.test(scr));
  const segs = (k: string) => (scr.match(new RegExp(`class="calseg calseg-${k}"`, "g")) || []).length;
  assert.equal(segs("open"), 2);
  assert.equal(segs("validated"), 1);
  assert.equal(segs("invalidated"), 0);
  for (const k of ["validated", "invalidated", "open", "unknown", "other"])
    assert.match(scr, new RegExp(`<i class="calseg-${k}"></i>${k}`));
  // The open count agrees with the ledger's pill on the same corpus.
  const open = (scr.match(/(\d+) open</g) || []).reduce((n, s) => n + parseInt(s, 10), 0);
  await click(tabFor("ledgers"));
  assert.match($("#scrLedgers").innerHTML, new RegExp(`open ${open}`));
});

const oneLog = (log: string) => liveCorpus({root: "demo", files: ["20260103-CC3-gamma/audit-log.md"]}, {"20260103-CC3-gamma/audit-log.md": log}).fetch;

test("the calibration screen counts a ruled entry by its ruling, never its card", async () => {
  await boot({fetch: oneLog(["# Audit Log — CC3 gamma", "", "## Decision Log", "", "### [DL-001] Ruled off the card",
    "- **Decision:** pick d", "- **Confidence:** MEDIUM", "- **Status:** OPEN", "", "- **DL-001 CLOSED 2026-08-10 → VALIDATED.** The ruling.", ""].join("\n"))});
  await calTab();
  const scr = $("#scrCalib").innerHTML;
  assert.match(scr, /1 validated/);
  assert.match(scr, /1 of 1 ruled validated/);
  assert.ok(!scr.includes('class="calseg calseg-open"'));
});

// DL-007: calibration heads the Ledger, so its old link lands there.
test("a calibration deep link boots to the Ledger with calibration at its top, and the Ledger writes its own token", async () => {
  const {hashes} = await bootBoard({hash: "#v=calibration"});
  assert.equal(isOn("scrLedgers"), true);
  same($("#scrLedgers").firstElementChild, $("#scrCalib"), "calibration does not head the Ledger");
  assert.equal($$(".caltile").length, 4);
  assert.match(last(hashes), /^#v=ledgers/);
});

test("with no corpus the calibration screen says so instead of tiling zeros", async () => {
  await boot();
  await calTab();
  assert.match($("#scrCalib").innerHTML, /no corpus behind this page/);
  assert.equal($$(".caltile").length, 0);
  assert.equal($$(".calrow").length, 0);
});

test("a corpus with no decisions tiles its zeros and names the empty record", async () => {
  await boot({fetch: oneLog("# Audit Log — CC3 gamma\n\n## Problem Statement\n\n**What the problem is:** empty.\n")});
  await calTab();
  assert.deepEqual($$(".caltile-n").map(t => t.textContent), ["1", "0", "0", "0+0"]);
  assert.match($("#scrCalib").innerHTML, /no decisions on record/);
  assert.equal($$(".calrow").length, 0);
});

test("a bar segment lands the ledger filtered to its cell, with focus on the status pill", async () => {
  const {hashes} = await bootBoard();
  await calTab();
  const seg = $$(".calseg").find(s => s.getAttribute("data-calc") === "high" && s.getAttribute("data-calk") === "open")!;
  assert.match(seg.getAttribute("aria-label")!, /^1 open at HIGH/);
  await click(seg);
  assert.equal(isOn("scrLedgers"), true);
  assert.match(last(hashes), /^#v=ledgers/);
  assert.deepEqual(lgRows().map(r => r.getAttribute("data-t") + "/" + r.getAttribute("data-dl")), ["BB2/DL-001"]);
  const on = (attr: string) => $$(".fpill").find(p => p.getAttribute(attr) && p.classList.contains("is-on"))!;
  assert.match(on("data-lgf").textContent!, /^open 2/);
  assert.match(on("data-lgc").textContent!, /^high 2/);
  assert.equal($("#scrLedgers").innerHTML.includes("pilllab"), true);
  same(document.activeElement, on("data-lgf"), "focus is not on the status pill");
  // Widening the confidence back to all keeps the status cut.
  await click($$(".fpill").find(p => p.getAttribute("data-lgc") === "all")!);
  assert.deepEqual(lgRows().map(r => r.getAttribute("data-dl")), ["DL-002", "DL-001"]);
  // The confidence filter is ledger state, so it holds across a tab round trip.
  await click($$(".fpill").find(p => p.getAttribute("data-lgc") === "low")!);
  await click(tabFor("inspector"));
  await click(tabFor("ledgers"));
  assert.match(on("data-lgc").textContent!, /^low 1/);
  assert.deepEqual(lgRows().map(r => r.getAttribute("data-dl")), ["DL-002"]);
});

test("the ledger pills row every kind the record holds, so no segment lands on an empty pill", async () => {
  await boot({fetch: oneLog(["# Audit Log — CC3 gamma", "", "## Decision Log", "",
    "### [DL-001] Parked", "- **Decision:** a", "- **Confidence:** CERTAIN", "- **Status:** PARKED", "",
    "### [DL-002] Unjudged", "- **Decision:** b", "- **Confidence:** LOW", "- **Status:** UNKNOWN", ""].join("\n"))});
  await calTab();
  await click($$(".calseg").find(s => s.getAttribute("data-calc") === "other")!);
  const pills = $$(".fpill").map(p => p.textContent);
  assert.ok(pills.includes("other 1") && pills.includes("unknown 1"));
  assert.deepEqual(lgRows().map(r => r.getAttribute("data-dl")), ["DL-001"]);
});

test("a change event keeps focus on the calibration segment it held", async () => {
  const live = liveCorpus(LISTING, {...TEXTS});
  const {feed} = await boot({fetch: live.fetch});
  await calTab();
  const seg = $$(".calseg").find(s => s.getAttribute("data-calc") === "low")!;
  seg.focus();
  live.texts["20260102-BB2-beta/audit-log.md"] = LOG_B + "\n## Amendment Notes\n\nlate news.\n";
  await change(feed);
  same(document.activeElement, seg, "focus left the segment");
});

// ---- the prompt view ----

// Every top-level key a builder can write, in a file order that differs
// from the builder's, plus one key the builder does not know.
const FULL_PROMPT = ["protocol:", "  apply: true", "  artifacts:", "    - problem_statement", "    - pr_summary",
  'schema_version: "1.0"', "task:", '  id: "T-9-full"', '  title: "Full prompt"', '  author: "rbeye"', '  date: "2026-10-18"',
  "preamble: |", "  Hold the old decisions.", "  Do not reopen them.", "role:", '  lens: "Front-end engineer"', "  priorities:",
  '    - "Keep `hashWrite` stable"', "prompt: |", "  Add the **view**.", "  Keep it read-only.", "constraints:", "  out_of_scope:",
  '    - "Editing"', "  must_not:", '    - "Change the index"', "context:", "  background: |",
  "    The developer reads prompts in a terminal.", "    See [the docs](https://example.com/docs).", "  references:",
  '    - path: "scripts/adp-serve.py"', '      lines: "84-114"', '      note: "serves the corpus"', "  links:",
  '    - "https://example.com/ticket"', "lessons_learned:", '  - context: "loads are all-or-null"',
  '    takeaway: "display data fails alone"', "output:", '  format: "code"', '  destination: "Edit in place"', "requirements:",
  '  - id: "R1"', '    statement: "The view shows"', '    verify: "A test asserts it"', "reviewer_notes: |",
  "  A key the builder never writes.", "  It still shows.", ""].join("\n");
const promptHtml = (yaml: string) => render(createElement(PromptCards, {obj: PL.parseYAML(yaml)})).container.innerHTML;

test("the prompt view renders every top-level key, the unknown one included", () => {
  const issues: string[] = [];
  PL.parseYAML(FULL_PROMPT, issues);
  assert.deepEqual(issues, []);
  const html = promptHtml(FULL_PROMPT);
  const heads = [...html.matchAll(/<h2 data-p="title"[^>]*>([^<]+)<\/h2>/g)].map(m => m[1]);
  assert.deepEqual(heads, ["Schema Version", "Task", "Preamble", "Role", "Prompt", "Constraints",
    "Context", "Lessons Learned", "Output", "Requirements", "Protocol", "Reviewer Notes"]);
  assert.match(html, /<h2 data-p="title" title="lessons_learned"[^>]*>Lessons Learned<\/h2>/);
  assert.doesNotMatch(html, /data-p="key"/);
  assert.match(html, /<h2 data-p="title"[^>]*>Schema Version<\/h2><span data-p="val"[^>]*>1\.0<\/span>/);
  assert.match(html, /<div data-p="k"[^>]*>title<\/div><div data-p="v"[^>]*>Full prompt<\/div>/);
  assert.match(html, /<th>path<\/th><th>lines<\/th><th>note<\/th>/);
  assert.match(html, /<th>id<\/th><th>statement<\/th><th>verify<\/th>/);
  assert.match(html, /Add the <strong>view<\/strong>/);
  assert.match(html, /Keep `hashWrite` stable/);
  assert.match(html, /<a href="https:\/\/example\.com\/docs"[^>]*>the docs<\/a>/);
  assert.match(html, /<a href="https:\/\/example\.com\/ticket"[^>]*>https:\/\/example\.com\/ticket<\/a>/);
  for (const v of ["T-9-full", "Front-end engineer", "Editing", "Change the index", "scripts/adp-serve.py",
    "84-114", "display data fails alone", "Edit in place", "The view shows", "A test asserts it",
    "problem_statement", "true", "A key the builder never writes."])
    assert.ok(html.includes(v), v);
});

test("block text inside a table cell renders as markdown", () => {
  const html = promptHtml(["requirements:", "  - id: \"R1\"", "    statement: \"Keep **this** exact\"", "    verify: |",
    "      First paragraph with **bold**.", "", "      Second paragraph."].join("\n") + "\n");
  const cell = html.match(/<td>((?:(?!<\/td>)[\s\S])*Second paragraph[\s\S]*?)<\/td>/)![1];
  assert.match(cell, /<p>First paragraph with <strong>bold<\/strong>\.<\/p>/);
  assert.match(cell, /<p>Second paragraph\.<\/p>/);
  assert.match(html, /<td>Keep \*\*this\*\* exact<\/td>/);
});

// The prompt view reads on the design system (DL-061, DL-067): each key in a
// pane of its own under a section heading, label rows on the grid, and none
// of the old card classes.
test("the prompt view sets each key in its own pane with grid rows and no old card class", () => {
  const html = promptHtml(FULL_PROMPT);
  assert.doesNotMatch(html, /class="[^"]*pcard/);
  assert.match(html, /<section data-p="card" class="doc" style="padding: 16px 24px; margin: 0px 0px 16px; border: 0px; background: var\(--panel\); box-shadow: inset 0 0 0 1px var\(--line\);"><div[^>]*><h2 data-p="title" title="task" class="adp-section" style="margin: 0px; font: 600 20px\/28px var\(--font-sans\);[^"]*">Task<\/h2>/);
  assert.equal(html.split('<section data-p="card" class="doc"').length - 1, 12);
  assert.match(html, /<div data-p="k" style="padding: 8px 0px;[^"]*font: 400 13px\/24px var\(--font-sans\);/);
  assert.match(html, /<div data-p="v" style="padding: 8px 0px;[^"]*font: 400 15px\/24px var\(--font-sans\);/);
  // Spacing alone keeps the rows apart (DL-063), so no row draws a rule.
  assert.doesNotMatch(html, /data-p="[kv]" style="[^"]*box-shadow/);
  assert.doesNotMatch(html, /class="pill /);
});

test("prompt text renders inert", () => {
  const html = promptHtml(["prompt: |", "  <script>alert(1)</script>", '  <img src=x onerror="alert(2)">',
    "  [click](javascript:alert(3))", "context:", "  background: |", "    [go](javascript:alert(4)) and <b onmouseover=x>hi</b>",
    "    [rel](data:text/html,x)", "  links:", '    - "javascript:alert(5)"', '    - "JaVaScRiPt:alert(6)"', '    - "relative/path"',
    '    - "mailto:a@b.c"', 'task:', '  title: "<svg onload=alert(7)>"', '  id: "[go](https://example.com/x)"', ""].join("\n"));
  const tags = [...html.matchAll(/<([a-z][a-z0-9]*)\b([^>]*)>/g)];
  assert.ok(tags.length);
  for (const [, name, attrs] of tags){
    assert.ok(!["script", "img", "svg", "iframe", "object"].includes(name), name);
    assert.doesNotMatch(attrs, /\son[a-z]+\s*=/i);
    const href = attrs.match(/href="([^"]*)"/);
    if (href) assert.match(href[1], /^(https?|mailto):/i);
  }
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /<a href="mailto:a@b\.c"/);
  assert.match(html, /<li><span>relative\/path<\/span><\/li>/);
  assert.match(html, /<li><span>javascript:alert\(5\)<\/span><\/li>/);
  assert.match(html, /<div data-p="v"[^>]*>\[go\]\(https:\/\/example\.com\/x\)<\/div>/);
});

test("a ticket with a prompt lists it ahead of phase 1 and steps to it", async () => {
  await bootCorpus({hash: "#t=AA1&s=sec-problem-statement"});
  assert.deepEqual(options().slice(0, 2), ["prompt", "sec-problem-statement"]);
  await click(op("data-secstep", "-1"));
  assert.equal(secVal(), "prompt");
  const scr = insp();
  assert.match(scr, /<h2 class="adp-section"[^>]*>prompt\.yaml</);
  assert.match(scr, /Make the <strong>alpha<\/strong> path work/);
  assert.equal($("#phaseStrip [aria-current=step]").textContent, "P");
  assert.match(scr, /data-secstep="-1" disabled/);
});

test("the prompt view has a deep link", async () => {
  const {hashes} = await bootCorpus();
  await click(entry("AA1"));
  await pickSection("prompt");
  assert.equal(last(hashes), "#t=AA1&s=prompt");
  cleanup();
  vi.restoreAllMocks();
  await bootCorpus({hash: "#t=AA1&s=prompt"});
  assert.equal(secVal(), "prompt");
  assert.match(insp(), /<h2 class="adp-section"[^>]*>prompt\.yaml</);
  assert.doesNotMatch(insp(), /was not found in this log/);
});

test("a prompt-only ticket shows its prompt instead of the no-audit-log notice", async () => {
  await boot({hash: "#t=AV002", fetch: liveCorpus({root: "demo", files: LISTING_I.files.concat(["CC-3-gamma/notes.txt"])}, TEXTS_I).fetch});
  assert.equal(secVal(), "prompt");
  assert.match(insp(), /beta brief/);
  assert.doesNotMatch(insp(), /no audit log yet/);
  await click(entry("CC3"));
  assert.match(insp(), /no audit log yet/);
});

test("a missing or unparseable prompt.yaml affects only its own ticket", async () => {
  const texts = {"20260101-AA1-alpha/audit-log.md": LOG, "AV-002-beta/prompt.yaml": "[1, 2, 3]\n"};
  await boot({hash: "#t=AA1&s=prompt", fetch: liveCorpus(LISTING_I, texts).fetch});
  assert.equal($$("#rail [data-key]").length, 2);
  assert.match(insp(), /prompt\.yaml is listed in the corpus but could not be read\./);
  assert.equal([...($("#secSel") as HTMLSelectElement).options].find(o => o.value === "prompt")!.textContent, "prompt.yaml — unreadable");
  await click(entry("AV002"));
  assert.match(insp(), /did not parse as YAML/);
  assert.match(insp(), /<pre class="rawpre">\[1, 2, 3\]/);
  cleanup();
  vi.restoreAllMocks();
  // A partial parse renders formatted and names what it skipped.
  await boot({hash: "#t=AV002", fetch: liveCorpus(LISTING_I, {...texts, "AV-002-beta/prompt.yaml": PROMPT_AV2 + "extra: [a, b]\n"}).fetch});
  assert.match(insp(), /parsed with 1 issue: extra \(flow sequence is unsupported/);
  assert.match(insp(), /beta brief/);
});

test("the prompt view follows an edit on its change event", async () => {
  const live = liveCorpus(LISTING_I, {...TEXTS_I});
  const {feed} = await boot({hash: "#t=AA1&s=prompt", fetch: live.fetch});
  assert.match(insp(), /Keep it small\./);
  live.texts["20260101-AA1-alpha/prompt.yaml"] = PROMPT_AA1.replace("Keep it small.", "Keep it smaller.");
  await change(feed);
  assert.match(insp(), /Keep it smaller\./);
});

test("an unchanged reload keeps the inspector in place, whatever order the prompts arrive in", async () => {
  let flip = false;
  const base = liveCorpus(LISTING_I, TEXTS_I).fetch;
  const fetchFn: FetchFn = u => {
    if (!u.endsWith("prompt.yaml")) return base(u);
    // We hold back one prompt per reload, a different one each time, so the
    // completion order alternates between reloads.
    const late = (u.includes("AA1") === flip) ? 5 : 0;
    return new Promise(r => setTimeout(r, late)).then(() => base(u));
  };
  const {feed} = await boot({hash: "#t=AA1&s=prompt", fetch: fetchFn});
  await act(async () => { await new Promise(r => setTimeout(r, 20)); });
  await settle();
  const before = $("#secSel");
  for (let i = 0; i < 3; i++){
    flip = !flip;
    await act(async () => { feed.onmessage!(); await new Promise(r => setTimeout(r, 20)); });
    await settle();
  }
  same($("#secSel"), before, "the selector was rebuilt");
});

// ---- the reviews screen ----

/* Two tickets with prreview rounds and one without. RV1 holds two PRs, and
   PR #7's rounds are r1, r2, and r10, so a string sort would misorder them.
   RV2 holds one PR: a round whose text tries to run script, a round with no
   verdict yet, and a round whose fetch fails. AV-002 holds no rounds. */
type ReviewOpts = {pr: number; k: number; dir: string; prior?: string; findings?: string; noVerdict?: boolean; verdict?: string};
const review = (o: ReviewOpts) => [
  `# PR Review — PR #${o.pr} round ${o.k} · ${o.dir}`, "",
  "## Review Target", `- **Round:** ${o.k}`, "",
  "## Inspected", "| Item | Value |", "|------|-------|", `| Prior review files | ${o.prior || "—"} |`, "",
  "## Findings", "", o.findings || `Round ${o.k} of PR #${o.pr} found nothing.`, "",
  ...(o.noVerdict ? [] : ["## Review Verdict", `- **Verdict:** ${o.verdict || "APPROVE"}`,
    "- **Confidence:** HIGH", "- **Counts:** must 0 / should 1 / question 0 / nit 0",
    "- **Opened:** PR-ADP-001", "- **Closed:** —", "- **Carried open:** —", "- **Summary:** done."]), ""
].join("\n");
const RV1 = "20260101-RV1-rounds", RV2 = "20260101-RV2-other";
const LOG_RV1 = ["# Audit Log — RV1 rounds", "", "## Problem Statement", "", "**What the problem is:** demo.", "",
  "## Review findings — PR #5, in-review (2026-01-02, first)", "", "An older pointer that names no file.", "",
  "## Review findings — PR #7 round 2 (2026-01-03)", "",
  `- **Review file:** \`.adp/${RV1}/pr-review-PR7-20260103-r2.md\``, ""].join("\n");
const LOG_RV2 = LOG_RV1.replace(/RV1/g, "RV2").split("\n## Review findings")[0];
const XSS = "<script>alert(1)</script> <img src=x onerror=alert(1)> [bad](javascript:alert(1))";
function reviewCorpus(){
  const texts: Record<string, string> = {
    [`${RV1}/audit-log.md`]: LOG_RV1,
    [`${RV1}/pr-review-PR7-20260102-r1.md`]: review({pr: 7, k: 1, dir: RV1}),
    [`${RV1}/pr-review-PR7-20260103-r2.md`]: review({pr: 7, k: 2, dir: RV1, prior: "pr-review-PR7-20260102-r1.md"}),
    [`${RV1}/pr-review-PR8-20260104-r3.md`]: review({pr: 8, k: 3, dir: RV1}),
    [`${RV1}/pr-review-PR7-20260105-r10.md`]: review({pr: 7, k: 10, dir: RV1}),
    [`${RV1}/notes.md`]: "not a round",
    [`${RV1}/refs/pr-review-PR7-20260105-r11.md`]: "a deeper file",
    [`${RV2}/audit-log.md`]: LOG_RV2,
    [`${RV2}/pr-review-PR9-20260106-r1.md`]: review({pr: 9, k: 1, dir: RV2, verdict: "APPROVE <b onmouseover=x>",
      findings: XSS, prior: `\`.adp/${RV1}/pr-review-PR7-20260103-r2.md\`, \`.adp/NOPE-gone/pr-review-PR9-20260101-r1.md\``}),
    [`${RV2}/pr-review-PR9-20260107-r2.md`]: review({pr: 9, k: 2, dir: RV2, noVerdict: true}),
    "AV-002-beta/prompt.yaml": PROMPT_AV2
  };
  // RV2's third round is listed but never answers.
  return liveCorpus({root: "demo", files: Object.keys(texts).concat([`${RV2}/pr-review-PR9-20260108-r3.md`]).sort()}, texts);
}
const bootReviews = (live: ReturnType<typeof liveCorpus>, hash: string) => boot({fetch: live.fetch, hash});
const revHtml = () => $("#scrReviews").innerHTML;
const within = (id: string, sel: string) => [...document.getElementById(id)!.querySelectorAll(sel)] as HTMLElement[];
const revStep = (d: number) => click(op("data-revstep", String(d)));
const pickSelect = async (el: Element, value: string) => { fireEvent.change(el, {target: {value}}); await settle(1); };

test("a reviews deep link opens the ticket's latest round with its head", async () => {
  await bootReviews(reviewCorpus(), "#v=reviews&t=RV1");
  assert.equal(isOn("scrReviews"), true);
  const head = $("#revHead").innerHTML;
  assert.match(head, /PR #7 · round 10/);
  assert.match(head, /2026-01-05/);
  assert.match(head, /APPROVE/);
  assert.match(head, /must 0 \/ should 1 \/ question 0 \/ nit 0/);
  assert.match(head, /PR-ADP-001/);
  assert.match($("#revBody").innerHTML, /Round 10 of PR #7 found nothing\./);
  assert.match(location.hash, /^#v=reviews&t=RV1&s=pr-review-PR7-20260105-r10\.md$/);
});

test("the step controls walk one PR's rounds in number order and stop at both ends", async () => {
  await bootReviews(reviewCorpus(), "#v=reviews&t=RV1");
  const seen: string[] = [];
  for (let i = 0; i < 3; i++){
    seen.push(($("#revSel") as HTMLSelectElement).value);
    if (i < 2) await revStep(-1);
  }
  assert.deepEqual(seen, ["pr-review-PR7-20260105-r10.md", "pr-review-PR7-20260103-r2.md", "pr-review-PR7-20260102-r1.md"]);
  assert.equal(op("data-revstep", "-1").hasAttribute("disabled"), true);
  assert.equal(op("data-revstep", "1").hasAttribute("disabled"), false);
  await revStep(1); await revStep(1);
  assert.equal(op("data-revstep", "1").hasAttribute("disabled"), true);
  assert.match($("#revHead").innerHTML, /PR #7 · round 10/);
});

test("a ticket with two PRs offers a PR select, and a switch lands on that PR's latest round", async () => {
  const c = reviewCorpus();
  await bootReviews(c, "#v=reviews&t=RV1");
  assert.deepEqual([...$("#revPr").children].map(o => o.textContent), ["PR #7", "PR #8"]);
  await pickSelect($("#revPr"), "PR8");
  assert.match($("#revHead").innerHTML, /PR #8 · round 3/);
  assert.deepEqual([...$("#revSel").children].map(o => o.getAttribute("value")), ["pr-review-PR8-20260104-r3.md"]);
  assert.equal(location.hash, "#v=reviews&t=RV1&s=pr-review-PR8-20260104-r3.md");
  // The hash reopens the same round in a fresh page.
  const hash = location.hash;
  cleanup();
  vi.restoreAllMocks();
  await bootReviews(c, hash);
  assert.match($("#revHead").innerHTML, /PR #8 · round 3/);
  await click(entry("RV2"));
  assert.equal(document.getElementById("revPr"), null);
});

test("the reviews screen follows the rail, and a ticket with no rounds shows an empty state", async () => {
  await bootReviews(reviewCorpus(), "#v=reviews&t=RV1");
  await click(entry("RV2"));
  assert.equal(isOn("scrReviews"), true);
  assert.match($("#revHead").innerHTML, /PR #9 · round/);
  await click(entry("AV002"));
  assert.equal(isOn("scrReviews"), true);
  assert.match(revHtml(), /this ticket has no review files/);
  assert.equal(entry("AV002").getAttribute("aria-current") === "true", true);
});

// The filter, the collapsed sections, and the round each belong to the
// ticket on show, so a rail pick starts the next ticket clean.
test("a rail pick resets the decisions filter, the collapsed sections, and the review round", async () => {
  const c = reviewCorpus();
  c.texts[`${RV1}/audit-log.md`] = LOG.replace("AA1 alpha", "RV1 rounds").replace(/OT-AA1-/g, "OT-RV1-");
  await bootReviews(c, "#t=RV1&s=sec-decision-log");
  await click($$(".fpill").find(p => p.getAttribute("data-dlf") === "open")!);
  await click(op("data-view", "full"));
  await click(($$(".fsec") as HTMLDetailsElement[]).find(d => d.getAttribute("data-key") === "sec-problem-statement")!.querySelector(".fsum")!);
  await click(entry("RV2"));
  await click(entry("RV1"));
  const ps = ($$(".fsec") as HTMLDetailsElement[]).find(d => d.getAttribute("data-key") === "sec-problem-statement")!;
  assert.equal(ps.open, true);
  await click(op("data-view", "section"));
  await pickSection("sec-decision-log");
  assert.equal($$(".fpill").find(p => p.getAttribute("data-dlf") === "all")!.classList.contains("is-on"), true);
  await click(tabFor("reviews"));
  assert.match($("#revHead").innerHTML, /PR #7 · round 10/);
  await click(entry("RV2"));
  assert.match($("#revHead").innerHTML, /PR #9 · round 3/);
  assert.doesNotMatch($("#revHead").innerHTML, /was not found in this ticket/);
});

test("a round's text renders inert in the head and the body", async () => {
  await bootReviews(reviewCorpus(), "#v=reviews&t=RV2&s=pr-review-PR9-20260106-r1.md");
  // The parsed tree is the check that matters: no live element and no event
  // attribute exists, whatever the markup string looks like.
  assert.equal(within("scrReviews", "script").length, 0);
  assert.equal(within("scrReviews", "img").length, 0);
  for (const el of within("scrReviews", "*"))
    assert.deepEqual(el.getAttributeNames().filter(k => /^on/i.test(k)), [], el.tagName);
  const html = revHtml();
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /<img[^>]*onerror/i);
  assert.doesNotMatch(html, /<b onmouseover/i);
  assert.doesNotMatch(html, /href="javascript:/i);
  for (const a of within("scrReviews", "a")){
    const href = a.getAttribute("href");
    if (href != null) assert.match(href, /^(#|https?:|mailto:)/);
  }
  assert.match(html, /&lt;script&gt;/);
});

test("prior rounds in another ticket link to that ticket's reviews tab", async () => {
  await bootReviews(reviewCorpus(), "#v=reviews&t=RV2&s=pr-review-PR9-20260106-r1.md");
  const links = within("revHead", ".rvl");
  assert.deepEqual(links.map(a => a.textContent), [`pr-review-PR7-20260103-r2.md · ${RV1}`, "pr-review-PR9-20260101-r1.md · NOPE-gone"]);
  assert.equal(links[0].getAttribute("href"), "#v=reviews&t=RV1&s=pr-review-PR7-20260103-r2.md");
  await click(links[1]);
  assert.match($("#revHead").innerHTML, /ticket "NOPE-gone" is not in this corpus\./);
  assert.match($("#revHead").innerHTML, /PR #9 · round 1/);
  await click(within("revHead", ".rvl")[0]);
  assert.match($("#revHead").innerHTML, /PR #7 · round 2/);
  assert.equal(entry("RV1").getAttribute("aria-current") === "true", true);
  assert.equal(location.hash, "#v=reviews&t=RV1&s=pr-review-PR7-20260103-r2.md");
});

test("an unreadable round, a round with no verdict, and a stale round link each show a notice", async () => {
  const c = reviewCorpus();
  await bootReviews(c, "#v=reviews&t=RV2&s=pr-review-PR9-20260108-r3.md");
  assert.match($("#revHead").innerHTML, /pr-review-PR9-20260108-r3\.md is listed in the corpus but could not be read\./);
  assert.equal($("#revBody").innerHTML, "");
  await revStep(-1);
  assert.match($("#revHead").innerHTML, /no Review Verdict section yet/);
  assert.match($("#revBody").innerHTML, /Round 2 of PR #9 found nothing\./);
  cleanup();
  vi.restoreAllMocks();
  await bootReviews(c, "#v=reviews&t=RV1&s=pr-review-PR7-20990101-r99.md");
  assert.match($("#revHead").innerHTML, /was not found in this ticket/);
  assert.match($("#revHead").innerHTML, /PR #7 · round 10/);
});

test("an inspector pointer section links to its round, and the inspector keeps its section", async () => {
  await bootReviews(reviewCorpus(), "#t=RV1");
  const optFor = (re: RegExp) => $$("#secSel option").find(o => re.test(o.textContent!))!.getAttribute("value")!;
  await pickSection(optFor(/PR #5, in-review/));
  assert.equal(within("scrInspector", ".rvl").length, 0);
  const key = optFor(/PR #7 round 2/);
  await pickSection(key);
  const link = within("scrInspector", ".rvl")[0];
  assert.equal(link.textContent, "open round in reviews ›");
  await click(link);
  assert.equal(isOn("scrReviews"), true);
  assert.match($("#revHead").innerHTML, /PR #7 · round 2/);
  await click(tabFor("inspector"));
  assert.equal(secVal(), key);
  assert.equal(location.hash, "#t=RV1&s=" + encodeURIComponent(key));
});

test("a quiet reload leaves every reviews region in place, and a new round extends the round select", async () => {
  const c = reviewCorpus();
  const {feed} = await bootReviews(c, "#v=reviews&t=RV1");
  const ids = ["revTop", "revNav", "revHead", "revBody"];
  const kids = () => ids.map(id => document.getElementById(id)!.children[0]);
  const before = kids(), sel = $("#revSel");
  const held = (what: string) => kids().forEach((k, i) => same(k, before[i], what + ": " + ids[i] + " was rebuilt"));
  await change(feed); await change(feed);
  held("a quiet reload");
  // A change in another ticket writes nothing here either.
  c.texts[`${RV2}/pr-review-PR9-20260107-r2.md`] += "\nmore";
  await change(feed);
  held("another ticket's change");
  // A new PR #7 round keeps the shown round, and the select keeps its element.
  c.texts[`${RV1}/pr-review-PR7-20260109-r11.md`] = review({pr: 7, k: 11, dir: RV1});
  c.listing = {...c.listing, files: c.listing.files.concat([`${RV1}/pr-review-PR7-20260109-r11.md`]).sort()};
  await change(feed);
  same($("#revSel"), sel, "the round select was rebuilt");
  assert.equal(($("#revSel") as HTMLSelectElement).value, "pr-review-PR7-20260105-r10.md");
  assert.equal($("#revSel").children.length, 4);
  same(document.getElementById("revBody")!.children[0], before[3], "the round body was rebuilt");
});

const card = (id: string, o: {title?: string; severity?: string; claim?: string; status?: string} = {}) => [
  `### [${id}] ${o.title || "A finding title"}`, `- **Severity:** ${o.severity || "should"}`, "- **Category:** COR — Correctness",
  `- **Claim:** ${o.claim || "The code does the wrong thing."}`, "- **Confidence:** HIGH",
  "- **Confidence basis:** DIRECT EVIDENCE — a repro.", `- **Status:** ${o.status || "OPEN"}`].join("\n");
const ledgerLine = (id: string, outcome: string, note: string) => `- **${id} CLOSED 2026-01-03 → ${outcome}.** ${note}`;
const withLedger = (text: string, lines: string[]) => text.replace("## Review Verdict", "## Prior Findings\n" + lines.join("\n") + "\n\n## Review Verdict");
const bodyEl = (text: string, ledger: S.ReviewLedger, tok = "RV1") =>
  render(createElement(ReviewBody, {text, ctx: {ledger, tok, onRound(){}}})).container;
// Each head chip as its kind, its word, and its class.
const headChips = (c: Element) => [...c.querySelectorAll(".adp-dl__head .adp-chip")].map(x => [x.getAttribute("title"), x.textContent, x.className]);
const fieldLabels = (c: Element) => [...c.querySelectorAll("dt")].map(d => d.textContent);
// A note that mixes author text with our link sits in a contents span (DL-069).
const CONTENTS = '(?:<span style="display: contents;">)?';

test("a finding renders as a card, and its status pill reads the ledger, not the stale card", () => {
  const text = review({pr: 7, k: 1, dir: RV1, findings: card("PR-COR-001") + "\n\n" + card("PR-TST-002", {severity: "nit"})});
  const box = bodyEl(text, {"PR-COR-001": {id: "PR-COR-001", file: "pr-review-PR7-20260103-r2.md", k: 2, date: "2026-01-03", outcome: "RESOLVED", note: "fixed **now**."}});
  const cards = [...box.querySelectorAll(".adp-dl")];
  assert.equal(cards.length, 2);
  // Severity and confidence are neutral Tags, and the ledger's closure is the status.
  assert.deepEqual(headChips(cards[0]), [["severity", "should", "adp-chip"], ["confidence", "HIGH", "adp-chip"],
    ["status", "RESOLVED", "adp-chip adp-chip--validated"]]);
  assert.equal(cards[0].className, "adp-dl adp-dl--settled");
  const closed = [...cards[0].querySelectorAll("dt")].find(d => d.textContent === "closed")!.nextElementSibling!;
  assert.match(closed.innerHTML, new RegExp(`^2026-01-03 in <a class="rvl"[^>]*data-rf="pr-review-PR7-20260103-r2\\.md"[^>]*>round 2</a> · ${CONTENTS}fixed <strong>now</strong>\\.`));
  assert.ok(fieldLabels(cards[0]).includes("Confidence basis"));
  assert.ok(!fieldLabels(cards[0]).some(l => /^(Severity|Confidence|Status)$/.test(l!)));
  assert.deepEqual(headChips(cards[1]), [["severity", "nit", "adp-chip"], ["confidence", "HIGH", "adp-chip"], ["status", "OPEN", "adp-chip adp-chip--open"]]);
  assert.equal(cards[1].className, "adp-dl");
  // The first finding starts open and the rest start folded.
  assert.equal(cards[0].querySelector(".adp-dl__head")!.getAttribute("aria-expanded"), "true");
  assert.equal((cards[1].querySelector(".adp-dl__body") as HTMLElement).style.display, "none");
  assert.ok([...box.querySelectorAll(".doc > h2.adp-section")].some(h => h.textContent === "Findings"));
});

test("Review Target, Review Verdict, and Prior Findings render as grids, and a stray line keeps markdown", () => {
  const text = withLedger(review({pr: 7, k: 2, dir: RV1}), [ledgerLine("PR-COR-001", "RESOLVED", "fixed.")]);
  const grids = (box: Element) => [...box.querySelectorAll<HTMLElement>("div")].filter(d => d.style.display === "grid").length;
  const value = (box: Element, label: string) => [...box.querySelectorAll("[data-rev=k]")].find(k => k.textContent === label)!.nextElementSibling!;
  const box = bodyEl(text, {});
  assert.equal(grids(box), 3);
  assert.equal(value(box, "Round").textContent, "2");
  const pc = value(box, "PR-COR-001");
  assert.equal(pc.querySelector(".adp-chip")!.className, "adp-chip adp-chip--s adp-chip--validated");
  assert.equal(pc.textContent, "RESOLVED 2026-01-03 · fixed.");
  assert.ok(box.querySelector("table.adp-table"));
  assert.match(box.innerHTML, /Round 2 of PR #7 found nothing\./);
  assert.deepEqual([...box.querySelectorAll(".doc > h2.adp-section")].map(h => h.textContent),
    ["Review Target", "Inspected", "Findings", "Prior Findings", "Review Verdict"]);
  assert.doesNotMatch(box.innerHTML, /PR Review — PR #7/);
  for (const d of box.querySelectorAll(".doc")) assert.ok(d.querySelector(":scope > .adp-prose"), "a pane lacks its prose body");
  cleanup();
  const stray = bodyEl(text.replace("## Prior Findings\n", "## Prior Findings\nA note that is not a ledger line.\n"), {});
  assert.equal(grids(stray), 2);
  assert.match(stray.innerHTML, /A note that is not a ledger line\./);
  assert.match(stray.innerHTML, /PR-COR-001 CLOSED 2026-01-03/);
});

test("a finding card renders its text inert, and an unknown outcome word picks no class", () => {
  const text = review({pr: 9, k: 1, dir: RV2, findings: card("PR-SEC-001", {title: XSS, claim: XSS, severity: "<b>x</b> later"})});
  const box = bodyEl(text, {"PR-SEC-001": {id: "PR-SEC-001", file: "f.md", k: 2, date: "2026-01-03", outcome: "WEIRD", note: XSS}}, "RV2");
  assert.doesNotMatch(box.innerHTML, /<script|<img|<b>|href="javascript:/i);
  assert.match(box.innerHTML, /&lt;script&gt;/);
  const status = box.querySelector(".adp-dl__head .adp-chip[title=status]")!;
  assert.deepEqual([status.textContent, status.className], ["WEIRD", "adp-chip"]);
  assert.ok(fieldLabels(box).includes("severity note"));
});

test("a later round's closure repaints an earlier round's card on its change event", async () => {
  const c = reviewCorpus();
  c.texts[`${RV1}/pr-review-PR7-20260102-r1.md`] = review({pr: 7, k: 1, dir: RV1, findings: card("PR-COR-001")});
  const {feed} = await bootReviews(c, "#v=reviews&t=RV1&s=pr-review-PR7-20260102-r1.md");
  const status = () => { const x = $("#revBody .adp-dl__head .adp-chip[title=status]"); return [x.textContent, x.className]; };
  assert.deepEqual(status(), ["OPEN", "adp-chip adp-chip--open"]);
  c.texts[`${RV1}/pr-review-PR7-20260103-r2.md`] = withLedger(c.texts[`${RV1}/pr-review-PR7-20260103-r2.md`], [ledgerLine("PR-COR-001", "RESOLVED", "fixed.")]);
  await change(feed);
  assert.deepEqual(status(), ["RESOLVED", "adp-chip adp-chip--validated"]);
  await click(within("revBody", ".rvl")[0]);
  assert.match($("#revHead").innerHTML, /PR #7 · round 2/);
  assert.equal(location.hash, "#v=reviews&t=RV1&s=pr-review-PR7-20260103-r2.md");
});

/* AA1's log defines DL-001, DL-002, OT-AA1-1, and OT-AA1-2. Its round cites
   DL-002 and OT-AA1-1 in prose, DL-001 only inside a code fence, and DL-099,
   which the log never defines. */
const AA1 = "20260101-AA1-alpha";
const AA1_ROUND = review({pr: 3, k: 1, dir: AA1, findings: card("PR-COR-001") + "\n- **Refs:** DL-002, OT-AA1-1, DL-099\n\n```\nDL-001\n```"});
const citedCorpus = () => {
  const texts = {[`${AA1}/audit-log.md`]: LOG, [`${AA1}/pr-review-PR3-20260102-r1.md`]: AA1_ROUND,
    [`${AA1}/pr-review-PR3-20260103-r2.md`]: review({pr: 3, k: 2, dir: AA1})};
  return liveCorpus({root: "demo", files: Object.keys(texts).sort()}, texts);
};

test("a round shows the decisions and watches it cites, and a round that cites none shows no panel", async () => {
  await bootReviews(citedCorpus(), "#v=reviews&t=AA1&s=pr-review-PR3-20260102-r1.md");
  const body = $("#revBody").innerHTML;
  assert.match(body, /decisions cited by PR #3 · round 1/);
  assert.match(body, /watches cited by PR #3 · round 1/);
  assert.deepEqual(within("revBody", ".dlrow").map(r => r.getAttribute("data-dl")), ["DL-002"]);
  assert.deepEqual(within("revBody", ".wrow").map(r => r.getAttribute("data-item")), ["OT-AA1-1"]);
  assert.ok(within("revBody", ".pc").length > 0);
  await revStep(1);
  assert.doesNotMatch($("#revBody").innerHTML, /cited by/);
});

test("the reviews filter is its own, and a cited row opens its entry in the inspector", async () => {
  await bootReviews(citedCorpus(), "#v=reviews&t=AA1&s=pr-review-PR3-20260102-r1.md");
  const rpill = (f: string) => within("revBody", ".fpill").find(p => p.getAttribute("data-rdf") === f)!;
  assert.deepEqual(within("revBody", ".fpill").map(p => p.getAttribute("data-rdf")), ["all", "open"]);
  await click(rpill("open"));
  assert.equal(rpill("open").classList.contains("is-on"), true);
  assert.equal(isOn("scrReviews"), true);
  await click(within("revBody", ".dlrow")[0]);
  assert.equal(isOn("scrInspector"), true);
  assert.match(insp(), /\[DL-002\]/);
  // The inspector's own filter never saw the reviews click.
  await click(within("scrInspector", '[data-op="back"]')[0]);
  await pickSection("sec-decision-log");
  const ipill = (f: string) => within("scrInspector", ".fpill").find(p => p.getAttribute("data-dlf") === f)!;
  assert.equal(ipill("all").classList.contains("is-on"), true);
  assert.equal(ipill("open").classList.contains("is-on"), false);
});

test("a column sort on one screen reaches the other screen's cited table the next time it shows", async () => {
  const texts = {[`${AA1}/audit-log.md`]: LOG, [`${AA1}/pr-review-PR3-20260102-r1.md`]: review({pr: 3, k: 1, dir: AA1,
    findings: card("PR-COR-001") + "\n- **Refs:** DL-001, DL-002"})};
  await bootReviews(liveCorpus({root: "demo", files: Object.keys(texts).sort()}, texts), "#t=AA1&s=sec-decision-log");
  const ids = (id: string) => within(id, ".dlrow").map(r => r.getAttribute("data-dl")).join(",");
  const idTh = (id: string) => within(id, ".sth").find(t => t.getAttribute("data-t") === "dec" && t.getAttribute("data-k") === "id")!;
  assert.equal(ids("scrInspector"), "DL-001,DL-002");
  await click(tabFor("reviews"));
  await click(idTh("revBody"));
  assert.equal(ids("revBody"), "DL-002,DL-001");
  await click(tabFor("inspector"));
  assert.equal(ids("scrInspector"), "DL-002,DL-001");
  assert.equal(idTh("scrInspector").getAttribute("aria-sort"), "descending");
  await click(idTh("scrInspector"));
  assert.equal(ids("scrInspector"), "DL-001,DL-002");
  await click(tabFor("reviews"));
  assert.equal(ids("revBody"), "DL-001,DL-002");
  assert.equal(idTh("revBody").getAttribute("aria-sort"), "ascending");
});

test("a severity word that names an Object member takes the fallback class", () => {
  const box = bodyEl(review({pr: 9, k: 1, dir: RV2, findings: card("PR-COR-001", {severity: "constructor"})}), {}, "RV2");
  const sev = box.querySelector(".adp-dl__head .adp-chip[title=severity]")!;
  assert.deepEqual([sev.textContent, sev.className], ["constructor", "adp-chip"]);
  assert.doesNotMatch(box.innerHTML, /function/);
});

// ---- the panels' markup ----

/* R14. We render the rail from railGroups over fixture tickets set to each
   state. Each one carries no watch, decision, or missing section, so only
   the one we mark needs attention lands there. */
const R14_BASE = (await S.loadCorpus(diskFetch()))!.index.tickets[0]!;
// The rail's fold and filter props at rest: open, wide, and unfiltered.
const RAIL_REST = {total: 0, filter: "", folded: false, narrow: false, attention: 0, selId: null, focusFilter: 0, onFilter(){}, onFold(){}};
const asState = (dir: string, state: string, missing: string[] = []) =>
  ({...R14_BASE, dir, id: dir, state, watches: [], decisions: [], missing}) as typeof R14_BASE;
function railOf(tickets: (typeof R14_BASE)[]){
  const today = "2026-11-13";
  const groups: S.RailModelGroup[] = D.railGroups(tickets, today).map(([name, list]) =>
    [name, list.map(t => ({key: t.dir, id: t.id || t.dir, date: t.date, slug: t.slug, ribbon: D.ribbonModel(t, today), closable: false}))]);
  render(createElement(Rail, {...RAIL_REST, groups, selKey: null, collapsed: new Set(["closed"]), onPick(){}, onToggle(){}}));
  return $$("#rail [data-sec]").map(s => [s.getAttribute("data-sec"), s.querySelector("[data-part=count]")!.textContent, s.getAttribute("aria-expanded")]);
}

test("the rail shows needs attention, open, in review, shipped, and closed, with closed folded", () => {
  const heads = railOf([asState("A", "shipped", ["Decision Log"]), asState("B", "open"), asState("C", "in-review"),
    asState("D", "shipped"), asState("E", "closed")]);
  assert.deepEqual(heads, [["needs attention", "1", "true"], ["open", "1", "true"], ["in review", "1", "true"],
    ["shipped", "1", "true"], ["closed", "1", "false"]]);
  assert.ok(!$("#rail").textContent!.includes("in progress"), "no group reads in progress");
  assert.ok(!$('#rail [data-key="E"]'), "the folded closed group shows no rows");
});

test("an empty open or in-review group renders nothing, and closed with no tickets shows folded with 0", () => {
  assert.deepEqual(railOf([asState("D", "shipped")]), [["shipped", "1", "true"], ["closed", "0", "false"]]);
});

test("the corpus boot draws its groups in R14 order", async () => {
  await bootCorpus();
  assert.deepEqual($$("#rail [data-sec]").map(s => s.getAttribute("data-sec")), ["needs attention", "open", "closed"]);
});

// ---- the phase strip ----

const sec = (key: string, phase: number | null, canonical = true, missing = false) => ({key, phase, canonical, missing});
const boxes = () => $$("#phaseStrip .adp-phases__boxes > *").filter(b => b.textContent).map(b =>
  b.textContent + (b.classList.contains("adp-phase--missing") ? "-" : "") + (b.getAttribute("aria-current") === "step" ? "*" : ""));

test("the strip model marks written, missing, current, and extra boxes, and says which", () => {
  const all = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => sec("p" + n, n));
  const m = stripModel([...all, sec("p7b", 7), sec("ledger", null, false)], "p7b");
  assert.equal(m.note, "All nine phases written");
  assert.deepEqual(m.phases.map(b => b.key), all.map(e => e.key));
  // A second canonical section of a phase lights that phase's box.
  assert.deepEqual(m.phases.filter(b => b.current).map(b => b.label), ["7"]);
  assert.deepEqual([m.extra!.label, m.extra!.title, m.extra!.key, m.extra!.current], ["+1", "1 extra section", "ledger", false]);
  assert.equal(m.prompt.missing, true);
  assert.deepEqual(m.steps, [...all.map(e => e.key), "ledger"]);
  const inc = stripModel([sec("p1", 1), sec("missing:Knowledge Gap Document", 2, true, true), sec("p5", 5), sec("closure", null, false)], "closure");
  assert.equal(inc.note, "Dashed boxes are missing phases");
  assert.deepEqual(inc.phases.filter(b => b.missing).map(b => b.label), ["2", "3", "4", "6", "7", "8", "9"]);
  assert.equal(inc.extra!.current, true);
  const only = stripModel([{key: "prompt", phase: null, canonical: false, missing: false, prompt: true}], "prompt");
  assert.equal(only.note, "Prompt only · no phase written yet");
  assert.equal(only.prompt.current, true);
  assert.equal(only.extra, null);
});

// A log that skips phases warns above the strip, as the TicketIncomplete
// board does: the label counts the gap and the text names what is there.
test("the missing-phases note counts the gap and names what the log holds", () => {
  const all = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => sec("p" + n, n));
  assert.equal(gapNote(stripModel(all, null), ["Closure"]), null);
  assert.equal(gapNote(stripModel([], null), []), null);
  assert.deepEqual(gapNote(stripModel([sec("p1", 1), sec("p5", 5)], null), ["Closure", "Sweep amendment"]),
    {label: "7 OF 9 PHASES MISSING", text: "This log has only Phase 1 and Phase 5, plus 2 extra sections: Closure and Sweep amendment."});
  assert.deepEqual(gapNote(stripModel([sec("p1", 1), sec("p2", 2), sec("p5", 5)], null), ["A", "B", "C"]),
    {label: "6 OF 9 PHASES MISSING", text: "This log has only Phase 1, Phase 2, and Phase 5, plus 3 extra sections: A, B, and C."});
  assert.deepEqual(gapNote(stripModel([sec("p5", 5)], null), []),
    {label: "8 OF 9 PHASES MISSING", text: "This log has only Phase 5."});
  assert.deepEqual(gapNote(stripModel([], null), ["Ledger"]),
    {label: "9 OF 9 PHASES MISSING", text: "This log has no phase yet, only 1 extra section: Ledger."});
});

test("the strip opens a phase or the extra sections, and the select still lists every section", async () => {
  await bootCorpus({hash: "#t=AA1&s=sec-decision-log"});
  assert.equal($("#gapNote .adp-notice__label").textContent, "5 OF 9 PHASES MISSING");
  assert.equal($("#gapNote").getAttribute("role"), "note");
  assert.deepEqual(boxes(), ["P", "1", "2-", "3-", "4-", "5*", "6-", "7", "8-", "9", "+1"]);
  assert.equal($("#phaseStrip .adp-phases__note").textContent, "Dashed boxes are missing phases");
  await click($('#phaseStrip [data-step="sec-pr-summary"]'));
  assert.equal(secVal(), "sec-pr-summary");
  await click($$("#phaseStrip a").find(b => b.textContent === "+1")!);
  assert.equal(secVal(), "sec-aside-notes");
  assert.deepEqual(boxes().filter(b => b.endsWith("*")), ["+1*"]);
  assert.ok(options().includes("sec-aside-notes"), "the select keeps the extra section");
  assert.ok(!$("#reviewsBtn"), "the ticket head offers no reviews entry");
});

test("← and → step through the strip, but not from a field or under the Packs drawer", async () => {
  await bootCorpus({hash: "#t=AA1&s=sec-decision-log"});
  await key(document.body, "ArrowRight");
  assert.equal(secVal(), "sec-pr-summary");
  await key(document.body, "ArrowRight");
  await key(document.body, "ArrowRight");
  assert.equal(secVal(), "sec-aside-notes");
  await key(document.body, "ArrowRight");
  assert.equal(secVal(), "sec-aside-notes", "the last box stays put");
  for (let i = 0; i < 6; i++) await key(document.body, "ArrowLeft");
  assert.equal(secVal(), "prompt");
  await key($("#secSel"), "ArrowRight");
  await key($("#railFilter"), "ArrowRight");
  assert.equal(secVal(), "prompt", "an arrow in a field moves nothing");
  await click($("#packsBtn"));
  await key(document.body, "ArrowRight");
  await click($('[aria-label="Close packs"]'));
  assert.equal(secVal(), "prompt", "an arrow under the drawer moves nothing");
});

test("one reviews box opens the latest round, and the reviews screen's head and strip lead back to the ticket", async () => {
  await bootReviews(reviewCorpus(), "#t=RV1&s=sec-decision-log");
  const was = secVal();
  const box = $('#phaseStrip [data-op="reviews"]');
  assert.equal(box.textContent, "Reviews · 4");
  assert.equal(box.getAttribute("title"), "4 review rounds");
  assert.equal(box.style.whiteSpace, "nowrap");
  await click(box);
  assert.equal($(".screen.is-on").getAttribute("data-s"), "reviews");
  assert.match($("#revHead").innerHTML, /PR #7 · round 10/);
  // The reviews screen leads with the ticket's head and strip, the Reviews box current.
  assert.equal($('#scrReviews #phaseStrip [data-op="reviews"]').getAttribute("aria-current"), "step");
  assert.ok($("#scrReviews #tickHead h1"), "the reviews screen has no ticket head");
  await click($('#scrReviews [data-view="section"]'));
  assert.equal($(".screen.is-on").getAttribute("data-s"), "inspector");
  assert.equal(secVal(), was, "the ticket view keeps the section the reader left");
  await click($('#phaseStrip [data-op="reviews"]'));
  await click($$("#scrReviews #phaseStrip a[data-step]")[0]);
  assert.equal($(".screen.is-on").getAttribute("data-s"), "inspector", "a phase box does not lead back");
  // The reviews box is the strip's last stop for → too, and ← steps back.
  for (let i = 0; i < 12 && $(".screen.is-on").getAttribute("data-s") === "inspector"; i++) await key(document.body, "ArrowRight");
  assert.equal($(".screen.is-on").getAttribute("data-s"), "reviews", "→ never reaches the reviews");
  assert.match($("#revHead").innerHTML, /PR #7 · round 10/);
  await key(document.body, "ArrowLeft");
  assert.equal($(".screen.is-on").getAttribute("data-s"), "inspector");
  await key($("#secSel"), "ArrowRight");
  assert.equal($(".screen.is-on").getAttribute("data-s"), "inspector", "an arrow in the select moves nothing");
});

// ---- the ticket head ----

test("the ticket head reads the meta line, the title, the state and its source, and opens the resume pack", async () => {
  await boot({fetch: diskFetch(), now: BASELINE_NOW, hash: "#t=FX001"});
  const head = $("#tickHead");
  assert.equal(head.querySelector("div")!.firstElementChild!.textContent, "FX001 · 2026-08-15 · 20260815-FX001-declared-lifecycle");
  assert.ok(head.querySelector("h1"), "the head has no title");
  const chip = head.querySelector(".adp-chip")!;
  assert.equal(chip.textContent, "shipped");
  assert.equal(chip.className, "adp-chip adp-chip--validated");
  assert.deepEqual($$("#tickHead [aria-label=View] button").map(b => [b.textContent, b.getAttribute("aria-pressed")]),
    [["Section", "true"], ["Full log", "false"]]);
  await click($('#tickHead [data-op="resume"]'));
  assert.ok($("#packDrawer"), "Resume pack opens no drawer");
  assert.equal(($("#packSel") as HTMLSelectElement).value, "resume-ticket");
  await click($('[aria-label="Close packs"]'));
  assert.ok(document.activeElement === $('#tickHead [data-op="resume"]'), "focus does not return to Resume pack");
});

// ---- the decision card ----

// R4: color means status only, so a confidence word is a neutral Tag.
test("a MEDIUM decision that is OPEN colors only its status chip", async () => {
  const log = LOG.replace("- **Confidence:** LOW", "- **Confidence:** MEDIUM");
  await boot({hash: "#t=AA1&s=sec-decision-log", fetch: liveCorpus(LISTING, {...TEXTS, "20260101-AA1-alpha/audit-log.md": log}).fetch});
  const card = $('#scrInspector [data-card="DL-002"]');
  const [conf, status] = [...card.querySelectorAll(".adp-dl__head .adp-chip")];
  assert.deepEqual([conf.textContent, conf.className], ["MEDIUM", "adp-chip"]);
  assert.deepEqual([status.textContent, status.className], ["OPEN", "adp-chip adp-chip--open"]);
  // The status value "OPEN — rides" keeps its tail as a note row.
  assert.deepEqual([...card.querySelectorAll("dt")].map(d => d.textContent).slice(-1), ["status note"]);
  assert.equal(card.querySelector("div:last-child > dd")!.textContent, "rides");
  // A settled entry sets its title lighter, and an open one does not.
  assert.equal($('#scrInspector [data-card="DL-001"]').className, "adp-dl adp-dl--settled");
  assert.equal(card.className, "adp-dl");
});

/* A section opens its first card and folds the rest. A fold sets an inline
   display, because the card body's own display rule outranks the hidden
   attribute, and the browser test checks what a reader sees. */
test("a section opens its first decision card, folds the rest, and a head click flips a card", async () => {
  await bootCorpus({hash: "#t=AA1&s=sec-decision-log"});
  const parts = (id: string) => {
    const card = $(`#scrInspector [data-card="${id}"]`);
    return {head: card.querySelector(".adp-dl__head") as HTMLElement, body: card.querySelector(".adp-dl__body") as HTMLElement};
  };
  const first = parts("DL-001"), second = parts("DL-002");
  assert.deepEqual([first.head.getAttribute("aria-expanded"), first.body.style.display], ["true", ""]);
  assert.deepEqual([second.head.getAttribute("aria-expanded"), second.body.style.display], ["false", "none"]);
  assert.equal(second.head.querySelector(".adp-dl__caret")!.textContent, "▸");
  await click(second.head.querySelector(".adp-dl__title")!);
  assert.deepEqual([second.head.getAttribute("aria-expanded"), second.body.style.display], ["true", ""]);
  assert.equal(second.head.querySelector(".adp-dl__caret")!.textContent, "▾");
  await click(first.head);
  assert.deepEqual([first.head.getAttribute("aria-expanded"), first.body.style.display], ["false", "none"]);
});

// ---- the Reading rules ----

// R7: in the shell, a run-in label is an eyebrow heading and the metadata
// lines are one footer line. The parser's default render stays as it was.
test("a run-in label renders as an eyebrow heading and the metadata lines as one footer, in the shell only", async () => {
  const ps = "**What the problem is:** demo.\n\n**What the problem is not:**\n- a list item\n\n"
    + "**Confirmed by:** russbeye   **Date:** 2026-01-01\n**Revision history:** none";
  const log = LOG.replace("**What the problem is:** demo.", ps);
  await boot({hash: "#t=AA1&s=sec-problem-statement", fetch: liveCorpus(LISTING_I, {...TEXTS_I, "20260101-AA1-alpha/audit-log.md": log}).fetch});
  const prose = $("#scrInspector .adp-prose");
  assert.deepEqual([...prose.querySelectorAll("h3[data-runin]")].map(h => h.textContent), ["What the problem is", "What the problem is not"]);
  assert.equal(prose.querySelector("h3 + p")!.textContent, "demo.");
  assert.equal(prose.querySelector("h3 + p + h3 + ul li")!.textContent, "a list item");
  // A list item's content sits in one span, so the item's flex row never
  // splits text from its inline code.
  assert.equal(prose.querySelector("h3 + p + h3 + ul li")!.children.length, 1);
  assert.equal(prose.querySelector("h3 + p + h3 + ul li")!.firstElementChild!.tagName, "SPAN");
  assert.equal(prose.querySelector("footer")!.textContent, "Confirmed by: russbeye · Date: 2026-01-01 · Revision history: none");
  assert.equal(prose.querySelectorAll("footer").length, 1);
  const plain = P.renderSectionBody(ps);
  assert.ok(!/<h3|<footer/.test(plain), "the default render changed");
  assert.match(plain, /<strong>What the problem is:<\/strong> demo\./);
});

// The template writes its fields on consecutive lines, metadata included.
// A bold sentence that does not end in a colon is not a run-in label, and a
// metadata line that does not close the section stays prose.
test("the Reading rules read the template's consecutive fields and leave other bold text as prose", () => {
  const html = P.renderProse("**What the problem is:** a.\n**What the problem is not:** b.\n**Confirmed by:** x   **Date:** 2026-01-01");
  assert.equal(html, '<h3 data-runin="">What the problem is</h3><p>a.</p><h3 data-runin="">What the problem is not</h3><p>b.</p>'
    + '<footer data-meta=""><span>Confirmed by:</span> x<span aria-hidden="true"> · </span><span>Date:</span> 2026-01-01</footer>');
  assert.match(P.renderProse("- one `code` two"), /<li><span>one <code[^>]*>code<\/code> two<\/span><\/li>/);
  const plain = P.renderProse("**Gate 4 confirmation (solo).** Done.\n\n**Date:** 2026-01-01\n\nMore text.");
  assert.ok(!/<h3|<footer/.test(plain), plain);
});

// The markdown blocks inside Prose take the design system's patterns or its
// on-grid values, and no old theme class that sets their spacing (DL-059).
test("prose blocks take the Table and Pre components and on-grid values, and the default render keeps the old markup", () => {
  const md = ["| a | b |", "|---|---|", "| 1 | `x` |", "", "> quoted", "", "```", "let a = 1;", "```", "", "1. one", "", "---", "",
    "- [x] done", "", "### Sub head"].join("\n");
  const html = P.renderProse(md);
  assert.match(html, /<div style="overflow-x:auto;margin:0 0 16px"><table class="adp-table">/);
  assert.match(html, /<blockquote style="margin:0 0 16px;padding:8px 16px;[^"]*"><p style="margin:0">quoted<\/p><\/blockquote>/);
  assert.match(html, /<pre class="adp-pre" style="margin:0 0 16px"><code style="font:inherit;color:inherit;background:none;padding:0">let a = 1;<\/code><\/pre>/);
  assert.match(html, /<div role="list" style="margin:0 0 16px;[^"]*"><div role="listitem" style="display:grid;grid-template-columns:24px minmax\(0,1fr\);gap:8px"><span data-num="" style="font:400 12px\/24px var\(--font-mono\);color:var\(--blue-bright\)">1<\/span><span>one<\/span><\/div><\/div>/);
  assert.match(P.renderProse("3. three\n4. four"), />3<\/span><span>three<\/span>[\s\S]*>4<\/span><span>four<\/span>/);
  assert.match(html, /<hr style="margin:24px 0;/);
  assert.match(html, /<li class="task"><span style="display:inline-flex;[^"]*width:16px;height:16px;[^"]*">✓<\/span><span>done<\/span><\/li>/);
  assert.match(html, /<h3 style="margin:32px 0 8px;font:500 11px\/24px var\(--font-mono\);[^"]*color:var\(--blue-bright\)">Sub head<\/h3>/);
  assert.doesNotMatch(html, /md-tbl|tbl-wrap|class="cb"|class="sub"|cbx|<ol/);
  const plain = P.renderMarkdown(md);
  assert.match(plain, /<table class="md-tbl">/);
  assert.match(plain, /<pre class="cb">/);
});

// R4 in prose (DL-055, DL-060): a confidence word is a neutral small chip,
// and a status word takes its StatusChip, in prose and in a card's fields.
test("a confidence word in prose is a neutral chip, and a status word takes its status chip", async () => {
  const log = LOG.replace("**What the problem is:** demo.", "**What the problem is:** a MEDIUM risk left OPEN.")
    .replace("- **Decision:** pick b", "- **Decision:** pick b at HIGH");
  await boot({hash: "#t=AA1&s=sec-problem-statement", fetch: liveCorpus(LISTING_I, {...TEXTS_I, "20260101-AA1-alpha/audit-log.md": log}).fetch});
  const chips = [...$("#scrInspector .adp-prose p").querySelectorAll(".adp-chip")].map(c => [c.textContent, c.className]);
  assert.deepEqual(chips, [["MEDIUM", "adp-chip adp-chip--s"], ["OPEN", "adp-chip adp-chip--s adp-chip--open"]]);
  assert.ok(!$("#scrInspector .adp-prose .pill"), "an old pill is left in prose");
  await pickSection("sec-decision-log");
  await click($('#scrInspector [data-card="DL-002"] .adp-dl__head'));
  const field = $('#scrInspector [data-card="DL-002"] dd .adp-chip');
  assert.deepEqual([field.textContent, field.className], ["HIGH", "adp-chip adp-chip--s"]);
  // A token in a run-in heading or the footer converts too.
  assert.match(P.renderProse("**Risk at LOW:** x"), /<h3 data-runin="">Risk at <span class="adp-chip adp-chip--s">LOW<\/span><\/h3>/);
});

// ---- the rail's fold, filter, and narrow overlay ----

const railCols = () => ($(".main") as HTMLElement).style.gridTemplateColumns;

test("the rail folds to its strip and back, by button or by [, and remembers the fold per repo", async () => {
  await bootCorpus();
  assert.equal($("#rail .adp-rail__head .adp-label").textContent, "2 tickets");
  await click($("#railHide"));
  assert.ok(!$("#rail"), "a folded rail shows no rows");
  assert.equal(railCols(), "var(--rail-collapsed) minmax(0, 1fr)");
  assert.equal(localStorage.getItem("adp-rail:demo"), "folded");
  // The strip counts what needs attention and names the selected ticket.
  assert.equal($("#railStrip .adp-chip").textContent, "1");
  assert.equal($("#railStrip .adp-chip").getAttribute("aria-label"), "1 ticket needs attention");
  assert.equal($("#railStrip .adp-rail__vertical").textContent, "AA1");
  await click($("#railShow"));
  assert.ok($("#rail"));
  assert.equal(railCols(), "var(--rail-width) minmax(0, 1fr)");
  assert.equal(localStorage.getItem("adp-rail:demo"), null);
  await key(document.body, "[");
  assert.ok(!$("#rail"), "[ folds the rail");
  await key(document.body, "[");
  assert.ok($("#rail"), "[ opens it again");
  await key($("#railFilter"), "[");
  assert.ok($("#rail"), "[ typed into the filter folds nothing");
});

test("a fold stored for this repo opens the page with the rail folded", async () => {
  await bootCorpus({stored: {"adp-rail:demo": "folded"}});
  assert.ok($("#railStrip"));
  assert.ok(!$("#rail"));
});

test("the filter narrows the rail, counts what it shows, and says when nothing matches", async () => {
  await bootCorpus();
  fireEvent.change($("#railFilter"), {target: {value: "av002"}});
  await settle(1);
  assert.deepEqual(rentries(), ["AV002"]);
  assert.equal($("#rail .adp-rail__head .adp-label").textContent, "1 of 2 tickets");
  assert.deepEqual($$("#rail [data-sec]").map(s => s.getAttribute("data-sec")), ["open", "closed"]);
  fireEvent.change($("#railFilter"), {target: {value: "zebra"}});
  await settle(1);
  assert.equal($("#rail [role=status]").textContent, "No tickets match “zebra”Esc clears the filter.Clear filter");
  assert.deepEqual($$("#rail [data-sec]").map(s => s.getAttribute("data-sec")), ["closed"]);
  await key($("#railFilter"), "Escape");
  assert.equal(($("#railFilter") as HTMLInputElement).value, "");
  assert.deepEqual(rentries(), ["AA1", "AV002"]);
  fireEvent.change($("#railFilter"), {target: {value: "zebra"}});
  await settle(1);
  await click([...$$("#rail button")].find(b => b.textContent === "Clear filter")!);
  assert.equal(($("#railFilter") as HTMLInputElement).value, "");
  assert.ok(document.activeElement === $("#railFilter"), "Clear filter hands focus back to the field");
});

test("/ opens a folded rail and moves into its filter", async () => {
  await bootCorpus();
  await click($("#railHide"));
  await key(document.body, "/");
  assert.ok($("#rail"));
  assert.ok(document.activeElement === $("#railFilter"), "focus is not in the filter");
});

/* jsdom matches no media query, so a narrow test stands in a matchMedia
   that matches the narrow width and reports no change. */
async function bootNarrow(){
  const mq = (q: string) => ({matches: q === "(max-width: 807px)", addEventListener(){}, removeEventListener(){}});
  Object.defineProperty(window, "matchMedia", {configurable: true, value: mq});
  return bootCorpus();
}

test("on a narrow window the rail starts folded and opens over the page", async () => {
  try {
    await bootNarrow();
    assert.ok($("#railStrip"));
    assert.ok(!$("#rail"));
    await click($("#railShow"));
    assert.equal(($("#rail") as HTMLElement).style.position, "absolute");
    assert.ok($("#railStrip"), "the strip keeps its column under the open rail");
    assert.equal(railCols(), "var(--rail-collapsed) minmax(0, 1fr)");
    assert.ok(document.activeElement === $("#railFilter"), "the open rail takes focus into its filter");
    assert.equal(localStorage.getItem("adp-rail:demo"), null);
    await key(document.body, "Escape");
    assert.ok(!$("#rail"), "Escape folds the rail");
    assert.ok(document.activeElement === $("#railShow"), "focus returns to the » button");
    await click($("#railShow"));
    await click($(".main .adp-scrim"));
    assert.ok(!$("#rail"), "the scrim folds the rail");
    await click($("#railShow"));
    await click(entry("AV002"));
    assert.ok(!$("#rail"), "a pick folds the rail");
    assert.equal($("#railStrip .adp-rail__vertical").textContent, "AV002");
  } finally {
    delete (window as {matchMedia?: unknown}).matchMedia;
  }
});

test("the closed group starts collapsed, and a click opens it", async () => {
  await bootCorpus();
  const closed = () => $$("#rail [data-sec]").find(s => s.getAttribute("data-sec") === "closed")!;
  assert.match(closed().innerHTML, /▸/);
  await click(closed());
  assert.match(closed().innerHTML, /▾/);
});

test("the rail renders hostile harvested fields as text", () => {
  const hostile = "<img src=x onerror=alert(1)>";
  const {container} = render(createElement(Rail, {...RAIL_REST, groups: [["needs attention", [{key: hostile, id: hostile, date: hostile,
    slug: hostile, closable: false, ribbon: {reasons: [{txt: hostile, tone: "warn"}], more: 0}}]]],
    selKey: null, collapsed: new Set<string>(), onPick(){}, onToggle(){}}));
  assert.ok(!container.innerHTML.includes("<img"));
  assert.ok(container.textContent!.includes(hostile));
});

test("the decisions panel renders hostile harvested fields as text", () => {
  const hostile = "<img src=x onerror=alert(1)>";
  const {container} = render(createElement(DecisionsPanel, {...panelProps, label: hostile, rows: [{id: hostile, title: hostile, conf: hostile,
    confKind: "other", statusKind: "open", watch: hostile, settled: null, chips: [{key: hostile, label: hostile, title: hostile}], hl: false}]}));
  assert.ok(!container.innerHTML.includes("<img"));
  assert.ok(container.textContent!.includes(hostile));
});

test("a decision card in a companion section renders as a card in the inspector", async () => {
  const log = LOG.replace("Some **prose** citing DL-002.",
    "Some **prose** citing DL-002.\n\n### [DL-009] An aside decision\n- **Decision:** x\n- **Confidence:** HIGH\n- **Status:** OPEN\n\nAfter the card.");
  await boot({fetch: liveCorpus(LISTING_I, {...TEXTS_I, "20260101-AA1-alpha/audit-log.md": log}).fetch});
  await pickSection("sec-aside-notes");
  const pane = insp();
  assert.match(pane, /<div class="adp-dl" data-card="DL-009">/);
  assert.match(pane, /<span class="adp-chip" title="confidence">HIGH<\/span>/);
  assert.match(pane, /<span class="adp-chip adp-chip--open" title="status">OPEN<\/span>/);
  assert.match(pane, /<\/div><\/div><p>After the card\.<\/p>/);
});

// DL-051: a card list that follows other content sits 16px below it, and a
// list that opens its section takes no gap.
test("a card list keeps a space-4 gap below content above it, and none at the top of a section", async () => {
  const log = LOG.replace("Some **prose** citing DL-002.",
    "Some **prose** citing DL-002.\n\n### [DL-009] An aside decision\n- **Decision:** x\n- **Confidence:** HIGH\n- **Status:** OPEN");
  await boot({hash: "#t=AA1&s=sec-decision-log", fetch: liveCorpus(LISTING_I, {...TEXTS_I, "20260101-AA1-alpha/audit-log.md": log}).fetch});
  assert.equal(($("#scrInspector .adp-dl-list") as HTMLElement).style.marginTop, "");
  await pickSection("sec-aside-notes");
  assert.equal(($("#scrInspector .adp-dl-list") as HTMLElement).style.marginTop, "16px");
});

test("a due cell in the watches panel holds a date on one line and lets window prose wrap", () => {
  const prose = "until the developer's next live session with the testbed, no later than the start of ZUP-B3";
  const row = (o: {dueText: string; dueDated: boolean}) => ({wid: "OT-A1-1", what: "w", dls: [], state: "upcoming" as const,
    stateLabel: "upcoming 30d", chips: [], hl: false, ...o});
  const {container} = render(createElement(WatchesPanel, {label: "x", sort: {k: "wid", d: 1}, onSort(){}, onWatch(){}, onChip(){},
    rows: [row({dueText: "2026-12-24", dueDated: true}), {...row({dueText: prose, dueDated: false}), wid: "OT-A1-2"}]}));
  const html = container.innerHTML;
  assert.ok(html.includes('<td class="mono nw">2026-12-24</td>'));
  assert.ok(html.includes('<td class="mono">until the developer'));
  assert.ok(html.includes('<td class="mono nw">OT-A1-1</td>'));
  assert.ok(html.includes('<span class="st-upcoming nw">upcoming 30d</span>'));
});

test("the inspector marks an anchored watch's due text as dated and an unanchored one as prose", async () => {
  await bootCorpus();
  await pickSection("sec-obligation-ticket-list");
  assert.ok(insp().includes('<td class="mono nw">2099-01-01</td>'));
  assert.ok(insp().includes('<td class="mono">60 days after merge</td>'));
});

test("the decisions panel and the ledger hold every id, label, and age on one line", async () => {
  const {container} = render(createElement(DecisionsPanel, {...panelProps, rows: [{id: "DL-104", title: "t", conf: "MEDIUM",
    confKind: "medium", statusKind: "open", watch: null, settled: null, chips: [], hl: false}]}));
  const panel = container.innerHTML;
  assert.ok(panel.includes('<td class="mono nw">DL-104</td>'));
  assert.ok(panel.includes('<span class="cf-medium nw">MEDIUM</span>'));
  assert.ok(panel.includes('<span class="st-open nw">open</span>'));
  assert.ok(panel.includes('<td><span class="st-unanchored nw">no watch</span></td>'));
  cleanup();
  const log = ["## Decision Log", "", "### [DL-104] t", "- **Confidence:** MEDIUM", "- **Created:** 2026-08-13", "- **Status:** OPEN", ""].join("\n");
  await boot({fetch: liveCorpus({root: "demo", files: ["20260101-A1-one/audit-log.md"]}, {"20260101-A1-one/audit-log.md": log}).fetch});
  await click(tabFor("ledgers"));
  const ledger = $("#scrLedgers").innerHTML;
  assert.match(ledger, /<td class="mono nw"><a class="wbl"[^>]*data-item="DL-104">DL-104<\/a><\/td>/);
  assert.ok(ledger.includes('<span class="cf-medium nw">MEDIUM</span>'));
  assert.ok(ledger.includes('<span class="st-open nw">open</span>'));
  assert.ok(ledger.includes('<td class="mono nw">12d</td>'));
});

// ---- what the app leaves out ----

test("the app offers no file input, no drop mask, and no opened-documents group", async () => {
  await bootBoard();
  assert.equal($$('input[type="file"]').length, 0);
  assert.equal($$(".shellmask").length, 0);
  assert.equal($$(".rclose").length, 0);
  assert.ok(!$$("#rail [data-sec]").some(s => s.getAttribute("data-sec") === "opened documents"));
});

// V4, V5, and V6: the inspector keeps its view toggles and loses every
// control that loaded a file from outside .adp (DL-071, DL-072, DL-073).
test("the inspector offers no open, reload, or paste control and no paste drawer", async () => {
  await bootCorpus();
  for (const name of ["openwatch", "reload", "paste"]) assert.equal($$('[data-op="' + name + '"]').length, 0, name);
  assert.equal(document.getElementById("pasteArea"), null);
  assert.equal(document.getElementById("pasteImport"), null);
  assert.ok(!$("#scrInspector").textContent!.includes("drag & drop"));
  assert.deepEqual($$("#scrInspector [role=group][aria-label=View] button").map(b => b.getAttribute("data-view")), ["section", "full"]);
});

test("the app closes its event stream when it unmounts", async () => {
  const {feed} = await bootBoard();
  cleanup();
  assert.equal(feed.closed, true);
});

// ---- New task ----

const GOLDEN = readFixture("builder-example.yaml");
// The bytes the standalone builder exported for the same form contents and
// for each prompt that sameOnBoth() starts from, so the app keeps writing
// what the standalone wrote.
const STANDALONE = JSON.parse(readFixture("standalone-exports.json")) as {form: string; prompts: {input: string; output: string}[]};
// The ticket the prompt tests start from. Its prompt is the whole ticket,
// so the inspector opens on the prompt pane.
const PFILE = "20260618-GROW6687-email-validation/prompt.yaml";
const stamped = (d: PL.PromptDocument) => { d.schema_version = "1.0"; return d; };
const ntField = (nf: string) => $$("#scrNew .nt-in").find(el => el.getAttribute("data-nf") === nf) as HTMLInputElement;
const ntOp = (name: string) => click($$("#scrNew .op").find(o => o.getAttribute("data-op") === name)!);
const ntType = async (el: Element, value: string) => { fireEvent.change(el, {target: {value}}); await settle(1); };
const ntSet = (nf: string, value: string) => ntType(ntField(nf), value);
const ntOps = () => $("#ntOps").textContent!;
const ntSide = () => $("#ntSide");
const ntChecks = () => $$("#ntSide code").map(c => c.textContent!);
const ntAdd = (list: string) => click($$(".nt-add").find(b => b.getAttribute("data-nadd") === list)!);
const ntChip = (a: string) => $$("#scrNew input").find(i => i.getAttribute("data-nart") === a) as HTMLInputElement;
const ntSwitch = (k: string) => $$("#scrNew input").find(i => i.getAttribute("data-nf") === "protocol." + k) as HTMLInputElement;
const ticked = () => $$("#scrNew input").filter(i => (i as HTMLInputElement).checked && i.getAttribute("data-nart")).map(i => i.getAttribute("data-nart"));
const draft = () => JSON.parse(localStorage.getItem("adp-mc-draft")!);
async function preview(){
  if (!document.getElementById("ntYamlPre")) await ntOp("ntyaml");
  return $("#ntYamlPre").textContent!;
}
// The timers New task arms: the draft pause, the clear window, and the copy
// label. Date stays at the boot's fixed day.
function ntTimers(){
  vi.useFakeTimers({toFake: ["Date", "setTimeout", "clearTimeout"]});
  vi.setSystemTime(NOW);
  fakeTimeouts = true;
}
// A second boot in one test needs the first one's spies and timers gone.
function reboot(){
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  fakeTimeouts = false;
}
const advance = (ms: number) => act(async () => { vi.advanceTimersByTime(ms); });
const today = () => S.localDate();

/* A corpus with one prompt-only ticket. A test changes the prompt's text,
   and the server's event brings the new text in, the way an edit on disk
   reaches a served page. */
async function bootPrompt(text = GOLDEN, opts: BootOpts = {}){
  const live = liveCorpus({root: "demo", files: [PFILE]}, {[PFILE]: text});
  const b = await boot({fetch: live.fetch, ...opts});
  return {...b, live};
}
type PromptBoot = Awaited<ReturnType<typeof bootPrompt>>;
async function startFrom(ctx: PromptBoot, text?: string, answer: "replace" | "keep" | null = "replace"){
  if (text != null){
    ctx.live.texts[PFILE] = text;
    await act(async () => { ctx.feed.onmessage!(); });
    await settle();
  }
  await tabTo("inspector");
  await click(op("data-op", "startfrom"));
  if (answer === "replace" && document.getElementById("ntReplace")) await click($("#ntReplace"));
  if (answer === "keep" && document.getElementById("ntKeep")) await click($("#ntKeep"));
}

// R8, the write half. The vanilla ops row held four controls that loaded a
// prompt from outside .adp, and the app has none of them.
const REMOVED_NT_OPS = {text: ["↑ open yaml", "⌨ paste", "load example", "drag & drop .yaml anywhere"], attrs: ["title=open a prompt.yaml"]};
test("the app's new task screen shows what the vanilla page showed, less the four load controls", async () => {
  await baselineBoot();
  await click($("#newTaskBtn"));
  const want = BASELINE["new task"];
  assert.deepEqual(snapshot(document), {...restyled(want), main: withoutOps(want.main!, REMOVED_NT_OPS)});
});

test("the new task screen carries the standalone's field set and boots with today's date", async () => {
  const ctx = await bootPrompt(GOLDEN, {hash: "#v=new%20task"});
  assert.equal(isOn("scrNew"), true);
  assert.equal($("#newTaskBtn").getAttribute("aria-pressed"), "true");
  await startFrom(ctx);
  const nfs = $$("#scrNew .nt-in").map(el => el.getAttribute("data-nf")).filter(Boolean) as string[];
  for (const k of ["task.id", "task.title", "task.author", "task.date", "preamble", "role.lens",
    "role.priorities.0", "prompt", "constraints.out_of_scope.0", "constraints.must_not.0",
    "context.background", "context.references.0.path", "context.references.0.lines",
    "context.references.0.note", "context.links.0", "lessons_learned.0.context",
    "lessons_learned.0.takeaway", "output.format", "output.destination", "output.structure",
    "requirements.0.id", "requirements.0.statement", "requirements.0.verify",
    "protocol.defers.0.phase", "protocol.defers.0.reason"]) assert.ok(nfs.includes(k), k);
  assert.equal(["apply", "stake_single_recommendation", "log_assumptions", "flag_low_confidence"].filter(k => ntSwitch(k)).length, 4);
  assert.deepEqual($$("#scrNew input").map(i => i.getAttribute("data-nart")).filter(Boolean), PL.ARTIFACTS);
  // Every path names a key the lib's document holds.
  const doc = stamped(PL.exampleDocument()) as unknown as Record<string, unknown>;
  for (const nf of nfs)
    assert.notEqual(nf.split(".").reduce<unknown>((o, k) => o == null ? undefined : (o as Record<string, unknown>)[k], doc), undefined, nf);
  reboot();
  // A fresh boot is blank apart from the date, and the badge counts the blank.
  const {hashes} = await bootPrompt();
  await click($("#newTaskBtn"));
  assert.equal(ntField("task.date").value, today());
  assert.equal(ntField("task.id").value, "");
  assert.match(ntSide().textContent!, /7 protocol checks unmet/);
  assert.equal(ntChecks()[0], "task.id");
  assert.match(ntSide().textContent!, /— required/);
  assert.match(last(hashes), /^#v=new%20task/);
});

// The ticket's prompt.yaml becomes the draft, field for field.
test("start from this prompt loads the ticket's prompt.yaml into a new draft equal to its parsed fields", async () => {
  const ctx = await bootPrompt();
  assert.equal(isOn("scrInspector"), true);
  await startFrom(ctx, undefined, null);
  assert.equal(isOn("scrNew"), true);
  const want = stamped(PL.normalize(PL.parseYAML(GOLDEN)));
  assert.deepEqual(draft().doc, want);
  assert.equal(draft().slug, "");
  assert.match(ntOps(), new RegExp(`imported ${PFILE} — all recognized fields\\.`));
  assert.equal(ntField("task.id").value, "GROW-6687-email-validation");
  assert.equal(ntField("protocol.defers.1.reason").value, "Follow-up obligations ride the GROW-6688 cleanup ticket");
  assert.equal(await preview(), GOLDEN);
  assert.equal(await preview(), PL.buildYaml(want));
  assert.match(ntSide().textContent!, /valid · schema 1\.0/);
});

test("the start action sits on the prompt pane alone, and an unreadable prompt has none", async () => {
  await bootCorpus();
  // AA1 opens on a log section, so its prompt pane is one pick away.
  assert.equal($$('[data-op="startfrom"]').length, 0);
  await pickSection("prompt");
  assert.equal($$('[data-op="startfrom"]').length, 1);
  await click($('[data-view="full"]'));
  assert.equal($$('[data-op="startfrom"]').length, 0);
  reboot();
  await boot({fetch: liveCorpus({root: "demo", files: [PFILE]}, {}).fetch});
  assert.match($("#scrInspector").textContent!, /could not be read/);
  assert.equal($$('[data-op="startfrom"]').length, 0);
});

test("an import reports the keys it could not place and a failed parse leaves the form alone", async () => {
  const ctx = await bootPrompt(GOLDEN + "\nfoo: bar\n");
  await startFrom(ctx);
  assert.match(ntOps(), new RegExp(`imported ${PFILE} with 1 issue: foo`));
  assert.equal(ntField("task.id").value, "GROW-6687-email-validation");
  // Not YAML: the form keeps what it held, and the report says so.
  await ntSet("task.title", "kept");
  await startFrom(ctx, ":::\n  - [");
  assert.equal(isOn("scrNew"), true);
  assert.match(ntOps(), new RegExp(`couldn't parse ${PFILE} as YAML`));
  assert.equal(ntField("task.title").value, "kept");
  await startFrom(ctx, "   ");
  assert.match(ntOps(), new RegExp(`nothing to import — ${PFILE} is empty\\.`));
  // A foreign version is named before the builder stamps its own.
  await startFrom(ctx, GOLDEN.replace('schema_version: "1.0"', 'schema_version: "2.0"'));
  assert.match(ntOps(), /schema_version is "2\.0"/);
  assert.match(await preview(), /^schema_version: "1\.0"/);
});

test("copy, download, and the directory line carry the export bytes and the convention's name", async () => {
  const got = stubClipboard();
  await boot();
  await click($("#newTaskBtn"));
  const day = today().replace(/-/g, "");
  assert.equal($("#ntDir").textContent, `.adp/${day}-<TASKID>-<slug>/prompt.yaml`);
  await ntSet("task.title", "Shared shell chrome, extracted!");
  await ntSet("task.id", "AV-016");
  assert.equal(($("#ntSlug") as HTMLInputElement).value, "");
  assert.equal($("#ntDir").textContent, `.adp/${day}-AV016-shared-shell-chrome-extracted/prompt.yaml`);
  await ntType($("#ntSlug"), "custom");
  assert.equal($("#ntDir").textContent, `.adp/${day}-AV016-custom/prompt.yaml`);
  await ntType($("#ntSlug"), "");
  assert.equal($("#ntDir").textContent, `.adp/${day}-AV016-shared-shell-chrome-extracted/prompt.yaml`);
  // The slug never reaches the yaml.
  assert.ok(!/slug/.test(await preview()));
  // Copy writes the preview's bytes and reports, then rests.
  ntTimers();
  fireEvent.click(op("data-op", "ntcopy"));
  await act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); });
  assert.equal(got.at(-1), await preview());
  assert.equal(op("data-op", "ntcopy").textContent, "copied");
  await advance(1200);
  assert.equal(op("data-op", "ntcopy").textContent, "⧉ copy yaml");
  // Download hands the export bytes to an anchor named for the task id.
  const blobs: Blob[] = [], clicked: string[] = [];
  URL.createObjectURL = (b: Blob) => { blobs.push(b); return "blob:nt"; };
  URL.revokeObjectURL = () => {};
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function(this: HTMLAnchorElement){ clicked.push(this.download); });
  fireEvent.click(op("data-op", "ntdl"));
  assert.deepEqual(clicked, ["AV-016.yaml"]);
  assert.equal(await blobs[0].text(), await preview());
});

test("a denied clipboard write says so and opens the yaml it sends the reader to", async () => {
  const got = stubClipboard(() => Promise.reject(new Error("denied")));
  const scrolled = recordScrolls();
  await boot();
  await click($("#newTaskBtn"));
  await click(op("data-op", "ntcopy"));
  assert.match(op("data-op", "ntcopy").textContent!, /copy failed — select the text/);
  assert.ok(document.getElementById("ntYamlPre"));
  assert.ok(scrolled.includes($("#ntYaml")));
  assert.deepEqual(got, []);
});

test("rows add and remove by path, an emptied defers editor drops the key, and chips keep the lib's order", async () => {
  await boot();
  await click($("#newTaskBtn"));
  await ntAdd("requirements");
  same(document.activeElement, ntField("requirements.0.id"), "focus left the new row");
  await ntSet("requirements.0.id", "R1");
  await ntSet("requirements.0.statement", "it works");
  await ntSet("requirements.0.verify", "run it");
  await ntAdd("protocol.defers");
  await ntSet("protocol.defers.0.phase", "analysis");
  await ntSet("protocol.defers.0.reason", "manual pass");
  assert.match(await preview(), /defers:\n    - phase: "analysis"\n      reason: "manual pass"/);
  await click($$(".nt-del").find(b => b.getAttribute("data-ndel") === "protocol.defers.0")!);
  assert.ok(!/defers/.test(await preview()));
  assert.match(await preview(), /- id: "R1"\n    statement: "it works"\n    verify: "run it"/);
  // Artifacts tick in any order and export in the lib's.
  await click(ntChip("problem_statement"));
  await click(ntChip("decision_log"));
  assert.match(await preview(), /artifacts:\n    - problem_statement\n    - test_adversary\n/);
  await click(ntSwitch("apply"));
  assert.match(await preview(), /apply: false/);
  await ntSet("output.format", "patch");
  assert.match(await preview(), /format: "patch"/);
});

test("a draft saves on a pause, flushes on pagehide, restores on the next boot, and clear needs a second click", async () => {
  await boot();
  await click($("#newTaskBtn"));
  ntTimers();
  await ntSet("task.id", "AV-016");
  await ntSet("task.title", "A title");
  await ntType($("#ntSlug"), "own-slug");
  assert.equal(localStorage.getItem("adp-mc-draft"), null);
  await advance(400);
  assert.equal(draft().doc.task.id, "AV-016");
  assert.equal(draft().slug, "own-slug");
  await ntSet("task.author", "russbeye");
  fireEvent(window, new Event("pagehide"));
  assert.equal(draft().doc.task.author, "russbeye");
  const saved = localStorage.getItem("adp-mc-draft")!;
  reboot();
  await boot({draft: saved});
  await click($("#newTaskBtn"));
  assert.equal(ntField("task.id").value, "AV-016");
  assert.equal(($("#ntSlug") as HTMLInputElement).value, "own-slug");
  assert.equal($("#ntDir").textContent, `.adp/${today().replace(/-/g, "")}-AV016-own-slug/prompt.yaml`);
  // One click arms, the timer disarms, and two clicks wipe and drop the key.
  ntTimers();
  await ntOp("ntclear");
  assert.match(ntOps(), /confirm clear/);
  assert.equal(ntField("task.id").value, "AV-016");
  await advance(1200);
  assert.ok(!/confirm clear/.test(ntOps()));
  await ntOp("ntclear");
  await ntOp("ntclear");
  assert.equal(ntField("task.id").value, "");
  assert.equal(ntField("task.date").value, today());
  assert.equal(localStorage.getItem("adp-mc-draft"), null);
});

test("a blocked storage and an unreadable draft both boot the blank form", async () => {
  const warn = vi.spyOn(console, "warn");
  const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
  const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
  await boot();
  await click($("#newTaskBtn"));
  assert.equal(ntField("task.id").value, "");
  ntTimers();
  await ntSet("task.id", "X-1");
  await advance(400);
  assert.equal(warn.mock.calls.length, 0);
  get.mockRestore(); set.mockRestore();
  reboot();
  await boot({draft: "{not json"});
  await click($("#newTaskBtn"));
  assert.equal(ntField("task.id").value, "");
  assert.equal(localStorage.getItem("adp-mc-draft"), null);
  reboot();
  // A draft in an older shape adopts what normalize reads.
  await boot({draft: JSON.stringify({doc: {task: {id: "OLD-1"}, lessons_learned: [null]}})});
  await click($("#newTaskBtn"));
  assert.equal(ntField("task.id").value, "OLD-1");
});

test("the builder renders the full form with no corpus", async () => {
  await boot({hash: "#v=new%20task"});
  assert.equal(isOn("scrNew"), true);
  // The blank form's twelve scalar fields. The lists start empty.
  assert.equal($$("#scrNew .nt-in").length, 12);
  assert.match(ntSide().textContent!, /7 protocol checks unmet/);
  assert.equal(ntField("task.date").value, today());
});

test("a corpus change never rebuilds the form under a typing reader", async () => {
  const ctx = await bootPrompt();
  await click($("#newTaskBtn"));
  const title = ntField("task.title");
  await ntType(title, "half a ti");
  title.focus();
  ctx.live.texts[PFILE] = GOLDEN.replace("GROW-6687", "GROW-1");
  await act(async () => { ctx.feed.onmessage!(); });
  await settle();
  same(ntField("task.title"), title, "the title input was rebuilt");
  assert.equal(title.value, "half a ti");
  same(document.activeElement, title, "the title input lost focus");
  // The new corpus did land behind the form.
  await tabTo("inspector");
  assert.match($("#scrInspector").textContent!, /GROW-1/);
});

test("a switch or chip toggles in place and keeps the keyboard", async () => {
  await boot();
  await click($("#newTaskBtn"));
  const sw = ntSwitch("apply");
  sw.focus();
  await click(sw);
  same(document.activeElement, sw, "the switch lost focus");
  same(ntSwitch("apply"), sw, "the switch was rebuilt");
  assert.equal(sw.parentElement!.classList.contains("is-on"), false);
  assert.match(await preview(), /apply: false/);
  const chip = ntChip("premortem");
  chip.focus();
  await click(chip);
  same(document.activeElement, chip, "the chip lost focus");
  assert.equal(chip.parentElement!.classList.contains("is-on"), true);
  assert.match(await preview(), /- premortem\n/);
});

test("a select drops its placeholder color on a pick and takes it back on a clear", async () => {
  await boot();
  await click($("#newTaskBtn"));
  await ntSet("output.format", "patch");
  assert.equal(ntField("output.format").classList.contains("is-unset"), false);
  await ntSet("output.format", "");
  assert.equal(ntField("output.format").classList.contains("is-unset"), true);
});

test("an imported format or phase the form cannot show is cleared and named, so the bytes match the form", async () => {
  const ctx = await bootPrompt(GOLDEN.replace('format: "patch"', 'format: "docx"').replace('phase: "communication"', 'phase: "deploy"'));
  await startFrom(ctx);
  assert.match(ntOps(), /with 2 issues/);
  assert.match(ntOps(), /output\.format "docx" is not a format/);
  assert.match(ntOps(), /protocol\.defers\[0\]\.phase "deploy" is not a phase/);
  assert.equal(ntField("output.format").value, "");
  assert.equal(ntField("protocol.defers.0.phase").value, "");
  const y = await preview();
  assert.ok(!/format:/.test(y));
  assert.ok(!/phase: "deploy"/.test(y));
  assert.match(y, /- phase: ""\n/);
  assert.ok(ntChecks().includes("output.format"));
});

test("a start onto a form in progress waits for a confirmation before it replaces the form and its draft", async () => {
  const ctx = await bootPrompt();
  await click($("#newTaskBtn"));
  ntTimers();
  await ntSet("task.id", "MINE-1");
  await advance(400);
  vi.useRealTimers();
  fakeTimeouts = false;
  await startFrom(ctx, undefined, null);
  // New task shows, the form and the draft stand, and the question is asked.
  assert.equal(isOn("scrNew"), true);
  assert.equal(ntField("task.id").value, "MINE-1");
  assert.equal(draft().doc.task.id, "MINE-1");
  assert.match(ntOps(), new RegExp(`replace it with ${PFILE}\\?`));
  await click($("#ntKeep"));
  assert.equal(ntField("task.id").value, "MINE-1");
  assert.ok(!/replace it with/.test(ntOps()));
  assert.match(ntOps(), new RegExp(`kept the form — ${PFILE} was not imported\\.`));
  await startFrom(ctx);
  assert.equal(ntField("task.id").value, "GROW-6687-email-validation");
  assert.equal(draft().doc.task.id, "GROW-6687-email-validation");
  // A form loaded from a prompt is a form in progress too.
  await startFrom(ctx, undefined, null);
  assert.match(ntOps(), /replace it with/);
});

test("the pending question stands alone", async () => {
  const ctx = await bootPrompt('foo: 1\ntask:\n  id: "A-1"\n');
  await startFrom(ctx);
  assert.match(ntOps(), /with 1 issue: foo/);
  await startFrom(ctx, GOLDEN, null);
  assert.match(ntOps(), /replace it with/);
  assert.equal($$("#ntOps .nt-report").length, 1);
  await click($("#ntKeep"));
  assert.equal(ntField("task.id").value, "A-1");
});

test("a restored draft of a blank form takes a prompt at once", async () => {
  await boot();
  await click($("#newTaskBtn"));
  ntTimers();
  await ntSet("task.id", "x");
  await ntSet("task.id", "");
  await advance(400);
  const saved = localStorage.getItem("adp-mc-draft")!;
  reboot();
  const ctx = await bootPrompt(GOLDEN, {draft: saved});
  await startFrom(ctx, undefined, null);
  assert.ok(!/replace it with/.test(ntOps()));
  assert.equal(ntField("task.id").value, "GROW-6687-email-validation");
});

test("the yaml panel sits in the form column under the sticky card and scrolls into view on show", async () => {
  const scrolled = recordScrolls();
  await boot();
  await click($("#newTaskBtn"));
  await ntOp("ntyaml");
  assert.ok($("#ntYamlPre").closest(".nt-form"));
  assert.equal(scrolled.filter(e => e.id === "ntYaml").length, 1);
  await ntOp("ntyaml");
  assert.equal(document.getElementById("ntYamlPre"), null);
  await ntOp("ntyaml");
  assert.equal(scrolled.filter(e => e.id === "ntYaml").length, 2);
});

test("the output path prints once, in the export card, under its own heading", async () => {
  const ctx = await bootPrompt();
  await startFrom(ctx);
  const dir = $("#ntDir").textContent!;
  assert.match(dir, /prompt\.yaml$/);
  assert.equal($("#scrNew").textContent!.split(dir).length - 1, 1);
  assert.equal($("#scrNew").firstElementChild!.outerHTML, "<h2>new task</h2>");
  // The card and the document block cannot share a heading, or the unmet
  // list's output.format key reads as a line about the card.
  assert.equal(ntSide().firstElementChild!.outerHTML, "<h2>export</h2>");
  await ntSet("task.id", "AV-099");
  assert.match($("#ntDir").textContent!, /AV099/);
});

test("a deferral item that is not a mapping is dropped and named on import, and a draft holding one boots the form", async () => {
  const ctx = await bootPrompt(GOLDEN.replace("  defers:\n", "  defers:\n    -\n    - communication\n"));
  await startFrom(ctx);
  assert.match(ntOps(), /with 2 issues/);
  assert.match(ntOps(), /protocol\.defers\[0\] is not a map; skipped/);
  assert.match(ntOps(), /protocol\.defers\[1\] is not a map; skipped/);
  assert.equal(ntField("protocol.defers.0.phase").value, "communication");
  assert.equal(ntField("protocol.defers.2.phase"), undefined);
  assert.deepEqual(draft().doc.protocol.defers.map((d: {phase: string}) => d.phase), ["communication", "obligations"]);
  reboot();
  await boot({draft: JSON.stringify({doc: {task: {id: "D-1"},
    protocol: {apply: true, defers: [null, "communication", {phase: "analysis", reason: "r"}]}}})});
  await click($("#newTaskBtn"));
  assert.equal(ntField("task.id").value, "D-1");
  assert.equal(ntField("protocol.defers.0.phase").value, "analysis");
  assert.equal(ntField("protocol.defers.1.phase"), undefined);
});

test("a restored draft that differs from the blank only by its date takes a prompt at once", async () => {
  const ctx = await bootPrompt(GOLDEN, {draft: JSON.stringify({doc: {task: {date: "2020-01-01"}}})});
  await click($("#newTaskBtn"));
  // The restore re-dates a draft nobody typed into, so the field reads today.
  assert.equal(ntField("task.date").value, today());
  await startFrom(ctx, undefined, null);
  assert.ok(!/replace it with/.test(ntOps()));
  assert.equal(ntField("task.id").value, "GROW-6687-email-validation");
  reboot();
  // A field the reader typed beside the date still asks.
  const ctx2 = await bootPrompt(GOLDEN, {draft: JSON.stringify({doc: {task: {date: "2020-01-01", id: "MINE-1"}}})});
  await startFrom(ctx2, undefined, null);
  assert.match(ntOps(), /replace it with/);
});

test("an import drops every wrong-shaped key and list item, names each one, and the bytes carry no blank row for them", async () => {
  const text = GOLDEN
    .replace("  priorities:\n", "  priorities:\n    -\n")
    .replace("  references:\n", "  references:\n    - \"src/bare.ts\"\n    -\n")
    .replace("  links:\n    - \"https://example.atlassian.net/browse/GROW-6687\"\n", "  links: nope\n")
    .replace(/lessons_learned:\n(  .*\n)+/, "lessons_learned: \"s\"\n")
    .replace("requirements:\n", "requirements:\n  -\n")
    .replace('format: "patch"', "format: true")
    .replace('phase: "communication"', "phase: 5");
  const ctx = await bootPrompt(text);
  await startFrom(ctx);
  const ops = ntOps();
  assert.match(ops, /with 8 issues/);
  for (const line of ["role\\.priorities\\[0\\] is not a plain value; skipped", "context\\.references\\[0\\] is not a map; skipped",
    "context\\.references\\[1\\] is not a map; skipped", "context\\.links is not a list; skipped", "lessons_learned is not a list; skipped",
    "requirements\\[0\\] is not a map; skipped", 'output\\.format "true" is not a format; cleared', 'protocol\\.defers\\[0\\]\\.phase "5" is not a phase; cleared'])
    assert.match(ops, new RegExp(line));
  // The survivors sit at the head of each list, with no blank row before them.
  assert.equal(ntField("role.priorities.0").value, "Reject invalid input before it reaches the database");
  assert.equal(ntField("role.priorities.2"), undefined);
  assert.equal(ntField("context.references.0.path").value, "src/signup/handler.ts");
  assert.equal(ntField("context.references.1.path"), undefined);
  assert.equal(ntField("context.links.0"), undefined);
  assert.equal(ntField("lessons_learned.0.context"), undefined);
  assert.equal(ntField("requirements.0.id").value, "R1");
  assert.equal(ntField("requirements.1.id"), undefined);
  assert.equal(ntField("output.format").value, "");
  assert.equal(ntField("protocol.defers.0.phase").value, "");
  const y = await preview();
  assert.match(y, /  references:\n    - path: "src\/signup\/handler.ts"\n/);
  assert.ok(!/lessons_learned:/.test(y));
  assert.ok(!/links:/.test(y));
  assert.match(y, /requirements:\n  - id: "R1"\n/);
  assert.ok(!/format:/.test(y));
});

test("an artifact name no chip carries is named and dropped, and the export carries the ticked chips only", async () => {
  const ctx = await bootPrompt(GOLDEN.replace("    - decision_log\n", "    - decision_log\n    - 7\n    - not_an_artifact\n    - a: 1\n"));
  await startFrom(ctx);
  assert.match(ntOps(), /with 3 issues/);
  assert.match(ntOps(), /protocol\.artifacts\[3\] is not a plain value; skipped/);
  assert.match(ntOps(), /protocol\.artifacts "7" is not an artifact; cleared/);
  assert.match(ntOps(), /protocol\.artifacts "not_an_artifact" is not an artifact; cleared/);
  assert.deepEqual(ticked(), ["decision_log", "test_adversary"]);
  const y = await preview();
  assert.match(y, /  artifacts:\n    - decision_log\n    - test_adversary\n/);
  // The bytes read back as the chips the form ticks, with nothing stringified.
  const skipped: string[] = [];
  assert.deepEqual((PL.parseYAML(y, skipped) as {protocol: {artifacts: string[]}}).protocol.artifacts, ["decision_log", "test_adversary"]);
  assert.deepEqual(skipped, []);
});

test("a map where a field's value belongs is dropped and named, and its row keeps its place", async () => {
  const ctx = await bootPrompt(GOLDEN
    .replace('    - path: "src/signup/handler.ts"', "    - path:\n        deep: 1")
    .replace('  - id: "R1"', "  - id:\n      deep: 1"));
  await startFrom(ctx);
  assert.match(ntOps(), /with 2 issues/);
  assert.match(ntOps(), /context\.references\[0\]\.path is not a plain value; skipped/);
  assert.match(ntOps(), /requirements\[0\]\.id is not a plain value; skipped/);
  assert.equal(ntField("context.references.0.path").value, "");
  assert.equal(ntField("context.references.0.lines").value, "42-88");
  assert.equal(ntField("requirements.0.id").value, "");
  assert.equal(ntField("requirements.0.statement").value, "A malformed email returns 422 and is not persisted");
  assert.ok(ntChecks().includes("context.references[0].path"));
  assert.ok(ntChecks().includes("requirements[0].id"));
  const y = await preview();
  assert.ok(!/\[object Object\]/.test(y));
  assert.match(y, /    - path: ""\n      lines: "42-88"\n/);
});

test("a toggle value that is not true or false is named and read as the state the toggle shows", async () => {
  const ctx = await bootPrompt(GOLDEN.replace("  apply: true", '  apply: "yes"').replace("  flag_low_confidence: true", "  flag_low_confidence: 0"));
  await startFrom(ctx);
  assert.match(ntOps(), /with 2 issues/);
  assert.match(ntOps(), /protocol\.apply "yes" is not true or false; kept as true/);
  assert.match(ntOps(), /protocol\.flag_low_confidence "0" is not true or false; kept as true/);
  assert.deepEqual([ntSwitch("apply").checked, ntSwitch("flag_low_confidence").checked], [true, true]);
  const y = await preview();
  assert.match(y, /  apply: true\n/);
  assert.match(y, /  flag_low_confidence: true\n/);
  assert.ok(!ntChecks().includes("protocol.apply"));
});

test("the enum report numbers the row the form shows, not the row the prompt held", async () => {
  const ctx = await bootPrompt(GOLDEN.replace("  defers:\n", "  defers:\n    - later\n").replace('phase: "communication"', 'phase: "deploy"'));
  await startFrom(ctx);
  assert.match(ntOps(), /with 2 issues/);
  assert.match(ntOps(), /protocol\.defers\[0\] is not a map; skipped/);
  assert.match(ntOps(), /protocol\.defers\[0\]\.phase "deploy" is not a phase; cleared/);
  assert.ok(!/protocol\.defers\[1\]\.phase/.test(ntOps()));
  assert.equal(ntField("protocol.defers.0.phase").value, "");
  assert.equal(ntField("protocol.defers.1.phase").value, "obligations");
});

test("a multiline value in a single-line field is flattened, named, and the bytes read back", async () => {
  const ctx = await bootPrompt(GOLDEN.replace('  title: "Add server-side validation to the signup email field"', "  title: |\n    line one\n    line two"));
  await startFrom(ctx);
  assert.match(ntOps(), /with 1 issue: task\.title \(multiline value flattened to one line\)/);
  assert.equal(ntField("task.title").value, "line one line two");
  const y = await preview();
  assert.match(y, /  title: "line one line two"\n/);
  assert.match(ntSide().textContent!, /valid · schema 1\.0/);
  const skipped: string[] = [];
  assert.equal((PL.parseYAML(y, skipped) as {task: {title: string}}).task.title, "line one line two");
  assert.deepEqual(skipped, []);
});

test("a map or a list where a block's own field belongs is dropped and named", async () => {
  const ctx = await bootPrompt(GOLDEN
    .replace('  title: "Add server-side validation to the signup email field"', "  title:\n    deep: 1")
    .replace('  lens: "Staff engineer accountable for data integrity"', "  lens:\n    - a\n    - b")
    .replace('  destination: "Edit files in place"', "  destination:\n    x: 1")
    .replace('  format: "patch"', "  format:\n    x: 1")
    .replace("  apply: true", "  apply:\n    x: 1"));
  await startFrom(ctx);
  const ops = ntOps();
  assert.match(ops, /with 5 issues/);
  for (const line of ["task\\.title is not a plain value; skipped", "role\\.lens is not a plain value; skipped",
    "output\\.destination is not a plain value; skipped", "output\\.format is not a plain value; skipped",
    "protocol\\.apply is not true or false; kept as true"]) assert.match(ops, new RegExp(line));
  assert.ok(!/\[object Object\]/.test(ops));
  for (const nf of ["task.title", "role.lens", "output.destination", "output.format"]) assert.equal(ntField(nf).value, "", nf);
  const y = await preview();
  assert.ok(!/\[object Object\]/.test(y));
  assert.ok(!/lens|destination|format:/.test(y));
  assert.match(y, /  apply: true\n/);
  assert.match($("#ntDir").textContent!, /-<slug>\/prompt\.yaml$/);
});

test("the export image trims every value and drops a blank row from a list of plain values", async () => {
  const ctx = await bootPrompt();
  await startFrom(ctx);
  await ntAdd("context.links");
  await ntSet("task.title", "  padded title  ");
  await ntSet("task.author", "   ");
  // The form keeps what the reader typed, so a caret stays where it was.
  assert.equal(ntField("task.title").value, "  padded title  ");
  assert.equal(ntField("context.links.1").value, "");
  const y = await preview();
  assert.match(y, /  title: "padded title"\n/);
  assert.ok(!/author:/.test(y));
  assert.ok(!/- ""/.test(y));
  assert.ok(ntChecks().includes("task.author"));
  reboot();
  // A form holding only padding carries no export bytes, so a prompt lands
  // without a question.
  const ctx2 = await bootPrompt();
  await click($("#newTaskBtn"));
  await ntSet("task.id", "   ");
  await ntSet("task.date", ` ${today()} `);
  await startFrom(ctx2, undefined, null);
  assert.ok(!/replace it with/.test(ntOps()));
});

test("the same form contents export the same bytes on both builders", async () => {
  const ctx = await bootPrompt();
  await startFrom(ctx);
  await ntAdd("context.links");
  await ntSet("task.title", "  padded title  ");
  await ntSet("role.priorities.0", " padded priority ");
  assert.equal(await preview(), STANDALONE.form);
});

test("a draft nobody has typed into takes today's date, and one with content keeps its own", async () => {
  await boot({draft: JSON.stringify({doc: {task: {date: "2026-09-28"}}})});
  await click($("#newTaskBtn"));
  assert.equal(ntField("task.date").value, today());
  assert.match($("#ntDir").textContent!, new RegExp("^\\.adp/" + today().replace(/-/g, "") + "-"));
  reboot();
  await boot({draft: JSON.stringify({doc: {task: {id: "ZUP-1", date: "2026-09-28"}}})});
  await click($("#newTaskBtn"));
  assert.equal(ntField("task.date").value, "2026-09-28");
  reboot();
  // A typed slug is content too, even with every field blank.
  await boot({draft: JSON.stringify({doc: {task: {date: "2026-09-28"}}, slug: "mine", slugEdited: true})});
  await click($("#newTaskBtn"));
  assert.equal(ntField("task.date").value, "2026-09-28");
});

/* The prompts below carry a field shape the standalone builder read too,
   so each one checks the app's bytes against the standalone's. */
async function sameOnBoth(text: string){
  const want = STANDALONE.prompts.filter(p => p.input === text);
  assert.equal(want.length, 1, "standalone-exports.json holds this prompt once");
  assert.equal(await preview(), want[0].output);
}

test("an empty field in an imported row exports blank, and both builders write the same bytes", async () => {
  const text = GOLDEN.replace('    verify: "Integration test posts a bad address and asserts 422 plus no new row"', "    verify:");
  const ctx = await bootPrompt(text);
  await startFrom(ctx);
  assert.equal(ntField("requirements.0.verify").value, "");
  const y = await preview();
  assert.match(y, /    verify: ""\n/);
  assert.ok(!/"null"/.test(y));
  assert.ok(ntChecks().includes("requirements[0].verify"));
  await sameOnBoth(text);
});

test("a number or a boolean in a field reads as its text, and a block scalar takes one too", async () => {
  const text = GOLDEN
    .replace('  title: "Add server-side validation to the signup email field"', "  title: true")
    .replace("  background: |\n    Signup currently trusts the client to validate. Bad addresses reach the users table.", "  background: 5");
  const ctx = await bootPrompt(text);
  await startFrom(ctx);
  assert.match(ntOps(), /— all recognized fields/);
  assert.equal(ntField("task.title").value, "true");
  assert.equal(ntField("context.background").value, "5");
  assert.match(ntSide().textContent!, /valid · schema 1\.0/);
  const y = await preview();
  assert.match(y, /  title: "true"\n/);
  assert.match(y, /  background: \|\n    5\n/);
  await sameOnBoth(text);
});

test("imported artifacts take the chip row's order with each name once", async () => {
  const text = GOLDEN.replace("    - decision_log\n    - test_adversary", "    - test_adversary\n    - decision_log\n    - decision_log");
  const ctx = await bootPrompt(text);
  await startFrom(ctx);
  assert.deepEqual(ticked(), ["decision_log", "test_adversary"]);
  assert.match(await preview(), /  artifacts:\n    - decision_log\n    - test_adversary\n/);
  await sameOnBoth(text);
});

test("an imported deferral with no reason exports the blank, and both builders write the same bytes", async () => {
  const text = GOLDEN.replace('      reason: "Ships behind the existing signup flag, so no deploy note goes out"\n', "");
  const ctx = await bootPrompt(text);
  await startFrom(ctx);
  assert.equal(ntField("protocol.defers.0.reason").value, "");
  assert.equal(ntField("protocol.defers.0.phase").value, "communication");
  const y = await preview();
  assert.ok(!/undefined/.test(y));
  assert.match(y, /    - phase: "communication"\n      reason: ""\n/);
  assert.ok(ntChecks().includes("protocol.defers[0].reason"));
  await sameOnBoth(text);
});

test("the badge numbers a requirement row the way the form does", async () => {
  await boot();
  await click($("#newTaskBtn"));
  await ntAdd("requirements");
  await ntAdd("requirements");
  await ntSet("requirements.1.id", "R9");
  // The partial row sits second on the screen, so the panel names it second.
  assert.ok(ntChecks().includes("requirements[1].statement"));
  assert.ok(ntChecks().includes("requirements[1].verify"));
  assert.ok(!ntChecks().some(k => /^requirements\[0\]/.test(k)));
  assert.ok(!ntChecks().includes("requirements"));
  const y = await preview();
  assert.match(y, /requirements:\n  - id: "R9"\n/);
  assert.ok(!y.includes('id: "-"'));
  reboot();
  // A list with no real row asks for a requirement rather than reading the
  // placeholder as one.
  await boot();
  await click($("#newTaskBtn"));
  await ntAdd("requirements");
  assert.ok(ntChecks().includes("requirements"));
  assert.ok(!ntChecks().some(k => /^requirements\[/.test(k)));
});

// ---- New task: the standalone builder's page cases ----

// The checks a blank form fails, in the order the side card lists them.
const BLANK_KEYS = ["task.id", "task.title", "task.author", "prompt",
  "output.format", "output.destination", "requirements"];
const ntRows = (list: string) => $$(`#scrNew .nt-in[data-nf^="${list}."]`);

test("the blank form pins its exact issue keys, and one defers row adds its phase and reason", async () => {
  await boot();
  await click($("#newTaskBtn"));
  assert.deepEqual(ntChecks(), BLANK_KEYS);
  await ntAdd("protocol.defers");
  assert.deepEqual(ntChecks(), BLANK_KEYS.concat(["protocol.defers[0].phase", "protocol.defers[0].reason"]));
  // Each check row prints its key and the fixed word required.
  const rows = $$("#ntSide .nt-checks li").map(li => li.innerHTML);
  assert.equal(rows.length, 9);
  for (const row of rows) assert.match(row, /^<code>[^<]+<\/code> — required$/);
});

test("the phase select offers exactly the nine phases, and a phase with no reason adds one check", async () => {
  await boot();
  await click($("#newTaskBtn"));
  const before = ntChecks();
  await ntAdd("protocol.defers");
  const sel = ntField("protocol.defers.0.phase") as unknown as HTMLSelectElement;
  assert.deepEqual([...sel.options].map(o => o.value), [""].concat(PL.PHASES));
  await ntSet("protocol.defers.0.phase", "analysis");
  assert.deepEqual(ntChecks().filter(k => !before.includes(k)), ["protocol.defers[0].reason"]);
});

test("the defers controls carry accessible names and button semantics", async () => {
  await boot();
  await click($("#newTaskBtn"));
  const add = $$(".nt-add").find(b => b.getAttribute("data-nadd") === "protocol.defers")!;
  assert.equal(add.tagName, "BUTTON");
  assert.equal(add.textContent, "+ add deferral");
  await ntAdd("protocol.defers");
  assert.equal(ntField("protocol.defers.0.phase").getAttribute("aria-label"), "phase");
  assert.equal(ntField("protocol.defers.0.reason").getAttribute("aria-label"), "Why this phase does not run");
  const rm = $$(".nt-del").find(b => b.getAttribute("data-ndel") === "protocol.defers.0")!;
  assert.equal(rm.tagName, "BUTTON");
  assert.equal(rm.getAttribute("aria-label"), "remove row");
});

test("defers rows ride the draft across a reload, and a draft with no defers restores none", async () => {
  await boot();
  await click($("#newTaskBtn"));
  await ntAdd("protocol.defers");
  await ntSet("protocol.defers.0.phase", "analysis");
  await ntSet("protocol.defers.0.reason", "Manual test pass only this release");
  fireEvent(window, new Event("pagehide"));
  const saved = localStorage.getItem("adp-mc-draft")!;
  reboot();
  await boot({draft: saved});
  await click($("#newTaskBtn"));
  assert.equal(ntField("protocol.defers.0.phase").value, "analysis");
  assert.equal(ntField("protocol.defers.0.reason").value, "Manual test pass only this release");
  reboot();
  await boot({draft: JSON.stringify({doc: {task: {id: "legacy-draft"}}})});
  await click($("#newTaskBtn"));
  assert.equal(ntField("task.id").value, "legacy-draft");
  assert.deepEqual(ntRows("protocol.defers"), []);
});

test("a pristine form exports the lib's blank document, with no defers key, once its date is cleared", async () => {
  await boot();
  await click($("#newTaskBtn"));
  const y = await preview();
  assert.ok(!y.includes("defers"));
  assert.equal(y, PL.buildYaml(PL.normalize({task: {date: today()}})));
  await ntSet("task.date", "");
  assert.equal(await preview(), PL.buildYaml(PL.blankDocument()));
});

test("a confirmed clear resets the phase selections with the rest of the form", async () => {
  await boot();
  await click($("#newTaskBtn"));
  await ntAdd("protocol.defers");
  await ntSet("protocol.defers.0.phase", "hypothesis");
  await ntSet("protocol.defers.0.reason", "r");
  await ntOp("ntclear");
  await ntOp("ntclear");
  assert.deepEqual(ntRows("protocol.defers"), []);
  assert.ok(!/defers/.test(await preview()));
});

test("an unknown protocol key lands in the import report, and the defers beside it still fill their rows", async () => {
  const ctx = await bootPrompt('protocol:\n  apply: true\n  wat: true\n  defers:\n    - phase: "analysis"\n      reason: "Manual pass"\n');
  await startFrom(ctx);
  assert.match(ntOps(), new RegExp(`imported ${PFILE} with 1 issue: protocol\\.wat`));
  assert.equal(ntField("protocol.defers.0.phase").value, "analysis");
  assert.equal(ntField("protocol.defers.0.reason").value, "Manual pass");
});

test("the golden prompt starts VALID with no checks", async () => {
  const ctx = await bootPrompt();
  await startFrom(ctx);
  assert.deepEqual(ntChecks(), []);
  assert.match(ntSide().textContent!, /valid · schema 1\.0/);
});

test("a priorities row without a lens adds exactly the role.lens check", async () => {
  await boot();
  await click($("#newTaskBtn"));
  await ntAdd("role.priorities");
  await ntSet("role.priorities.0", "ship it");
  assert.deepEqual(ntChecks(), ["task.id", "task.title", "task.author",
    "role.lens", "prompt", "output.format", "output.destination", "requirements"]);
});

test("an all-empty lessons row keeps a later flagged row on its own index", async () => {
  await boot();
  await click($("#newTaskBtn"));
  await ntAdd("lessons_learned");
  await ntAdd("lessons_learned");
  await ntSet("lessons_learned.1.context", "only context");
  assert.ok(ntChecks().includes("lessons_learned[1]"));
  assert.ok(!ntChecks().includes("lessons_learned[0]"));
});

test("an artifacts key with no value imports as the untouched chip row on both builders", async () => {
  const text = 'task:\n  id: "A-1"\nprotocol:\n  apply: true\n  artifacts:\n';
  const ctx = await bootPrompt(text);
  await startFrom(ctx);
  assert.match(ntOps(), /— all recognized fields/);
  assert.equal(ntField("task.id").value, "A-1");
  assert.deepEqual(ticked(), PL.DEFAULT_ARTIFACTS);
  await sameOnBoth(text);
});

test("a toggle written with no value keeps the blank document's state, as the standalone does", async () => {
  for (const line of ["  apply:", '  apply: ""']){
    const text = `task:\n  id: "A-1"\nprotocol:\n${line}\n`;
    const ctx = await bootPrompt(text);
    await startFrom(ctx);
    assert.match(ntOps(), /protocol\.apply[^\n]*is not true or false; kept as true/, line);
    assert.equal(ntSwitch("apply").checked, true, line);
    const y = await preview();
    assert.match(y, /  apply: true\n/, line);
    // A blank value must never read as the protocol turned off.
    assert.ok(!/apply: false/.test(y), line);
    await sameOnBoth(text);
    reboot();
  }
});

test("the slug input holds the slug a person typed, and the directory line holds the name the export lands under", async () => {
  await boot();
  await click($("#newTaskBtn"));
  await ntSet("task.title", "First title");
  await ntAdd("context.links");
  assert.equal(($("#ntSlug") as HTMLInputElement).value, "");
  assert.match($("#ntDir").textContent!, /-first-title\/prompt\.yaml$/);
  await ntSet("task.title", "Second title");
  assert.equal(($("#ntSlug") as HTMLInputElement).value, "");
  assert.match($("#ntDir").textContent!, /-second-title\/prompt\.yaml$/);
  // A typed slug owns the line, and clearing it hands the line back.
  await ntType($("#ntSlug"), "mine");
  assert.match($("#ntDir").textContent!, /-mine\/prompt\.yaml$/);
  await ntType($("#ntSlug"), "");
  assert.match($("#ntDir").textContent!, /-second-title\/prompt\.yaml$/);
});

test("a blur on a text field leaves the export card's buttons in the document", async () => {
  await boot();
  await click($("#newTaskBtn"));
  const title = ntField("task.title");
  await ntType(title, "Hello");
  const copy = op("data-op", "ntcopy");
  // A browser fires change when the field loses focus, on the mousedown of
  // the click on this button, so the button must survive it.
  fireEvent.blur(title);
  await settle(1);
  same(op("data-op", "ntcopy"), copy, "the copy button was rebuilt");
  assert.match(await preview(), /  title: "Hello"\n/);
});

test("a typed slug reaches the directory line in the convention's kebab case", async () => {
  await boot();
  await click($("#newTaskBtn"));
  await ntType($("#ntSlug"), "My Slug!");
  // The input keeps what the person typed, so the caret stays where it is.
  assert.equal(($("#ntSlug") as HTMLInputElement).value, "My Slug!");
  assert.match($("#ntDir").textContent!, /-my-slug\/prompt\.yaml$/);
  await ntSet("task.id", "AV-016");
  assert.equal(Bld.parseDirName($("#ntDir").textContent!.split("/")[1])!.slug, "my-slug");
});

test("a confirmed clear takes its disarm timer with it, and a re-armed clear holds its full window", async () => {
  await boot();
  await click($("#newTaskBtn"));
  ntTimers();
  await ntOp("ntclear");
  await ntOp("ntclear");
  await ntOp("ntclear");
  assert.match(ntOps(), /confirm clear/);
  // The pending timer is the new arm's own, so it holds the window the
  // button promises instead of the leftover from the arm before it.
  assert.equal(vi.getTimerCount(), 1);
  await advance(1200);
  assert.ok(!/confirm clear/.test(ntOps()));
});

test("a second copy inside the window takes the label timer with it", async () => {
  stubClipboard();
  await boot();
  await click($("#newTaskBtn"));
  ntTimers();
  const flush = () => act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); });
  fireEvent.click(op("data-op", "ntcopy"));
  await flush();
  await advance(600);
  fireEvent.click(op("data-op", "ntcopy"));
  await flush();
  // The first copy's timer would rest the label here.
  await advance(600);
  assert.equal(op("data-op", "ntcopy").textContent, "copied");
  await advance(600);
  assert.equal(op("data-op", "ntcopy").textContent, "⧉ copy yaml");
});

test("a confirmed clear takes a pending question with the form", async () => {
  const ctx = await bootPrompt();
  await click($("#newTaskBtn"));
  await ntSet("task.title", "typed");
  await startFrom(ctx, undefined, null);
  assert.match(ntOps(), /replace it with/);
  await ntOp("ntclear");
  await ntOp("ntclear");
  assert.equal(ntField("task.title").value, "");
  assert.ok(!/replace it with/.test(ntOps()));
  assert.ok(!ntOps().includes(PFILE));
});

// The verdict's spoken twin. The region speaks a change once the reader
// pauses, and a start from a ticket's prompt speaks the verdict it loads.
// A boot and a restored draft speak nothing.
test("the live region speaks the verdict after an edit or a start that flips it, and not before", async () => {
  const ctx = await bootPrompt();
  ntTimers();
  await click($("#newTaskBtn"));
  const live = () => $("#ntLive");
  assert.equal(live().getAttribute("aria-live"), "polite");
  await advance(1000);
  assert.equal(live().textContent, "");
  // A start on a blank form loads a valid prompt, and the region says so
  // once the pause ends.
  await startFrom(ctx);
  await advance(799);
  assert.equal(live().textContent, "");
  await advance(1);
  assert.equal(live().textContent, "Valid");
  await ntSet("task.id", "");
  await advance(799);
  assert.equal(live().textContent, "Valid");
  await advance(1);
  assert.equal(live().textContent, "1 protocol check unmet");
  // An edit that keeps the verdict says nothing new.
  await ntSet("task.title", "still valid otherwise");
  await advance(800);
  assert.equal(live().textContent, "1 protocol check unmet");
  // A start that replaces a form in progress speaks the verdict it loads too.
  await startFrom(ctx);
  await advance(800);
  assert.equal(live().textContent, "Valid");
});

// Each form section folds by its heading, and the fold survives a tab
// switch and leaves the section's values in place.
test("a form section collapses and reopens by its heading", async () => {
  const ctx = await bootPrompt();
  await startFrom(ctx);
  const head = (name: string) => $$(".nt-sechead").find(b => b.textContent === name)!;
  assert.deepEqual($$(".nt-sechead").map(b => b.textContent),
    ["task", "role", "context", "lessons learned", "requirements id + statement + how to verify", "output", "protocol"]);
  const role = head("role");
  assert.equal(role.getAttribute("aria-expanded"), "true");
  const body = document.getElementById(role.getAttribute("aria-controls")!)!;
  assert.equal(body.hidden, false);
  await click(role);
  assert.equal(role.getAttribute("aria-expanded"), "false");
  assert.equal(body.hidden, true);
  assert.equal(ntField("role.lens").value, "Staff engineer accountable for data integrity");
  await tabTo("watchboard");
  await click($("#newTaskBtn"));
  assert.equal(head("role").getAttribute("aria-expanded"), "false");
  await click(head("role"));
  assert.equal(document.getElementById(head("role").getAttribute("aria-controls")!)!.hidden, false);
  assert.match(await preview(), /lens: "Staff engineer accountable for data integrity"/);
});

// New task has no open, paste, or example control, and no drop hint. The
// one way in for a written prompt is the start action on a ticket.
test("new task offers no open, paste, or example control and no drop hint", async () => {
  await boot();
  await click($("#newTaskBtn"));
  for (const name of ["ntopen", "ntpaste", "ntexample"]) assert.equal($$('[data-op="' + name + '"]').length, 0, name);
  assert.equal(document.getElementById("ntPaste"), null);
  assert.equal(document.getElementById("ntImport"), null);
  assert.ok(!$("#scrNew").textContent!.includes("drag & drop"));
});

// A focus request and a yaml scroll each serve the click that made them. A
// later return to the screen mounts it again and must replay neither.
test("a return to New task replays neither the last row's focus nor the yaml scroll", async () => {
  const scrolled = recordScrolls();
  await boot();
  await click($("#newTaskBtn"));
  await ntAdd("requirements");
  same(document.activeElement, ntField("requirements.0.id"), "the new row did not take focus");
  ntField("task.title").focus();
  await ntOp("ntyaml");
  assert.equal(scrolled.length, 1);
  await tabTo("watchboard");
  await click($("#newTaskBtn"));
  assert.ok(document.activeElement !== ntField("requirements.0.id"), "the return replayed the row's focus");
  assert.equal(scrolled.length, 1, "the return replayed the yaml scroll");
  // The next request still acts once.
  await ntAdd("requirements");
  same(document.activeElement, ntField("requirements.1.id"), "a new request after the return did not take focus");
});

// ---- every screen ----

// Visits every screen the fixture corpus reaches: the boot, each view, the
// Packs drawer, each ticket's section and full log, the reviews of each
// ticket that has rounds, and New task. We call look() on each one, and
// return how many tickets offered reviews.
async function everyScreen(look: () => void){
  await baselineBoot();
  look();
  for (const v of S.VIEWS) { await tabTo(v.screen); look(); }
  await tabTo("resume pack");
  look();
  await click($('[aria-label="Close packs"]'));
  let reviewed = 0;
  for (const t of rentries()){
    await tabTo("inspector");
    // A rail pick keeps the view the last ticket used, so we choose the
    // section view ourselves.
    await click(entry(t));
    await click($('[data-view="section"]'));
    look();
    await click($('[data-view="full"]'));
    look();
    if ($('#phaseStrip [data-op="reviews"]')){ await tabTo("reviews"); look(); reviewed++; }
  }
  await click($("#newTaskBtn"));
  look();
  return reviewed;
}

/* R15. A drop handler cancels dragover and drop, because the browser's own
   default opens the dropped file in place of the page. An event bubbles up
   from its target, so we dispatch on every leaf element. Every element is a
   leaf or an ancestor of one, so a handler anywhere in the page sees one of
   our events, and a drop that stays uncancelled everywhere shows that no
   handler took it. */
test("no screen offers a file input, a paste field, or a drop target", async () => {
  let screens = 0;
  const reviewed = await everyScreen(() => {
    screens++;
    assert.equal($$('input[type="file"]').length, 0);
    assert.equal($$('[data-op="paste"], [data-op="openwatch"], [data-op="openyaml"], #pasteArea, #pasteDrawer, .shellmask').length, 0);
    const leaves = $$("body *").filter(el => el.childElementCount === 0);
    for (const type of ["dragover", "drop"])
      for (const target of leaves){
        const e = new Event(type, {bubbles: true, cancelable: true});
        target.dispatchEvent(e);
        if (e.defaultPrevented) assert.fail(`${type} on <${target.tagName.toLowerCase()} class="${target.className}"> was cancelled`);
      }
  });
  // The boot, each view, the drawer, two views of each ticket, each ticket's
  // reviews, and New task.
  const tickets = rentries().length;
  assert.ok(tickets > 1, "the fixture corpus holds more than one ticket");
  assert.equal(screens, 1 + S.VIEWS.length + 1 + 2 * tickets + reviewed + 1, "the walk reached every ticket");
});

// ---- the sheets own the app's classes ----

/* Everything the app paints outside a rendered document takes its classes
   from adp-bundle.css, or from adp-shell.css on a screen not yet moved onto
   the design system. Rendered documents sit in .md, where the theme's
   document styles apply. Two theme classes are deliberate: .md itself, and
   .sr-live, which hides New task's spoken verdict. Five classes carry no
   style at all, because the handlers and the tests select by them. The
   shell's grid sits in its own style attribute. */
const THEME_CLASSES = new Set(["md", "sr-live"]);
const HOOK_CLASSES = new Set(["shell", "sth", "wbrow", "wrow", "lgrow", "fsec", "fsum"]);
test("the app's screens use only adp-bundle.css and adp-shell.css classes outside rendered documents", async () => {
  const shell = new Set<string>();
  for (const sheet of ["adp-bundle.css", "adp-shell.css"]){
    const css = fs.readFileSync(path.join(import.meta.dirname, "..", sheet), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const seg of css.split(/\{[^{}]*\}/)) for (const m of seg.matchAll(/\.([A-Za-z_-][A-Za-z0-9_-]*)/g)) shell.add(m[1]);
  }
  const used = new Set<string>();
  const take = () => { for (const el of $$("[class]")) if (!el.parentElement?.closest(".md"))
    for (const c of el.getAttribute("class")!.split(/\s+/)) if (c) used.add(c); };
  await everyScreen(take);
  const orphans = [...used].filter(c => !shell.has(c) && !THEME_CLASSES.has(c) && !HOOK_CLASSES.has(c)).sort();
  assert.deepEqual(orphans, []);
  // A hook that gains a rule belongs in the sheet's set, not in this list.
  for (const c of HOOK_CLASSES) assert.ok(used.has(c) && !shell.has(c), c);
});
