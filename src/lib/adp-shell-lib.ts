/* adp-shell-lib.ts holds the mission-control logic that is not React: the
   screen names and the hash grammar, the theme choice, the corpus seam, the
   review round parsers, the pack fill, and New task's prompt checks. The app
   and the Node tests run the same code. Effects are injected, so loadCorpus
   takes a fetch function and a Node test passes a stub instead of faking a
   global. */
import * as B from "./adp-index-builder-lib.ts";
import * as P from "./adp-parser-lib.ts";
import * as D from "./adp-derive-lib.ts";
import * as PL from "./adp-prompt-lib.ts";
import type {IndexDocument, Ticket, PremortemRow} from "./adp-index-lib.ts";
import type {IndexFile, Advisory} from "./adp-index-builder-lib.ts";
import type {DueState, RibbonModel, SectionItems, WatchCounts, WatchboardRow,
  SettledWatch, LedgerRow} from "./adp-derive-lib.ts";
import type {DLConfKind, DLStatusKind} from "./adp-parser-lib.ts";
import type {PromptDocument, PromptProtocol, PromptReference, PromptLesson, PromptRequirement, PromptDefer,
  YamlMap} from "./adp-prompt-lib.ts";

type Screen = "inspector" | "reviews" | "watchboard" | "ledgers" | "calibration" | "resume pack" | "new task";
type HashSelection = {v: string | null; t: string | null; s: string | null; item: string | null};
type HashSelectionInput = Partial<HashSelection>;
type FetchResponse = {ok: boolean; status?: number; json(): Promise<unknown>; text(): Promise<string>};
type FetchFn = (url: string) => Promise<FetchResponse>;
type LoadCorpusOptions = {now?: Date};
type CorpusListing = {files?: string[]; root?: unknown};
type PacksListing = {packs?: string[]};
type FetchedText = {text: string; error?: never} | {error: string; text?: never};
type ReviewFile = {file: string} & FetchedText;
type Corpus = {
  index: IndexDocument;
  texts: Record<string, string>;
  files: IndexFile[];
  prompts: Record<string, FetchedText>;
  reviews: Record<string, ReviewFile[]>;
};
type RailEntry = {key: string; id: string; date: string | null; slug: string | null; ribbon: RibbonModel; closable: boolean};
type RailModelGroup = [name: string, list: RailEntry[]];
type ViewMode = "section" | "full";
type SortState = {k: string; d: number};
type CitationChip = {key: string; label: string; title: string};
type CoverageRow = {watch: string | null; settled: SettledWatch | null; statusKind: DLStatusKind};
type DecisionPanelRow = CoverageRow & {
  id: string; title: string; conf: string; confKind: DLConfKind; chips: CitationChip[]; hl: boolean; age: number | null;
};
type WatchPanelRow = {
  wid: string; what: string; dls: string[]; dueText: string | null; dueDated: boolean;
  state: DueState; stateLabel: string; chips: CitationChip[]; hl: boolean; left: number | null;
};
type PackBasisKind = "direct" | "inference" | "assertion" | "other" | "none";
type PackGapKind = "no signal" | "dangling pointer" | "UNOBSERVABLE";
type AdvisoryDetail = {finding: string; after?: string; offset?: number};
type PackWatchRow = {tid: string; wid: string; what: string; due: string | null; state: string};
type PackEntryRow = {tid: string; id: string; title: string; confidence: string};
type PackGapRow = PackEntryRow & {gap: PackGapKind};
type PackPremortemRow = {tid: string; mode: string; likelihood: string; implemented_at: string};
type Pack = {name: string; file: string; text: string};
type BlankRow = PromptReference | PromptLesson | PromptRequirement | PromptDefer | "";
type NtShape = "text" | "block" | "line" | "map" | "maps" | "plains";
type NtSwitchKey = keyof Pick<PromptProtocol, "apply" | "stake_single_recommendation" | "log_assumptions" | "flag_low_confidence">;
type Placed = {doc: Record<string, unknown>; issues: string[]};
type BuilderReport = {tone: "ok" | "warn"; text: string};
type ReviewRound = {file: string; k: number; date: string; text?: string; error?: string};
type ReviewGroup = {pr: string; label: string; rounds: ReviewRound[]};
type ReviewVerdictKey = "verdict" | "confidence" | "counts" | "opened" | "closed" | "carried";
type ReviewVerdictFields = Partial<Record<ReviewVerdictKey, string>>;
type ReviewHead = {fields: ReviewVerdictFields | null; missing: string[]};
type ReviewRef = {dir: string; file: string};
type ReviewLedgerRow = {id: string; date: string; outcome: string; note: string};
type ReviewClosure = ReviewLedgerRow & {file: string; k: number};
type ReviewLedger = Record<string, ReviewClosure>;

// IDX-004 wants a calendar-true YYYY-MM-DD. We compose it from local date
// parts, because a UTC composition would date a late-evening build tomorrow.
function localDate(now?: Date | null): string{
  const d = now || new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}

function footerText(index: IndexDocument | null): string{
  if (!index) return "no corpus · launch mission control with adp-launch.mts to build the index in-memory";
  return `schema ${index.schema} · ${index.tickets.length} tickets · read-only · rebuilt in-memory from the working tree`;
}

/* The top bar's three views and the screen each one opens. Reviews belong to
   a ticket, so the Tickets view stays current while a review round shows. */
const VIEWS: {screen: Screen; label: string}[] = [
  {screen: "inspector", label: "Tickets"}, {screen: "watchboard", label: "Watches"}, {screen: "ledgers", label: "Ledger"}];
function viewOf(s: Screen): Screen | null{
  return s === "reviews" ? "inspector" : VIEWS.some(v => v.screen === s) ? s : null;
}

/* Every view token a link has ever carried still lands somewhere. Calibration
   now heads the Ledger, and a resume pack opens as the Packs drawer over
   Tickets. Anything else opens Tickets. */
function screenFromHash(v: string | null): {screen: Screen; packs: boolean}{
  if (v === "calibration") return {screen: "ledgers", packs: false};
  if (v === "resume pack") return {screen: "inspector", packs: true};
  const known: Screen[] = ["inspector", "reviews", "watchboard", "ledgers", "new task"];
  return {screen: known.includes(v as Screen) ? v as Screen : "inspector", packs: false};
}

// An index can build from a listing whose root never named the project, so
// the name falls back to a dash. With no index yet, the bar shows no name.
function repoLabel(index: IndexDocument | null): string{
  return !index ? "" : index.project || "—";
}

// The repo leads the title, because several mission controls can run at once.
function pageTitle(index: IndexDocument | null): string{
  const repo = index ? index.project : null;
  return repo ? repo + " · ADP · Mission Control" : "ADP · Mission Control";
}

/* The theme choice is what the reader picked. System stores nothing, so the
   pre-paint script in app.html falls through to the system preference. */
type ThemeChoice = "system" | "dark" | "light";
function themeChoice(stored: string | null): ThemeChoice{
  return stored === "dark" || stored === "light" ? stored : "system";
}
function themeFor(choice: ThemeChoice, prefersLight: boolean): "dark" | "light"{
  return choice === "system" ? (prefersLight ? "light" : "dark") : choice;
}

// ---- the hash grammar ----

/* Deep links are #v=<screen>&t=<ticket>&s=<section key>&item=<DL/OT id>.
   The section token is the contract's section key, never a phase number — a
   phase number cannot reach most sections of a real log. The view token
   names a non-inspector screen, so a reload lands where the reader was; the
   inspector never writes one, which keeps every pre-v link and every
   inspector hash byte-identical. */
function hashRead(h: string | null | undefined): HashSelection{
  const out: HashSelection = {v: null, t: null, s: null, item: null};
  for (const kv of String(h || "").replace(/^#/, "").split("&")){
    const eq = kv.indexOf("=");
    if (eq < 1) continue;
    const k = kv.slice(0, eq), v = decodeURIComponent(kv.slice(eq + 1));
    if (k === "v" || k === "t" || k === "s" || k === "item") out[k] = v || null;
  }
  return out;
}
function hashWrite(sel: HashSelectionInput | null | undefined): string{
  if (!sel || (!sel.t && !sel.v)) return "";
  const p: string[] = [];
  if (sel.v) p.push("v=" + encodeURIComponent(sel.v));
  if (sel.t) p.push("t=" + encodeURIComponent(sel.t));
  if (sel.s) p.push("s=" + encodeURIComponent(sel.s));
  if (sel.item) p.push("item=" + encodeURIComponent(sel.item));
  return "#" + p.join("&");
}

// ---- the corpus seam ----

// The builder owns the rule for which paths carry text it reads. We ask it
// here, so the seam fetches exactly those files and the two never drift.
function logPaths(files: readonly string[] | null | undefined): string[]{
  return (files || []).filter(p => B.isLogPath(p));
}

// A ticket directory holds one prompt.yaml beside its audit log. A deeper
// prompt.yaml belongs to a reference folder, not to the ticket.
function promptPaths(files: readonly string[] | null | undefined): string[]{
  return (files || []).filter(p => {
    const path = String(p).replace(/^\.\//, "");
    const cut = path.indexOf("/");
    return cut > 0 && path.slice(cut + 1) === "prompt.yaml";
  });
}

// prreview names a round pr-review-PR<n>-<YYYYMMDD>-r<k>.md, or
// pr-review-local-… in branch mode, and writes it beside the audit log.
const REVIEW_NAME = /^pr-review-(PR(\d+)|local)-(\d{4})(\d{2})(\d{2})-r(\d+)\.md$/;
function reviewPaths(files: readonly string[] | null | undefined): string[]{
  return (files || []).filter(p => {
    const parts = String(p).replace(/^\.\//, "").split("/");
    return parts.length === 2 && parts[0] !== "" && REVIEW_NAME.test(parts[1]);
  });
}

// The server decodes percent escapes, so a raw path with a hash or a
// percent sign would come out as a different file. We encode each segment
// and keep the slashes as route separators.
function corpusUrl(p: string): string{
  return "corpus/" + String(p).split("/").map(encodeURIComponent).join("/");
}

/* The corpus seam. One probe of corpus.json decides the mode: a listing
   that parses starts the log fetches and the in-memory build, and anything
   else resolves to null, which the chrome renders as no-corpus. The load is
   all-or-null on purpose. A partial corpus would misreport a ticket whose
   log failed to fetch as prompt-only, and a wrong dashboard is worse than
   an absent one. The index is metadata-only, so the raw texts ride along
   keyed by ticket dir — the inspector renders section bodies from them
   without a second trip to the network. The (path, text) pairs the index
   was built from ride along too, because the advisory sweep takes the same
   shape, and a caller that rebuilt the list from the texts would hold a
   second copy of the corpus-file rule, able to drift from the one the
   index was built under. */
async function loadCorpus(fetchFn: FetchFn, opts?: LoadCorpusOptions | null): Promise<Corpus | null>{
  opts = opts || {};
  try{
    const probe = await fetchFn("corpus.json");
    // A missing corpus.json is the normal offline mode, so it stays quiet.
    if (!probe || !probe.ok) return null;
    const listing = await probe.json() as CorpusListing | null;
    if (!listing || !Array.isArray(listing.files)) throw new Error("corpus.json carries no files array");
    const logs = await Promise.all(logPaths(listing.files).map(async p => {
      const res = await fetchFn(corpusUrl(p));
      if (!res || !res.ok) throw new Error("unreadable corpus file: " + p);
      return {path: p, text: await res.text()};
    }));
    const byPath = new Map<string, IndexFile>(logs.map(f => [f.path, f]));
    const files: IndexFile[] = listing.files.map(p => byPath.get(p) || {path: p});
    const index = B.buildIndex(files, {
      project: typeof listing.root === "string" ? listing.root : null,
      generated: localDate(opts.now),
      source: "working-tree"
    });
    const texts: Record<string, string> = {};
    for (const f of logs) texts[f.path.replace(/^\.\//, "").split("/")[0]] = f.text;
    // A prompt is display data the index never reads, so each fetch fails
    // on its own. One bad prompt costs its ticket a notice, and the load
    // still resolves. We fill the map in listing order after every fetch
    // settles. The page compares whole corpora as JSON, so a map filled in
    // network order would read as a change on every poll tick.
    const fetchAlone = async (p: string): Promise<FetchedText> => {
      try{
        const res = await fetchFn(corpusUrl(p));
        return res && res.ok ? {text: await res.text()} : {error: "unreadable"};
      }catch(e){
        return {error: "unreadable"};
      }
    };
    const paths = promptPaths(listing.files);
    const got = await Promise.all(paths.map(fetchAlone));
    const prompts: Record<string, FetchedText> = {};
    paths.forEach((p, i) => { prompts[p.replace(/^\.\//, "").split("/")[0]] = got[i]; });
    // Review rounds are display data too, under the same rule. Promise.all
    // hands results back in listing order, and the server sorts the
    // listing, so the map reads the same on every tick.
    const rpaths = reviewPaths(listing.files);
    const rgot = await Promise.all(rpaths.map(fetchAlone));
    const reviews: Record<string, ReviewFile[]> = {};
    rpaths.forEach((p, i) => {
      const [dir, file] = p.replace(/^\.\//, "").split("/");
      (reviews[dir] = reviews[dir] || []).push(Object.assign({file}, rgot[i]));
    });
    return {index, texts, files, prompts, reviews};
  }catch(e){
    // The chrome renders every failure as no-corpus, so the console keeps
    // the one trace that says which file or shape broke the load.
    console.warn("corpus load failed:", e);
    return null;
  }
}

// ---- the rail ----

/* The prompt view gives each top-level key a card, shaped like a Decision
   Log card: a head with the key's title, then a grid of field rows. A
   top-level one-line value sits in the head itself. A list of flat
   records becomes a table, and any other list becomes a list. Every value
   is author text. A multi-line string is prose, so it goes through the
   markdown renderer the logs use. A one-line string is often a spec that
   quotes markdown, for example a verify step that names "[go](url)", so we
   show it escaped and exact. */
const LINK_ITEM = /^(https?|mailto):/i;
const keyLabel = (k: string) => k.replace(/_/g, " ");
const keyTitle = (k: string) => keyLabel(k).replace(/(^|\s)([a-z])/g, (m: string, s: string, c: string) => s + c.toUpperCase());
const isFlat = (x: unknown): x is YamlMap => isMap(x) && Object.keys(x).every(k => !isMap(x[k]) && !Array.isArray(x[k]));
const isLine = (x: unknown): boolean => !isMap(x) && !Array.isArray(x) && !(typeof x === "string" && x.includes("\n"));

/* A pack is plain text plus three constructs and nothing else. {{path}}
   inserts one value. {{#name}}…{{/name}} repeats its body per item of a
   list, with the item's keys laid over the context, or renders it once
   when name holds a present value. {{^name}}…{{/name}} renders its body
   only when the list is empty or the value is missing. The fill walks the
   template once, left to right. A section's body runs to the first closer
   that names it. An inserted value lands as a literal that is never read
   again, so a title that quotes a slot keeps its braces. A path that
   resolves to nothing renders empty, and any other brace text stays
   verbatim: the fill never invents a value and never interprets a
   construct it does not know. */
function packGet(ctx: unknown, path: string): unknown{
  return path.split(".").reduce((o: any, k: string) => o == null ? o : o[k], ctx);
}
function fillPack(tpl: string, ctx: Record<string, unknown>): string{
  tpl = String(tpl);
  const tag = /\{\{([#^])?([\w.]+)\}\}/g;
  let out = "", at = 0, m;
  while ((m = tag.exec(tpl))){
    const [whole, mark, p] = m;
    const v = packGet(ctx, p);
    out += tpl.slice(at, m.index);
    at = tag.lastIndex;
    if (!mark){ out += v == null ? "" : String(v); continue; }
    const closer = "{{/" + p + "}}";
    const end = tpl.indexOf(closer, at);
    // An opener with no closer is not a construct, so it stays as written.
    if (end < 0){ out += whole; continue; }
    const body = tpl.slice(at, end);
    const empty = Array.isArray(v) ? !v.length : !v;
    if (mark === "#" && Array.isArray(v))
      out += v.map(item => fillPack(body, Object.assign({}, ctx, item))).join("");
    else if (mark === "#" ? !empty : empty) out += fillPack(body, ctx);
    at = tag.lastIndex = end + closer.length;
  }
  return out + tpl.slice(at);
}

// The constructs a pack uses, each once, in first-use order. The screen
// lists them so an author can see what a pack reads.
function packSlots(tpl: string): string[]{
  return [...new Set(String(tpl).match(/\{\{[#^]?[\w.]+\}\}/g) || [])];
}

// The slots packContext fills from the selected ticket alone. A pack that
// reads none of them is corpus-wide and fills with no ticket selected.
const TICKET_SLOTS = /^\{\{[#^]?(ticket(\.[\w.]+)?|missing|open_decisions|watches)\}\}$/;
function packReadsTicket(tpl: string): boolean{
  return packSlots(tpl).some(s => TICKET_SLOTS.test(s));
}

/* The one context every pack fills from. Every classified value comes
   through the derive lib, so a pack can only say what the board and the
   ledger say: an entry is open by decisionKind, which prefers a recorded
   ruling to the card; a watch is live when no closure record ended it;
   the corpus-wide lists are the board's rows and the ledger's unwatched
   rank. Dates come from due and anchored alone. A watch with no date
   shows its UNANCHORED label and never its window prose, so a pack never
   reads a date out of a sentence. The ticket may be null, in which case
   every ticket slot renders empty. The advisories are the fourth input,
   not a derivation: the lint reads the corpus files, which the index does
   not carry, so a caller that has them passes them and a caller that does
   not gets the lists a clean sweep would give. */
// A confidence basis is classified by its leading phrase, because the
// field is one line that names its kind first and its evidence after a
// dash. A mixed basis ("DIRECT EVIDENCE for X; inference for Y") takes
// the kind it leads with. No basis at all is its own kind, since the
// field postdates many entries on record.
function packBasisKind(basis: string | null | undefined): PackBasisKind{
  const s = String(basis || "").trim().toUpperCase();
  if (!s) return "none";
  if (s.startsWith("DIRECT EVIDENCE")) return "direct";
  if (s.startsWith("INFERENCE")) return "inference";
  if (s.startsWith("DEVELOPER ASSERTION")) return "assertion";
  return "other";
}

/* An instrumentation gap is an open entry whose card names no observable:
   no Monitoring signal field at all, or one that declares no observable
   exists. The index carries the field as one verbatim line, so the kind is
   read off the line's leading token and nothing else, and a signal that
   names an observable is not a gap however it is worded.

   A card may also point at a Pre-Mortem row instead of stating a signal of
   its own. SKILL.md's Phase 5 template fixes that third form, and the row
   it names owns the signal, so the pointer resolves against the ticket's
   own Pre-Mortem rows before the kind is read. The pointer quotes the
   failure mode verbatim, and a mode that quotes something carries its
   escapes into the card, so the match takes the whole span between the
   first quote and the last and undoes the escape. A pointer naming no row
   of the ticket is a kind of its own: the entry's one signal of record
   addresses nothing, which no reader can check. The row's own cell is read
   with no rows to follow, so a chain of pointers ends at the first hop
   instead of looping. A row whose signal cell is the dash reads as no
   signal, exactly as a card's dash does, because the pointer makes that
   cell the entry's one signal of record. */
function packGapKind(signal: string | null | undefined, rows: readonly PremortemRow[] | null | undefined): PackGapKind | null{
  const s = String(signal || "").trim();
  /* A field holding only a dash is the record's own no-value marker, which
     the templates write wherever a cell has nothing in it, so it reads the
     same as an absent field. SKILL.md fixes three signal forms and the dash
     is none of them. Em, en, and plain hyphen all count, because a reader
     takes any of them for the same marker. */
  if (!s || /^[—–-]+$/.test(s)) return "no signal";
  if (/^→\s*Pre-Mortem\b/i.test(s)){
    const at = s.indexOf('"'), end = s.lastIndexOf('"');
    const mode = end > at ? s.slice(at + 1, end).replace(/\\"/g, '"').trim() : "";
    const row = mode ? (rows || []).find(r => r.mode === mode) : null;
    return row ? packGapKind(row.signal, null) : "dangling pointer";
  }
  return /^UNOBSERVABLE\b/i.test(s) ? "UNOBSERVABLE" : null;
}

function packContext(index: IndexDocument, t: Ticket | null, today: string, advisories?: readonly Advisory[] | null){
  const word = (c: string) => P.dlChipSplit(c).word;
  const watchRow = (w: WatchboardRow): PackWatchRow => ({tid: w.tid, wid: w.wid, what: w.what,
    due: w.anchored ? w.due : "", state: w.label});
  // A lint finding names a directory, and every other row names a ticket
  // the way the ledger does, so the directory is read back through the
  // index. A finding under a directory the index does not hold keeps the
  // directory as its name rather than losing it.
  const tokenOf = D.ticketTokens(index.tickets);
  const tidOf = (dir: string) => {
    const own = index.tickets.find(x => x.dir === dir);
    return own ? tokenOf(own) : dir;
  };
  const wb = D.watchboardRows(index.tickets, today);
  const board = wb.rows;
  const live = board.filter(w => w.state !== "closed");
  const ledger = D.ledgerRows(index.tickets, today).decisions;
  const open = ledger.filter(r => r.kind === "open");
  const entryRow = (r: LedgerRow): PackEntryRow => ({tid: r.tid, id: r.id, title: r.title, confidence: word(r.confidence)});
  // Oldest first, so the entries with the most drift lead; an undated
  // card has no age and sits last, named as undated rather than as zero.
  const byAge = open.slice().sort((a, b) =>
    (b.age == null ? -1 : b.age) - (a.age == null ? -1 : a.age));
  /* A ledger row carries neither the confidence basis nor the monitoring
     signal, so the entry's own ticket is read back: the card for the two
     fields these lists classify, and the ticket's Pre-Mortem rows for a
     pointer-form signal to resolve against. One lookup per open entry
     returns both, because both come from the same ticket. */
  const ownerOf = (r: LedgerRow) => {
    const own = index.tickets.find(x => x.dir === r.dir) || null;
    return {ticket: own, card: (own && own.decisions.find(d => d.id === r.id)) || null};
  };
  const basis: Record<string, PackEntryRow[]> = {};
  for (const k of ["direct", "inference", "assertion", "other", "none"]) basis[k] = [];
  const gaps: PackGapRow[] = [];
  for (const r of open){
    const owner = ownerOf(r);
    const card = owner.card;
    basis[packBasisKind(card && card.basis)].push(entryRow(r));
    const gap = packGapKind(card && card.signal, owner.ticket && owner.ticket.premortem);
    if (gap) gaps.push(Object.assign(entryRow(r), {gap: gap}));
  }
  const counts: Record<string, number> = {};
  for (const k in basis) counts[k] = basis[k].length;
  /* Advisories sort by kind in the order the contract documents them, then
     by ticket and id, so the same corpus always lists them the same way and
     the kinds read in the order a person learns them. A kind the list does
     not know sorts ahead of all of them rather than silently last. The
     detail is whatever its kind adds, rendered as one ready phrase: a pack
     formats nothing. */
  const kinds = B.ADVISORY_KINDS;
  const detailOf = (f: AdvisoryDetail) => f.after ? "after " + f.after
    : f.offset === undefined ? "" : "byte " + f.offset;
  const found = (advisories || []).slice().sort((a, b) =>
    kinds.indexOf(a.finding) - kinds.indexOf(b.finding)
    || (a.dir < b.dir ? -1 : a.dir > b.dir ? 1 : 0)
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const advisoryCounts: Record<string, number> = {};
  // A pack slot addresses word characters alone, so a count key writes the
  // kind's hyphen as an underscore. The kind itself stays verbatim on the
  // row, and a pack labels its own count line.
  for (const k of kinds) advisoryCounts[k.replace(/-/g, "_")] = 0;
  // A finding whose kind the list does not know counts in the total alone,
  // so the buckets never grow a key no pack can address.
  for (const f of found){
    const k = String(f.finding).replace(/-/g, "_");
    if (k in advisoryCounts) advisoryCounts[k]++;
  }
  advisoryCounts.total = found.length;
  /* Every Pre-Mortem row the corpus carries, ticket by ticket in index
     order and document order within a ticket, split into three lists by
     what its anchor cell says. A PENDING row is promised work, a dashed
     row is an argument nobody has revisited, and an anchored row is a
     claim a person can settle by opening the file the anchor names. All
     three age, so all three reach a pack, which prints the anchor as
     written and checks nothing: no page can read the repository. A row
     whose cell is empty reaches none of the lists, because an unfilled
     cell is neither a marker nor an anchor. */
  const premortem: PackPremortemRow[] = [];
  for (const x of index.tickets)
    for (const r of (x.premortem || []))
      premortem.push({tid: tokenOf(x), mode: r.mode, likelihood: r.likelihood,
        implemented_at: r.implemented_at});
  const isPending = (r: PackPremortemRow) => /^PENDING\b/i.test(r.implemented_at);
  const isRebuttal = (r: PackPremortemRow) => r.implemented_at === "—";
  return {
    index: {generated: index.generated, project: index.project},
    ticket: t ? {id: t.id, dir: t.dir, slug: t.slug, date: t.date, title: t.title,
      state: t.state, state_source: t.state_source, pr: t.pr, merged: t.merged,
      phase: t.phase} : null,
    ticket_count: index.tickets.length,
    missing: t ? (t.missing.join(", ") || "none") : "",
    open_decisions: t ? t.decisions.filter(d => D.decisionKind(d) === "open").map(d => {
      const cover = D.coveringWatch(t, d.id);
      return {id: d.id, title: d.title, confidence: word(d.confidence),
        created: d.created || "", watch: cover ? cover.wid : "no watch"};
    }) : [],
    watches: t ? t.watches.filter(w => !w.closed).map(w => ({
      wid: w.wid, what: w.what, dl: (w.dl || []).join(", "),
      due: w.anchored ? w.due : "", state: D.dueLabel(w, today)})) : [],
    overdue: board.filter(w => w.state === "overdue").map(watchRow),
    soon: board.filter(w => w.state === "soon").map(watchRow),
    unanchored: board.filter(w => w.state === "unanchored").map(watchRow),
    unwatched: ledger.filter(r => r.rank === 0).map(entryRow),
    // The board's whole live set in its order, its dated members alone as
    // a calendar, and the state counts the board's chips carry.
    live_watches: live.map(watchRow),
    calendar: live.filter(w => w.anchored).map(watchRow),
    watch_counts: Object.assign({live: live.length}, wb.counts),
    open_by_age: byAge.map(r => Object.assign(entryRow(r), {
      age: r.age == null ? "undated" : r.age + "d",
      watch: r.watch || "no watch"})),
    in_review: index.tickets.filter(x => x.state === "in-review").map(x => ({
      id: tokenOf(x), dir: x.dir, pr: x.pr,
      open_count: x.decisions.filter(d => D.decisionKind(d) === "open").length,
      live_count: x.watches.filter(w => !w.closed).length})),
    basis_direct: basis.direct, basis_inference: basis.inference,
    basis_assertion: basis.assertion, basis_other: basis.other, basis_none: basis.none,
    basis_counts: counts,
    advisories: found.map(f => ({kind: f.finding, tid: tidOf(f.dir), id: f.id,
      detail: detailOf(f)})),
    advisory_counts: advisoryCounts,
    instrumentation_gaps: gaps,
    gap_counts: {missing: gaps.filter(g => g.gap === "no signal").length,
      unobservable: gaps.filter(g => g.gap === "UNOBSERVABLE").length,
      dangling: gaps.filter(g => g.gap === "dangling pointer").length,
      total: gaps.length, open: open.length},
    pending_mitigations: premortem.filter(isPending),
    rebuttals: premortem.filter(isRebuttal),
    // An anchored row is one whose cell is neither marker and not empty,
    // so the cell is the anchor its author wrote. A pack prints it as
    // written, because no page can open the file it names.
    anchored_mitigations: premortem.filter(r =>
      r.implemented_at && !isPending(r) && !isRebuttal(r))
  };
}

/* The packs seam, in the corpus seam's shape: one probe of packs.json,
   then every listed file, all-or-null. A pack the server lists but cannot
   serve would leave a button that fills nothing, so the whole load fails
   instead. The listing's order is the screen's order. A probe that never
   answers is quiet: a dead server is the corpus seam's trace to make, and
   a server without the packs routes answers not-ok, so both read as the
   no-packs mode. Only a listing the server did answer can fail loudly. */
async function loadPacks(fetchFn: FetchFn): Promise<Pack[] | null>{
  let probe: FetchResponse | null = null;
  try{ probe = await fetchFn("packs.json"); }catch(e){}
  if (!probe || !probe.ok) return null;
  try{
    const listing = await probe.json() as PacksListing | null;
    if (!listing || !Array.isArray(listing.packs)) throw new Error("packs.json carries no packs array");
    return await Promise.all(listing.packs.map(async file => {
      const res = await fetchFn("packs/" + encodeURIComponent(file));
      if (!res || !res.ok) throw new Error("unreadable pack: " + file);
      return {name: String(file).replace(/\.pack\.md$/, ""), file: "packs/" + file, text: await res.text()};
    }));
  }catch(e){
    console.warn("packs load failed:", e);
    return null;
  }
}

function slugOf(title: string | null | undefined): string{
  return String(title || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// The umbrella's directory convention: the id's leading letters-digits
// pair loses its dash, so the index builder's parseDirName reads the name
// as date, id, and slug on the first two dashes. A word tail on the id,
// as in GROW-6687-email-validation, heads the slug. A blank part shows
// its placeholder, so the line stays readable on an empty form.
function promptDir(doc: PromptDocument, slug: string): string{
  const date = String(doc.task.date || "").replace(/-/g, "") || "<yyyymmdd>";
  const id = String(doc.task.id || "").replace(/^([A-Za-z]+)-(\d+)/, "$1$2") || "<TASKID>";
  return `.adp/${date}-${id}-${slug || "<slug>"}/prompt.yaml`;
}

// One blank row per list, in the lib's item shape.
function blankRow(list: string): BlankRow{
  switch (list){
    case "context.references": return {path: "", lines: "", note: ""};
    case "lessons_learned": return {context: "", takeaway: ""};
    case "requirements": return {id: "", statement: "", verify: ""};
    case "protocol.defers": return {phase: "", reason: ""};
    default: return "";
  }
}

const NT_KEYS: Record<string, string[]> = {
  "": ["schema_version", "task", "preamble", "role", "prompt", "constraints", "context", "lessons_learned", "output", "requirements", "protocol"],
  task: ["id", "title", "author", "date"],
  role: ["lens", "priorities"],
  constraints: ["out_of_scope", "must_not"],
  context: ["background", "references", "links"],
  output: ["format", "destination", "structure"],
  protocol: ["apply", "stake_single_recommendation", "log_assumptions", "flag_low_confidence", "artifacts", "defers"]
};
// The keys an import cannot place, named the way the standalone's report
// names them: a top-level stranger bare, a nested one under its block.
function unknownKeys(obj: Record<string, unknown>): string[]{
  const out: string[] = [];
  for (const blk of Object.keys(NT_KEYS)){
    const o = blk ? obj[blk] : obj;
    if (!o || typeof o !== "object" || Array.isArray(o)) continue;
    Object.keys(o).forEach(k => { if (!NT_KEYS[blk].includes(k)) out.push(blk ? blk + "." + k : k); });
  }
  return out;
}

const isMap = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const isPlain = (x: unknown): x is string | number | boolean => typeof x === "string" || typeof x === "number" || typeof x === "boolean";
/* The shape each placed key takes. A text key and a block key are both
   textareas and keep their newlines, and the difference is what the
   standalone accepts: text only for the two that carry a whole prompt, any
   plain value for the other two. A line key is one input, so it holds a
   plain value on one line. The rest are a map, a list of maps, or a list of
   plain values, whose items are lines themselves. A block precedes its
   keys, so its copy exists before a key under it is dropped. */
const NT_SHAPES: [string, NtShape][] = [
  ["preamble", "text"], ["prompt", "text"],
  ["task", "map"], ["role", "map"], ["constraints", "map"], ["context", "map"], ["output", "map"], ["protocol", "map"],
  ["task.id", "line"], ["task.title", "line"], ["task.author", "line"], ["task.date", "line"],
  ["role.lens", "line"], ["role.priorities", "plains"],
  ["constraints.out_of_scope", "plains"], ["constraints.must_not", "plains"],
  ["context.background", "block"], ["context.references", "maps"], ["context.links", "plains"],
  ["lessons_learned", "maps"], ["requirements", "maps"],
  ["output.format", "line"], ["output.destination", "line"], ["output.structure", "block"],
  ["protocol.artifacts", "plains"], ["protocol.defers", "maps"]
];
const SHAPE_OK: Record<NtShape, (x: unknown) => boolean> = {text: x => typeof x === "string", block: isPlain, line: isPlain, map: isMap, maps: isMap, plains: isPlain};
const SHAPE_NAME: Record<NtShape, string> = {text: "text", block: "a plain value", line: "a plain value", map: "a map", maps: "a map", plains: "a plain value"};
/* A value an input holds is text on one line, so a number or a boolean
   reads as the input would show it and the newlines of a block scalar
   collapse to spaces. This is the standalone's setLine rule. A field that
   keeps its type would leave the badge asking for a field the export
   fills, and a newline would break the line the export writes. */
function placeLine(at: string, v: unknown, issues: string[]): string{
  const s = String(v);
  if (s.indexOf("\n") < 0) return s;
  issues.push(`${at} (multiline value flattened to one line)`);
  return s.replace(/\n+/g, " ");
}
/* A field inside a list item holds a plain value, because one input holds
   it and the export quotes it. A map or a list under a field reaches the
   input as [object Object] and the bytes carry the same text, so the field
   is dropped and named. A stranger key on the row rides along unnamed,
   because the export drops it and neither builder names it. The item is
   copied before the drop, the way a block is. An empty field parses as
   null, and the blank the input shows takes its place, because the export
   writes every field of a row it keeps. */
function placeableRow(at: string, item: Record<string, unknown>, issues: string[]): Record<string, unknown>{
  const row = Object.assign({}, item);
  Object.keys(row).forEach(k => {
    if (row[k] == null){ row[k] = ""; return; }
    if (isPlain(row[k])){ row[k] = placeLine(`${at}.${k}`, row[k], issues); return; }
    issues.push(`${at}.${k} is not a plain value; skipped`);
    delete row[k];
  });
  return row;
}
/* The document with every key and list item the form has no place for
   dropped, and a line naming each drop in the standalone's wording. An
   absent or null key is nothing to place and nothing to drop. The page
   adopts the returned copy, so the form and the bytes agree on what an
   import kept; the input is left as it was. */
function placeable(obj: unknown): Placed{
  const issues: string[] = [];
  const doc: Record<string, unknown> = isMap(obj) ? Object.assign({}, obj) : {};
  for (const [path, shape] of NT_SHAPES){
    const [blk, key] = path.includes(".") ? path.split(".") : ["", path];
    const o = blk ? doc[blk] : doc;
    if (!isMap(o) || o[key] == null) continue;
    const v = o[key];
    if (shape === "maps" || shape === "plains"){
      if (!Array.isArray(v)){ issues.push(`${path} is not a list; skipped`); delete o[key]; continue; }
      const kept: (Record<string, unknown> | string)[] = [];
      v.forEach((x, i) => {
        if (!SHAPE_OK[shape](x)){ issues.push(`${path}[${i}] is not ${SHAPE_NAME[shape]}; skipped`); return; }
        kept.push(shape === "maps" ? placeableRow(`${path}[${i}]`, x, issues) : placeLine(`${path}[${i}]`, x, issues));
      });
      o[key] = kept;
    } else if (!SHAPE_OK[shape](v)){
      issues.push(`${path} is not ${SHAPE_NAME[shape]}; skipped`);
      delete o[key];
    } else if (shape === "map"){
      doc[key] = Object.assign({}, v);
    } else if (shape === "line"){
      o[key] = placeLine(path, v, issues);
    } else if (shape === "block"){
      o[key] = String(v);
    }
  }
  return {doc, issues};
}

// The four protocol switches, each with the label its toggle prints. The
// page reads the keys to coerce an imported value to the toggle's state.
const NT_SWITCHES: [NtSwitchKey, string][] = [["apply", "apply protocol"], ["stake_single_recommendation", "stake recommendation"],
  ["log_assumptions", "log assumptions"], ["flag_low_confidence", "flag low confidence"]];
/* Every drop placeable() makes, then a value no control on the form can
   show: the format select, a phase select, an artifact chip, or one of the
   four protocol toggles. The type does not matter, and a YAML true is one
   such value. The lines read the walk's copy, so a row number names the row
   the form shows and a dropped item is named once. The page clears the
   value on adoption, or reads it as the toggle's own state, so the bytes
   and the form agree. An empty value is the blank select and clears
   nothing. An absent toggle is left to the badge, which asks for it. */
function unknownValues(obj: unknown): string[]{
  const {doc, issues} = placeable(obj);
  const fmt = isMap(doc.output) ? doc.output.format : null;
  if (fmt != null && fmt !== "" && !PL.FORMATS.includes(fmt as string))
    issues.push(`output.format "${String(fmt)}" is not a format; cleared`);
  const proto: Record<string, unknown> = isMap(doc.protocol) ? doc.protocol : {};
  const artifacts: string[] = Array.isArray(proto.artifacts) ? proto.artifacts : [];
  artifacts.forEach(a => {
    if (!PL.ARTIFACTS.includes(a)) issues.push(`protocol.artifacts "${String(a)}" is not an artifact; cleared`);
  });
  const blankSwitches = PL.blankDocument().protocol;
  NT_SWITCHES.forEach(([k]) => {
    const v = proto[k];
    if (!(k in proto) || typeof v === "boolean") return;
    // A map or a list has no reading worth printing, so only a plain value
    // is quoted back. The page leaves the blank document's own state on the
    // toggle, which is the state an untouched checkbox holds.
    const named = isPlain(v) ? `protocol.${k} "${String(v)}"` : `protocol.${k}`;
    issues.push(`${named} is not true or false; kept as ${blankSwitches[k]}`);
  });
  const defers: Record<string, string>[] = Array.isArray(proto.defers) ? proto.defers : [];
  defers.forEach((d, i) => {
    if (d.phase != null && d.phase !== "" && !PL.PHASES.includes(d.phase))
      issues.push(`protocol.defers[${i}].phase "${String(d.phase)}" is not a phase; cleared`);
  });
  return issues;
}

/* A ticket's rounds, grouped by PR. prreview numbers k across the whole
   ticket directory, so a PR's first round here can carry a k above 1. We
   sort by the number, because a string sort puts r10 before r2. The groups
   follow the first round each one holds. */
function reviewRounds(list: readonly ReviewFile[] | null | undefined): ReviewGroup[]{
  const groups: ReviewGroup[] = [];
  for (const f of list || []){
    const m = REVIEW_NAME.exec(f.file);
    if (!m) continue;
    let g = groups.find(x => x.pr === m[1]);
    if (!g){ g = {pr: m[1], label: m[2] ? "PR #" + m[2] : "local", rounds: []}; groups.push(g); }
    g.rounds.push({file: f.file, k: Number(m[6]), date: `${m[3]}-${m[4]}-${m[5]}`,
      text: f.text, error: f.error});
  }
  for (const g of groups) g.rounds.sort((a, b) => a.k - b.k);
  return groups.sort((a, b) => a.rounds[0].k - b.rounds[0].k);
}

const VERDICT_FIELDS: [ReviewVerdictKey, string][] = [["verdict", "Verdict"], ["confidence", "Confidence"], ["counts", "Counts"],
  ["opened", "Opened"], ["closed", "Closed"], ["carried", "Carried open"]];
// The head reads the Review Verdict fields by their labels. A round still
// being written has no verdict yet, so a gap is a notice and never an error.
function reviewHead(text: string | null | undefined): ReviewHead{
  const sec = P.parseSections(String(text || "")).secs.find(s => s.title.trim() === "Review Verdict");
  if (!sec) return {fields: null, missing: VERDICT_FIELDS.map(f => f[1])};
  const got: Record<string, string> = {};
  for (const f of P.parseDLFields(sec.body)) if (f.label && !(f.label in got)) got[f.label] = f.value;
  const out: {fields: ReviewVerdictFields; missing: string[]} = {fields: {}, missing: []};
  for (const [k, label] of VERDICT_FIELDS){
    if (got[label]) out.fields[k] = got[label];
    else out.missing.push(label);
  }
  return out;
}

/* The Inspected table names earlier rounds as bare file names or as
   .adp/<dir>/<file> paths. A bare name lives in the same ticket. A path can
   point into another ticket, which is how a PR that moved between tasks
   keeps its trail. */
function priorReviews(text: string | null | undefined, dir: string): ReviewRef[]{
  const row = String(text || "").split("\n").find(l => /^\|\s*Prior review files\s*\|/.test(l));
  if (!row) return [];
  const out: ReviewRef[] = [];
  for (const tok of (row.split("|")[2] || "").split(/[,\s`]+/)){
    const parts = tok.replace(/^\.\//, "").replace(/^\.adp\//, "").split("/").filter(Boolean);
    const file = parts.pop();
    if (!file || parts.length > 1 || !REVIEW_NAME.test(file)) continue;
    out.push({dir: parts[0] || dir, file});
  }
  return out;
}

// A pointer section names its round in a Review file field. We read the
// field and not the heading, so an older section with no file gets no link.
function reviewFileRef(body: string | null | undefined): ReviewRef | null{
  const m = String(body || "").match(/^\s*[-*+]?\s*\*\*Review file:\*\*\s*`?([^`\s]+)`?/m);
  if (!m) return null;
  const parts = m[1].replace(/^\.\//, "").replace(/^\.adp\//, "").split("/");
  return parts.length === 2 && REVIEW_NAME.test(parts[1]) ? {dir: parts[0], file: parts[1]} : null;
}

/* A round cites decisions and watches by the same id tokens a log section
   does, so we scan it with the index builder's own harvest. Only ids the
   ticket defines count, which drops a token that names another ticket's
   entry or a placeholder. */
function reviewItems(t: Ticket, text: string | null | undefined): SectionItems{
  const toks = B.harvestTokens(B.withoutFences(String(text || "")), false);
  return {decisions: t.decisions.filter(d => toks.includes(d.id)),
    watches: t.watches.filter(w => toks.includes(w.wid))};
}

/* prreview never edits a finding card after its round. A later round closes
   the finding with a ledger line under Prior Findings instead, so the card's
   own Status stays OPEN forever. We read the closures of a whole PR group,
   in round order, so a card can show where its finding ended up. */
const REVIEW_LEDGER = /^\s*[-*+]\s+\*\*(PR-[A-Z]+-\d+)\s+CLOSED\s+(\d{4}-\d{2}-\d{2})\s*→\s*([A-Z]+)\.?\*\*\s*(.*)$/;
function ledgerRows(lines: readonly string[]): {rows: ReviewLedgerRow[]; clean: boolean}{
  const rows: ReviewLedgerRow[] = [];
  let clean = true;
  for (const l of lines){
    if (!l.trim()) continue;
    const m = REVIEW_LEDGER.exec(l);
    if (m) rows.push({id: m[1], date: m[2], outcome: m[3], note: m[4]});
    else clean = false;
  }
  return {rows, clean};
}
function reviewLedger(rounds: readonly ReviewRound[] | null | undefined): ReviewLedger{
  const out: ReviewLedger = {};
  for (const r of rounds || []){
    if (r.text == null) continue;
    const sec = P.parseSections(String(r.text)).secs.find(s => s.title.trim() === "Prior Findings");
    for (const row of sec ? ledgerRows(sec.body).rows : []) out[row.id] = Object.assign({file: r.file, k: r.k}, row);
  }
  return out;
}

// The map is closed, so a word from a review file picks a class but never
// writes into the attribute that carries it.
const SEVERITY_PILL: Record<string, string> = {must: "p-high", should: "p-med", question: "p-unk", nit: "p-low"};

export {NT_KEYS, LINK_ITEM, SEVERITY_PILL, ledgerRows, keyLabel, keyTitle, isFlat, isLine, isMap, NT_SWITCHES, localDate, footerText, VIEWS, viewOf, screenFromHash, repoLabel, pageTitle, themeChoice, themeFor,
  hashRead, hashWrite, logPaths, promptPaths, reviewPaths, corpusUrl, loadCorpus,
  reviewRounds, reviewHead, priorReviews, reviewFileRef,
  reviewLedger, reviewItems,
  fillPack, packSlots, packReadsTicket,
  packBasisKind, packGapKind, packContext, loadPacks, slugOf, promptDir, blankRow,
  unknownKeys, unknownValues, placeable};
export type {Screen, ThemeChoice, HashSelection, HashSelectionInput, FetchResponse, FetchFn,
  LoadCorpusOptions, FetchedText, ReviewFile, Corpus, RailEntry, RailModelGroup, ViewMode,
  SortState, CitationChip, CoverageRow,
  DecisionPanelRow, WatchPanelRow,
  PackBasisKind, PackGapKind,
  PackWatchRow, PackEntryRow, PackGapRow, PackPremortemRow, Pack, BlankRow,
  NtSwitchKey, Placed, BuilderReport, ReviewRound, ReviewGroup,
  ReviewVerdictKey, ReviewVerdictFields, ReviewHead, ReviewRef,
  ReviewLedgerRow, ReviewClosure, ReviewLedger};
