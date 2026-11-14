/* The inspector: one ticket's log, a section at a time or whole, with the
   decisions and watches the shown section cites. This file holds the app's
   one component that hands React a string of HTML. */
import {useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode} from "react";
import * as D from "../lib/adp-derive-lib.ts";
import * as I from "../lib/adp-index-lib.ts";
import * as P from "../lib/adp-parser-lib.ts";
import * as PL from "../lib/adp-prompt-lib.ts";
import * as S from "../lib/adp-shell-lib.ts";
import type {SectionEntry, SectionState} from "../lib/adp-derive-lib.ts";
import type {Ticket} from "../lib/adp-index-lib.ts";
import type {DLEntry, EscapedHtml, Section} from "../lib/adp-parser-lib.ts";
import type {YamlMap, YamlValue} from "../lib/adp-prompt-lib.ts";
import type {Corpus, DecisionPanelRow, FetchedText, SortState, ViewMode, WatchPanelRow} from "../lib/adp-shell-lib.ts";
import {DecisionsPanel, Pills, WatchesPanel, type PanelActions} from "./panels.tsx";
import {PhaseStrip, stripModel, type StripReviews} from "./PhaseStrip.tsx";

type HtmlProps = {html: EscapedHtml; as?: "div" | "span" | "td"; className?: string; style?: CSSProperties;
  onClick?(e: ReactMouseEvent<HTMLElement>): void};

/* The one place the app hands React a string of HTML. The prop takes only
   the parser library's escaped render, because the brand is cast nowhere
   else. A bare span takes no box of its own, so markup placed beside text
   sits in its parent's layout as if the parent held it directly. */
function Html({html, as = "span", className, style, onClick}: HtmlProps){
  const Tag = as;
  return <Tag className={className} style={as === "span" && !className ? {display: "contents"} : style}
    onClick={onClick} dangerouslySetInnerHTML={{__html: html}}/>;
}

/* A decision card's head folds its fields. The cards arrive as rendered
   HTML, so one listener on the section finds the head that took the click
   and flips it in place. We fold with an inline display, because the card
   body's own display rule outranks the hidden attribute. A fold lasts until
   the section renders new text. */
function foldCard(e: ReactMouseEvent<HTMLElement>){
  const head = (e.target as Element).closest(".adp-dl__head");
  if (!head || !e.currentTarget.contains(head)) return;
  const open = head.getAttribute("aria-expanded") !== "true";
  head.setAttribute("aria-expanded", String(open));
  const caret = head.querySelector(".adp-dl__caret");
  if (caret) caret.textContent = open ? "▾" : "▸";
  for (let el = head.nextElementSibling; el; el = el.nextElementSibling) (el as HTMLElement).style.display = open ? "" : "none";
}

/* A Prose container in the ticket view fills its pane. The Prose component
   caps its column at 72ch, which left a long card and its prose in a narrow
   band with the rest of the pane empty, so the reader asked for the full
   width. The pane's own padding keeps the text off its edges. */
const FILL: CSSProperties = {maxWidth: "none"};

// ---- the ticket's text, parsed once per text ----

/* A ticket's prompt as the inspector shows it: parsed, raw when the parse
   yields no keys, or unreadable when its fetch failed. */
type PromptView =
  | {state: "unreadable"}
  | {state: "raw"; text: string}
  | {state: "parsed" | "issues"; obj: YamlMap; issues: string[]; text: string};

function promptOf(p: FetchedText | undefined): PromptView | null {
  if (!p) return null;
  if (p.error != null) return {state: "unreadable"};
  const issues: string[] = [];
  let obj: YamlMap | null = null;
  try { obj = PL.parseYAML(p.text, issues); } catch { obj = null; }
  return obj && typeof obj === "object" && !Array.isArray(obj) && Object.keys(obj).length
    ? {state: issues.length ? "issues" : "parsed", obj, issues, text: p.text}
    : {state: "raw", text: p.text};
}

/* The split sections keyed by the contract's section keys, plus every DL
   entry found in any section, first id wins, the rule the harvest uses. */
type ParsedLog = {byKey: Record<string, Section>; cards: Record<string, DLEntry>};

function parseLog(text: string): ParsedLog {
  const secs = P.parseSections(text || "").secs;
  const keys = P.sectionKeys(secs);
  const byKey: Record<string, Section> = {};
  secs.forEach((s, i) => { byKey[keys[i]] = s; });
  const cards: Record<string, DLEntry> = {};
  for (const s of secs)
    for (const e of P.parseDLEntries(s.body.join("\n")).entries){
      const hm = e.head.match(/^\[([^\]]+)\]/);
      if (hm && !(hm[1] in cards)) cards[hm[1]] = e;
    }
  return {byKey, cards};
}

// ---- the section list ----

/* The prompt entry heads the list, because the prompt comes before every
   phase. Its key carries neither the "sec-" prefix of a section key nor the
   "missing:" prefix, so no heading can collide with it and every older
   link keeps its landing. */
const PROMPT_KEY = "prompt";
type Entry = SectionEntry & {prompt?: boolean};

function entriesOf(t: Ticket, prompt: PromptView | null): Entry[] {
  const entries: Entry[] = D.sectionEntries(t);
  return prompt ? [{key: PROMPT_KEY, title: "prompt.yaml", phase: null, canonical: false, missing: false, prompt: true}, ...entries] : entries;
}

const PROMPT_STATES: Record<PromptView["state"], SectionState> = {parsed: {label: "complete", tone: "ok"},
  issues: {label: "parse issues", tone: "warn"}, raw: {label: "shown raw", tone: "warn"}, unreadable: {label: "unreadable", tone: "bad"}};

function statesOf(t: Ticket, entries: Entry[], prompt: PromptView | null, today: string): Record<string, SectionState> {
  const states: Record<string, SectionState> = {};
  for (const en of entries) states[en.key] = en.prompt ? PROMPT_STATES[prompt!.state] : D.sectionState(t, en, today);
  return states;
}

// A ticket with no sections yet opens on its prompt. Every ticket with a
// log keeps the default it had before the prompt entry existed.
function defaultKey(t: Ticket, prompt: PromptView | null): string | null {
  if (!t.sections.length && prompt) return PROMPT_KEY;
  if (t.state === "open" || t.state === "in-review"){
    const cur = D.canonicalSection(t, t.phase);
    if (cur) return cur.key;
  }
  const spine = D.canonicalSection(t, 5);
  return (spine || t.sections[0] || {key: null}).key;
}

/* The section a selection lands on. An item-only link lands on the item's
   owning section, so key drift in the section token never strands a link
   that names a real item. A selection with neither lands on the default.
   A section the log no longer holds falls back to the default and says so. */
function resolveSection(t: Ticket, prompt: PromptView | null, s: string | null, item: string | null, today: string):
  {s: string | null; notice: string | null} {
  if (!t.sections.length && !prompt) return {s, notice: null};
  if (item && !s){
    const cs = D.citingSections(t, item);
    if (cs.length) s = cs[0];
  }
  if (!s && !item) s = defaultKey(t, prompt);
  if (s && !statesOf(t, entriesOf(t, prompt), prompt, today)[s])
    return {s: defaultKey(t, prompt), notice: `section "${s}" was not found in this log — the link may predate a retitle.`};
  return {s, notice: null};
}

// ---- the prompt view ----

/* The prompt view reads as a document, as the TicketPrompt board draws it.
   Each top-level key is an eyebrow heading, and a one-line value sits beside
   it. A map is a list of label and value rows under rules. A multi-line
   string is prose, so it goes through the markdown renderer the logs use,
   with the design system's blocks and chips. A one-line string shows escaped
   and exact. A link item becomes an anchor only for an absolute http, https,
   or mailto URL, because a relative one would resolve against this page.
   Every value shows, so the board's "Show more" folds are left out. The
   parts carry data-p hooks, not the old pcard classes, which the old sheet
   still styles for the vanilla builder. */
const P_NONE: CSSProperties = {color: "var(--faint)", fontStyle: "italic"};
const P_GRID: CSSProperties = {display: "grid", gridTemplateColumns: "minmax(96px, 160px) minmax(0, 1fr)", columnGap: 16,
  boxShadow: "inset 0 1px 0 var(--line)"};
const P_CELL: CSSProperties = {padding: "12px 0", boxShadow: "inset 0 -1px 0 var(--line)", minWidth: 0, overflowWrap: "anywhere"};
const P_K: CSSProperties = {...P_CELL, font: "400 13px/24px var(--font-sans)", color: "var(--dim)"};
const P_V: CSSProperties = {...P_CELL, font: "400 15px/24px var(--font-sans)", color: "var(--ink)"};
const P_TITLE: CSSProperties = {font: "500 11px/24px var(--font-mono)", letterSpacing: ".14em", textTransform: "uppercase", color: "var(--blue-bright)"};
const P_VAL: CSSProperties = {font: "400 16px/28px var(--font-sans)", color: "var(--ink)", minWidth: 0, overflowWrap: "anywhere"};
const P_KEY: CSSProperties = {marginLeft: "auto", font: "400 12px/24px var(--font-mono)", color: "var(--faint)"};
function Scalar({v, at}: {v: unknown; at: string}){
  if (v == null || v === "") return <span style={P_NONE}>empty</span>;
  if (typeof v === "string" && at === "context.links[]" && S.LINK_ITEM.test(v) && P.safeLinkUrl(v))
    return <a href={v} target="_blank" rel="noopener noreferrer">{v}</a>;
  return <>{String(v)}</>;
}

const NONE = <span style={P_NONE}>none</span>;

function Value({v, at}: {v: YamlValue; at: string}): ReactNode {
  if (typeof v === "string" && v.includes("\n")) return <Html as="div" className="md adp-prose" style={FILL} html={P.renderMarkdownDS(v)}/>;
  if (Array.isArray(v)){
    if (!v.length) return NONE;
    if (v.every(S.isFlat)){
      const cols: string[] = [];
      v.forEach(r => Object.keys(r).forEach(k => { if (!cols.includes(k)) cols.push(k); }));
      return <div className="md adp-prose" style={FILL}><div style={{overflowX: "auto", margin: "0 0 16px"}}><table className="adp-table">
        <thead><tr>{cols.map(c => <th key={c}>{S.keyLabel(c)}</th>)}</tr></thead>
        <tbody>{v.map((r, i) => <tr key={i}>{cols.map(c => S.isLine(r[c])
          ? <td key={c}><Scalar v={r[c]} at={at + "[]." + c}/></td>
          : <Html key={c} as="td" html={P.renderMarkdownDS(r[c])}/>)}</tr>)}</tbody>
      </table></div></div>;
    }
    return <div className="md adp-prose" style={FILL}><ul className="md-list">{v.map((x, i) =>
      <li key={i}><span>{S.isLine(x) ? <Scalar v={x} at={at + "[]"}/> : <Value v={x} at={at + "[]"}/>}</span></li>)}</ul></div>;
  }
  if (S.isMap(v)){
    const ks = Object.keys(v);
    if (!ks.length) return NONE;
    return <div style={P_GRID}>{ks.map(k => <PromptField key={k} k={k} v={v[k]} at={at + "." + k}/>)}</div>;
  }
  return <Scalar v={v} at={at}/>;
}

function PromptField({k, v, at}: {k: string; v: YamlValue; at: string}){
  return <><div data-p="k" style={P_K}>{S.keyLabel(k)}</div><div data-p="v" style={P_V}><Value v={v} at={at}/></div></>;
}

// The builder's keys come first in the order it writes them. A key the
// builder does not know still shows, after them and in file order, because
// a hand-written prompt may carry one and the view must not hide it.
function PromptCards({obj}: {obj: YamlMap}){
  const known = S.NT_KEYS[""].filter(k => k in obj);
  const keys = known.concat(Object.keys(obj).filter(k => !known.includes(k)));
  return <div>{keys.map((k, n) => {
    const v = obj[k];
    return <section key={k} data-p="card" style={{marginTop: n ? 32 : 0}}>
      <div style={{display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginBottom: 8}}>
        <span data-p="title" style={P_TITLE}>{S.keyTitle(k)}</span>
        {S.isLine(v) ? <span data-p="val" style={P_VAL}><Scalar v={v} at={k}/></span> : null}
        <span data-p="key" style={P_KEY}>{k}</span></div>
      {S.isLine(v) ? null : <Value v={v} at={k}/>}
    </section>;
  })}</div>;
}

function promptNotice(pr: PromptView): string | null {
  if (pr.state === "unreadable") return "prompt.yaml is listed in the corpus but could not be read.";
  if (pr.state === "raw") return "prompt.yaml did not parse as YAML — shown raw.";
  return pr.issues.length ? `prompt.yaml parsed with ${pr.issues.length} issue${pr.issues.length === 1 ? "" : "s"}: ${pr.issues.join("; ")}` : null;
}

function PromptBody({pr}: {pr: PromptView}){
  if (pr.state === "unreadable") return null;
  if (pr.state === "raw") return <pre className="rawpre">{pr.text}</pre>;
  return <PromptCards obj={pr.obj}/>;
}

// ---- the panes ----

// A section body renders as the decision-log card list when its title is
// the spine, and as markdown with any decision cards drawn in place
// otherwise. The pane and the full log both read this rule.
// Mission control draws the design system's decision card.
const DS = {ds: true};
function SectionBody({sec, body}: {sec: Section | null; body: string}){
  return sec ? <Html as="div" className="md adp-prose" style={FILL} onClick={foldCard}
    html={P.metaFor(sec.title).spine ? P.renderDecisionLog(body, DS) : P.renderSectionBody(body, DS)}/> : null;
}

/* The permalink copies the page's address. The label says it copied for a
   moment and then rests, the way the vanilla control did. */
function Permalink(){
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 900);
    return () => clearTimeout(t);
  }, [copied]);
  const copy = () => {
    try { navigator.clipboard.writeText(location.href); } catch {}
    setCopied(true);
  };
  return <button type="button" className="adp-btn adp-btn--text" data-permalink="1" title="copy link to this view" onClick={copy}>{copied ? "copied" : "⧉ link"}</button>;
}

type DocPaneProps = {back?: string; onBack?(): void; heading: string; badge?: string | null; notice?: string | null;
  action?: ReactNode; children?: ReactNode};

/* A message in the ticket view: a section never written, a link that found
   nothing, or no ticket yet. It takes the design system's Notice. */
function Notice({text}: {text: string}){
  return <div className="adp-notice" style={{marginBottom: 16}}><span className="adp-notice__text">{text}</span></div>;
}

// The section pane sits on the 4px grid. The old pane class keeps its panel
// ground and border, and we set its padding and spacing here.
const PANE: CSSProperties = {padding: "16px 24px", margin: "0 0 16px"};
// The old sheet's ".screen h2" outranks the system's section class and sets a
// mono uppercase face, so the section heading states the system's values.
const SECTION_HEAD: CSSProperties = {margin: 0, font: "600 20px/28px var(--font-sans)", letterSpacing: "normal", textTransform: "none"};
const FSEC: CSSProperties = {boxShadow: "inset 0 1px 0 var(--line)"};
const FSUM: CSSProperties = {padding: "12px 0", cursor: "pointer", font: "600 16px/24px var(--font-sans)", color: "var(--ink)"};

function DocPane({back, onBack, heading, badge, notice, action, children}: DocPaneProps){
  return <div className="doc" style={PANE}>
    {back ? <button type="button" className="adp-btn adp-btn--text" data-op="back" style={{marginBottom: 8}} onClick={onBack}>← back to {back}</button> : null}
    <div style={{display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 16}}>
      <h2 className="adp-section" style={SECTION_HEAD}>{heading}</h2>
      {badge ? <span className="adp-chip adp-chip--s">{badge}</span> : null}
      <Permalink/>
    </div>
    {notice ? <Notice text={notice}/> : null}
    {action}
    {children}
  </div>;
}

/* Each ticket state takes the status chip of its meaning. Work still in
   flight reads as open, a shipped ticket as validated, and a closed one as
   the neutral closed chip. The word is the index's own state word. */
const STATE_CHIP: Record<Ticket["state"], string> = {"open": "adp-chip--open", "in-review": "adp-chip--open",
  "shipped": "adp-chip--validated", "closed": "adp-chip--closed"};
const SOURCE: Record<Ticket["state_source"], string> = {declared: "declared in front matter", inferred: "inferred from the log"};

/* The ticket head, as the Main board draws it: a meta line, the title, and
   the state with where it came from, then the view toggle and the resume
   pack on the right. The meta line keeps the directory name, because the
   index carries no author and the old head showed the directory. Review
   rounds open from the phase strip below the head. */
function Tickhead({t, view, act}: {t: Ticket; view: ViewMode | null; act: InspectorActions}){
  const meta = [t.id, t.date, t.dir].filter(Boolean).join(" · ");
  return <div id="tickHead" style={{display: "flex", alignItems: "flex-start", gap: 24, flexWrap: "wrap", marginBottom: 16}}>
    <div style={{flex: "1 1 360px", minWidth: 0}}>
      <div style={{font: "400 13px/24px var(--font-mono)", color: "var(--dim)"}}>{meta}</div>
      <h1 style={{margin: "8px 0 0", font: "600 24px/32px var(--font-sans)", color: "var(--ink)"}}>{t.title || t.slug || t.id || t.dir}</h1>
      <div style={{display: "flex", alignItems: "center", gap: 8, marginTop: 12, flexWrap: "wrap"}}>
        <span className={"adp-chip " + STATE_CHIP[t.state]} style={{textTransform: "uppercase"}}
          title="lifecycle state — declared in front matter, or inferred from section presence on legacy logs">{t.state}</span>
        <span className="adp-meta">{SOURCE[t.state_source]}</span>
        {t.pr ? <><span className="adp-meta" aria-hidden="true" style={{color: "var(--faint)"}}>·</span><span className="adp-meta">PR #{t.pr}</span></> : null}
      </div>
    </div>
    {view ? <div style={{display: "flex", gap: 8, alignItems: "center"}}>
      <div className="adp-seg" role="group" aria-label="View">
        <button type="button" data-view="section" aria-pressed={view === "section"} onClick={() => act.onView("section")}>Section</button>
        <button type="button" data-view="full" aria-pressed={view === "full"} onClick={() => act.onView("full")}>Full log</button>
      </div>
      <button type="button" className="adp-btn" data-op="resume" onClick={e => act.onResume(e.currentTarget)}>Resume pack</button>
    </div> : null}
  </div>;
}

/* The strip's reviews box opens the latest round. prreview numbers its
   rounds across every PR of a ticket, so the latest round is the highest
   number, which is the round the reviews screen calls latest too. */
function reviewsOf(corpus: Corpus | null, tok: string, dir: string, onRound: (tok: string, file: string) => void): StripReviews | null {
  const rounds = (corpus && corpus.reviews ? S.reviewRounds(corpus.reviews[dir]) : []).flatMap(g => g.rounds);
  if (!rounds.length) return null;
  const latest = rounds.reduce((a, r) => r.k > a.k ? r : a);
  return {count: rounds.length, onOpen: () => onRound(tok, latest.file)};
}

function SecNav({entries, states, selKey, onPick, onStep}: {entries: Entry[]; states: Record<string, SectionState>;
  selKey: string | null; onPick(key: string): void; onStep(d: number): void}){
  const i = entries.findIndex(en => en.key === selKey);
  return <div className="secnav" style={{display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", margin: "12px 0 16px"}}>
    <button type="button" className="adp-btn" data-secstep="-1" disabled={i <= 0} onClick={() => onStep(-1)}>‹ prev</button>
    <select id="secSel" className="adp-select" aria-label="section" style={{flex: "0 1 440px", minWidth: 220, lineHeight: "normal"}}
      value={i >= 0 ? entries[i].key : ""} onChange={e => onPick(e.target.value)}>
      {entries.map(en => {
        const st = states[en.key];
        const base = en.phase != null ? `phase ${en.phase} · ${en.title}` : en.title;
        return <option key={en.key} value={en.key}>{st.label === "complete" ? base : `${base} — ${st.label}`}</option>;
      })}
    </select>
    <button type="button" className="adp-btn" data-secstep="1" disabled={i < 0 || i >= entries.length - 1} onClick={() => onStep(1)}>next ›</button>
  </div>;
}

// ---- the screen ----

type InspSel = {s: string | null; item: string | null};
type InspectorActions = PanelActions & {
  onView(v: ViewMode): void;
  onSection(key: string): void;
  onStep(key: string): void;
  onBack(): void;
  onFilter(f: string): void;
  onToggle(key: string, open: boolean): void;
  onExpand(open: boolean, keys: string[]): void;
  onRound(tok: string, file: string): void;
  onSpy(key: string): void;
  onStartFrom(text: string, source: string): void;
  // Opens the Packs drawer on the resume pack for the ticket on show.
  onResume(opener: HTMLElement): void;
};
type InspectorProps = {
  corpus: Corpus | null;
  today: string;
  t: Ticket | undefined;
  tokenOf(t: Pick<Ticket, "dir">): string;
  notice: string | null;
  sel: InspSel;
  view: ViewMode;
  dlFilter: string;
  missNotice: string | null;
  fullClosed: ReadonlySet<string>;
  decSort: SortState;
  iwSort: SortState;
  // A jump scrolls the stage once: to the section nav for a pane, or to one
  // full-log section by its key. jumped holds the last sequence number
  // served, so a screen that mounts again does not replay an old jump.
  jump: {to: string | null; seq: number};
  jumped: {current: number};
  // False while a modal holds the page, so ← and → leave the ticket alone.
  arrows: boolean;
  act: InspectorActions;
};

// A canonical section's chip carries its phase. A non-canonical one still
// gets the artifact family's tag when the registry knows the title, and its
// kind otherwise, so a ledger or an ad hoc note is named rather than marked §.
function chipModel(t: Ticket, key: string){
  const s = t.sections.find(x => x.key === key);
  const meta = s ? P.metaFor(s.title) : null;
  return {key, label: !s ? "§" : s.phase != null ? "P" + s.phase : meta!.tag || meta!.kind, title: s ? s.title : key};
}

/* The decisions and watches panels build their rows here, so the inspector
   and the reviews screen sort, chip, and highlight a cited entry the same
   way. */
const CONF_RANK: Record<string, number> = {high: 3, medium: 2, low: 1};
function decisionRows(t: Ticket, shown: Ticket["decisions"], sort: SortState, item: string | null): DecisionPanelRow[] {
  return D.sortRows(shown, sort.k, sort.d, {
    id: d => d.id, title: d => d.title, conf: d => CONF_RANK[P.dlConfKind(d.confidence)] || 0,
    status: d => D.decisionKind(d), watch: d => (D.coveringWatch(t, d.id) || {wid: ""}).wid,
    cited: d => D.citingSections(t, d.id).length
  }).map(d => {
    // A settled row shows how its watch ended, so the empty watch column
    // never reads as data loss once coverage has closed.
    const sw = D.settledWatch(t, d.id);
    return {id: d.id, title: d.title, conf: P.dlChipSplit(d.confidence).word, confKind: P.dlConfKind(d.confidence),
      statusKind: D.decisionKind(d), watch: (D.coveringWatch(t, d.id) || {wid: null}).wid,
      settled: sw && {wid: sw.wid, outcome: sw.outcome, closed: sw.closed},
      chips: D.citingSections(t, d.id).map(k => chipModel(t, k)), hl: item === d.id};
  });
}
function watchRows(t: Ticket, list: Ticket["watches"], sort: SortState, item: string | null, today: string): WatchPanelRow[] {
  return D.sortRows(list, sort.k, sort.d, {
    wid: w => w.wid, what: w => w.what, dl: w => (w.dl || []).join(","),
    due: w => w.anchored ? D.daysUntil(w.due!, today) : Infinity,
    state: w => D.dueState(w, today), cited: w => D.citingSections(t, w.wid).length
  }).map(w => ({wid: w.wid, what: w.what, dls: w.dl || [],
    dueText: w.anchored ? w.due : (w.window || "relative"), dueDated: !!w.anchored,
    state: D.dueState(w, today), stateLabel: D.dueLabel(w, today),
    chips: D.citingSections(t, w.wid).map(k => chipModel(t, k)), hl: item === w.wid}));
}

const STATUS_FILTERS = ["open", "validated", "invalidated"] as const;
function filterCounts(decisions: Ticket["decisions"]): Record<string, number> {
  const counts: Record<string, number> = {all: decisions.length};
  for (const k of STATUS_FILTERS) counts[k] = decisions.filter(d => D.decisionKind(d) === k).length;
  return counts;
}

/* The full log marks the section in view as the reader scrolls the stage,
   the way the viewer's table of contents did. A section counts as in view
   once its top edge reaches the top of the stage's content. The mark is
   the section selector itself, so the selector, its state chit, and the
   address all name the section the reader is in. A section near the end
   of a log may never reach the top. When the stage sits at its end and
   the selected section is such a section in view, the selection stays, so
   a pick or a step onto it holds until the reader scrolls back up. A rail
   pick keeps the full log on, and the new ticket's log is still unread, so
   the spy starts over for each ticket. */
const SPY_SLACK = 20;
function useScrollSpy(on: boolean, ticket: string | undefined, selected: string | null, onSpy: (key: string) => void){
  const spy = useRef(onSpy);
  spy.current = onSpy;
  const picked = useRef(selected);
  picked.current = selected;
  useEffect(() => {
    if (!on) return;
    const stage = document.querySelector(".stage");
    if (!stage) return;
    let tick = false;
    const run = () => {
      tick = false;
      const secs = [...document.querySelectorAll<HTMLElement>("#scrInspector .fsec")];
      if (!secs.length) return;
      const box = stage.getBoundingClientRect();
      const top = box.top + SPY_SLACK;
      let at = 0;
      for (const [i, s] of secs.entries()){ if (s.getBoundingClientRect().top <= top) at = i; else break; }
      const held = secs.findIndex(s => s.getAttribute("data-key") === picked.current);
      const atEnd = stage.scrollTop + stage.clientHeight >= stage.scrollHeight - 1;
      if (atEnd && held > at && secs[held].getBoundingClientRect().top < box.bottom) return;
      const key = secs[at].getAttribute("data-key");
      if (key) spy.current(key);
    };
    const mark = () => { if (tick) return; tick = true; requestAnimationFrame(run); };
    let scrolled = false;
    const scroll = () => { scrolled = true; mark(); };
    stage.addEventListener("scroll", scroll, {passive: true});
    /* A late web font can move the sections with no scroll event, so a
       change in the screen's size marks again. Until the reader scrolls,
       the selection stays the one they opened the full log on, so a size
       change before the first scroll marks nothing. */
    const resize = new ResizeObserver(() => { if (scrolled) mark(); });
    const screen = document.querySelector("#scrInspector");
    if (screen) resize.observe(screen);
    return () => { stage.removeEventListener("scroll", scroll); resize.disconnect(); };
  }, [on, ticket]);
}

// The step that stands for the reviews box. No section key can match it,
// because every section key starts with "sec-", "missing:", or is "prompt".
const REVIEWS_STEP = "reviews";

// A key typed into a field belongs to the field, so no shortcut takes it.
const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName));

/* ← and → step through the boxes of the phase strip: the prompt, each
   written phase, the extra sections, then the reviews. A selection on no
   box, such as a missing phase, steps from the strip's start. */
function useArrows(on: boolean, steps: readonly string[], current: string | null, onStep: (key: string) => void){
  useEffect(() => {
    if (!on || !steps.length) return;
    const key = (e: KeyboardEvent) => {
      if ((e.key !== "ArrowLeft" && e.key !== "ArrowRight") || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || typing(e.target)) return;
      const i = current == null ? -1 : steps.indexOf(current);
      const next = e.key === "ArrowRight" ? (i < 0 ? 0 : i + 1) : i - 1;
      if (next < 0 || next >= steps.length) return;
      e.preventDefault();
      onStep(steps[next]);
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [on, steps.join("\n"), current, onStep]);
}

function Inspector({corpus, today, t, tokenOf, notice, sel, view, dlFilter, missNotice, fullClosed, decSort, iwSort, jump, jumped, arrows, act}: InspectorProps){
  const text = t && corpus ? corpus.texts[t.dir] || "" : "";
  const promptSrc = t && corpus ? corpus.prompts[t.dir] : undefined;
  const pd = useMemoText(text);
  const prompt = useMemoPrompt(promptSrc);
  useScrollSpy(view === "full" && !!t, t?.dir, sel.s, act.onSpy);
  // The strip is built before any early return, because the arrow keys hook
  // into it on every render.
  const strip = stripModel(t && (t.sections.length || prompt) ? entriesOf(t, prompt) : [], sel.s);
  const box = [strip.prompt, ...strip.phases, ...(strip.extra ? [strip.extra] : [])].find(b => b.current);
  const reviews = t ? reviewsOf(corpus, revTok(corpus, tokenOf, t.dir), t.dir, act.onRound) : null;
  useArrows(arrows && !!t, reviews ? [...strip.steps, REVIEWS_STEP] : strip.steps, box ? box.key : null,
    key => key === REVIEWS_STEP ? reviews!.onOpen() : act.onStep(key));
  useLayoutEffect(() => {
    if (jump.seq <= jumped.current) return;
    jumped.current = jump.seq;
    const el = jump.to == null ? document.querySelector("#scrInspector .secnav")
      : [...document.querySelectorAll("#scrInspector .fsec")].find(d => d.getAttribute("data-key") === jump.to);
    if (el && el.scrollIntoView) el.scrollIntoView();
  }, [jump.seq]);

  // The three regions keep the vanilla page's ids: the top (the ticket
  // head), the section nav, and the body (pane and panels).
  const regions = (top: ReactNode, nav: ReactNode, body: ReactNode) =>
    <><div id="inspTop">{top}</div><div id="inspNav">{nav}</div><div id="inspBody">{body}</div></>;
  if (!t) return regions(null, null, <div className="ipanel"><Notice text={notice || (corpus
    ? "select a ticket from the rail"
    : "no corpus behind this page — the inspector reads the served corpus.")}/></div>);

  const top = <Tickhead t={t} view={view} act={act}/>;
  if (!t.sections.length && !prompt)
    return regions(top,
      reviews ? <PhaseStrip model={stripModel([], null)} reviews={reviews} onPick={act.onStep}/> : null,
      <div className="ipanel"><Notice text="this ticket has no audit log yet — only its prompt or other files sit in the directory."/></div>);

  const entries = entriesOf(t, prompt);
  const states = statesOf(t, entries, prompt, today);

  const sectionPane = (en: Entry | undefined) => {
    const sec = en && !en.missing ? pd.byKey[en.key] || null : null;
    const body = sec ? sec.body.join("\n") : "";
    const ref = S.reviewFileRef(body);
    const round = ref && corpus && corpus.reviews && (corpus.reviews[ref.dir] || []).some(f => f.file === ref.file) ? ref : null;
    return <DocPane heading={en ? (en.phase != null ? "phase " + en.phase + " · " + en.title : en.title) : "—"}
      badge={en && en.missing ? "missing" : en && !en.canonical ? "non-canonical" : null}
      notice={missNotice || (en && en.missing ? "this section was never written. A missing canonical section is an attention reason on the rail." : null)}
      action={round ? <p style={{margin: "0 0 16px"}}><RoundLink tok={revTok(corpus, tokenOf, round.dir)} file={round.file} label="open round in reviews ›" onRound={act.onRound}/></p> : null}>
      <SectionBody sec={sec} body={body}/>
    </DocPane>;
  };

  let pane: ReactNode, panels: ReactNode = null;
  if (view === "full"){
    const list = entries.filter(en => !en.missing);
    pane = <><div style={{display: "flex", alignItems: "center", gap: 16, margin: "0 0 16px"}}>
      <button type="button" className="adp-btn adp-btn--text" data-exp="open" onClick={() => act.onExpand(true, list.map(en => en.key))}>expand all</button>
      <button type="button" className="adp-btn adp-btn--text" data-exp="close" onClick={() => act.onExpand(false, list.map(en => en.key))}>collapse all</button></div>
      {list.map(en => {
        const sec = en.prompt ? null : pd.byKey[en.key] || null;
        const heading = en.prompt ? "prompt.yaml" : en.phase != null ? "phase " + en.phase + " · " + en.title : en.title;
        const badge = en.prompt || en.canonical ? null : "non-canonical";
        const pn = en.prompt ? promptNotice(prompt!) : null;
        // We toggle the details ourselves, so the collapse state lives in
        // the app and survives every render.
        // Each section is a row under a rule, as the TicketFullLog board draws it.
        return <details key={en.key} className="fsec" data-key={en.key} open={!fullClosed.has(en.key)} style={FSEC}>
          <summary className="fsum" style={FSUM} onClick={e => { e.preventDefault(); act.onToggle(en.key, fullClosed.has(en.key)); }}>
            {heading}{badge ? <>{" "}<span className="adp-chip adp-chip--s" style={{marginLeft: 8}}>{badge}</span></> : null}</summary>
          <div style={{padding: "0 0 24px 24px"}}>{en.prompt
            ? <>{pn ? <Notice text={pn}/> : null}<PromptBody pr={prompt!}/></>
            : <SectionBody sec={sec} body={sec ? sec.body.join("\n") : ""}/>}</div>
        </details>;
      })}</>;
  } else if (sel.item && I.RE_DL.test(sel.item)){
    const en = entries.find(x => x.key === sel.s);
    const card = pd.cards[sel.item];
    pane = <DocPane back={en ? en.title : "sections"} onBack={act.onBack} heading={"[" + sel.item + "]"}
      notice={card ? null : "this entry is cited here but not present in the loaded text."}>
      {card ? <Html as="div" className="md adp-prose" style={FILL} onClick={foldCard} html={P.renderDLCard(card, DS)}/> : null}
    </DocPane>;
  } else if (sel.s === PROMPT_KEY){
    // A prompt that did not parse still gets the action, so New task can
    // say why it took nothing.
    const pr = prompt!;
    const start = pr.state === "unreadable" ? null : <div style={{margin: "0 0 16px"}}>
      <button type="button" className="adp-btn" data-op="startfrom" onClick={() => act.onStartFrom(pr.text, t.dir + "/prompt.yaml")}>start from this prompt</button></div>;
    pane = <DocPane heading="prompt.yaml" notice={missNotice || promptNotice(pr)} action={start}><PromptBody pr={pr}/></DocPane>;
  } else pane = sectionPane(entries.find(x => x.key === sel.s) || entries[0]);

  if (view !== "full"){
    const items = D.sectionItems(t, sel.s || "");
    const counts = filterCounts(items.decisions);
    const shown = dlFilter === "all" ? items.decisions : items.decisions.filter(d => D.decisionKind(d) === dlFilter);
    const en = entries.find(x => x.key === sel.s);
    const label = en ? en.title : "this section";
    panels = <>
      {items.decisions.length ? <DecisionsPanel label={label} sort={decSort} rows={decisionRows(t, shown, decSort, sel.item)}
        pills={<Pills counts={counts} active={dlFilter} mark="data-dlf" onPick={act.onFilter}/>}
        onSort={act.onSort} onRow={act.onRow} onWatch={act.onWatch} onChip={act.onChip}/> : null}
      {items.watches.length ? <WatchesPanel label={label} sort={iwSort} rows={watchRows(t, items.watches, iwSort, sel.item, today)}
        onSort={act.onSort} onWatch={act.onWatch} onChip={act.onChip}/> : null}
    </>;
  }

  return regions(top,
    <><PhaseStrip model={strip} reviews={reviews} onPick={act.onStep}/>
      <SecNav entries={entries} states={states} selKey={sel.s} onPick={act.onSection} onStep={d => {
        const i = entries.findIndex(en => en.key === sel.s) + d;
        if (i >= 0 && i < entries.length) act.onStep(entries[i].key);
      }}/></>,
    <>{pane}{panels}</>);
}

// A round link is an in-page hash, so its href never carries a URL that
// came out of a review file. A click routes in the app.
function RoundLink({tok, file, label, onRound}: {tok: string; file: string; label: string; onRound(tok: string, file: string): void}){
  return <a className="rvl" href={S.hashWrite({v: "reviews", t: tok, s: file})} data-t={tok} data-rf={file}
    onClick={e => { e.preventDefault(); onRound(tok, file); }}>{label}</a>;
}

// A review that names a ticket by directory links by that ticket's rail
// token, and by the directory itself when the corpus lacks the ticket.
function revTok(corpus: Corpus | null, tokenOf: (t: Pick<Ticket, "dir">) => string, dir: string): string {
  const t = corpus && corpus.index.tickets.find(x => x.dir === dir);
  return t ? tokenOf(t) : dir;
}

// The text and the prompt keep their identity across a reload that changed
// nothing, so each parse runs once per text.
function useMemoText(text: string): ParsedLog {
  const ref = useRef<{text: string; out: ParsedLog} | null>(null);
  if (!ref.current || ref.current.text !== text) ref.current = {text, out: parseLog(text)};
  return ref.current.out;
}
function useMemoPrompt(p: FetchedText | undefined): PromptView | null {
  const ref = useRef<{p: FetchedText | undefined; out: PromptView | null} | null>(null);
  if (!ref.current || ref.current.p !== p) ref.current = {p, out: promptOf(p)};
  return ref.current.out;
}

export {FILL, Html, Inspector, typing, Permalink, PromptCards, RoundLink, PROMPT_KEY, promptOf, resolveSection, entriesOf, decisionRows, watchRows, filterCounts, revTok, SPY_SLACK};
export type {InspectorActions, InspSel, PromptView};
