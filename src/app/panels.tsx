/* The tables and filter bars that more than one screen draws: the
   decisions and watches a section or a review round cites, the coverage
   cell, and the status filters. Every value is a React text child, so none
   of these pieces handles HTML. */
import {Fragment, type CSSProperties, type KeyboardEvent, type MouseEvent, type ReactNode} from "react";
import type {DueState} from "../lib/adp-derive-lib.ts";
import type {CitationChip, CoverageRow, DecisionPanelRow, SortState, WatchPanelRow} from "../lib/adp-shell-lib.ts";

type ThProps = {sort: SortState; t: string; k: string; label: string; num?: boolean; onSort(k: string): void};

/* A sortable column header. A th turns neither Enter nor Space into a click
   the way a button does, so the key handler fires the same sort the click
   does. aria-sort sits on the one sorted header, and the arrow repeats it for
   the eye, so the arrow stays out of the accessibility tree. The arrow
   follows the label after a space, as the Table boards draw "Due ↑". A
   numeric column aligns right under its right-aligned numbers. */
function Th({sort, t, k, label, num, onSort}: ThProps){
  const on = sort.k === k;
  const key = (e: KeyboardEvent) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    onSort(k);
  };
  return <th className="sth" scope="col" tabIndex={0} data-t={t} data-k={k} style={{cursor: "pointer", whiteSpace: "nowrap", ...(num ? {textAlign: "right"} : null)}}
    aria-sort={on ? (sort.d > 0 ? "ascending" : "descending") : undefined}
    onClick={() => onSort(k)} onKeyDown={key}>
    {label}{on ? <span aria-hidden="true">{sort.d > 0 ? " ↑" : " ↓"}</span> : null}
  </th>;
}

/* The Watches and Ledger pages, as their boards draw them: a 1120px page
   with a title, a subtitle, and a search field beside the filters. */
const PAGE_HEAD: CSSProperties = {margin: 0};
const PAGE_TITLE: CSSProperties = {margin: 0, font: "600 24px/32px var(--font-sans)", letterSpacing: "normal", textTransform: "none", color: "var(--ink)"};
const PAGE_SUB: CSSProperties = {margin: "8px 0 0", font: "400 15px/24px var(--font-sans)", color: "var(--dim)"};
const SEARCH: CSSProperties = {flex: "1 1 260px", maxWidth: 320};

// A long list shows this many rows, then this many more per Show more.
const PAGE_ROWS = 50;

// A search matches any of a row's fields, in any case.
const matches = (query: string, ...fields: (string | null | undefined)[]) => {
  const q = query.trim().toLowerCase();
  return !q || fields.some(f => !!f && f.toLowerCase().includes(q));
};

/* The Table component's footer for a long list: how many rows show, and a
   Show more text button. It shows only while rows are hidden. */
function ShowMore({shown, total, onMore}: {shown: number; total: number; onMore(): void}){
  if (shown >= total) return null;
  return <div className="adp-table-more">Showing {shown} of {total} · <button type="button" className="adp-btn adp-btn--text" onClick={onMore}>Show more</button></div>;
}

const FILTER_KEYS = ["all", "open", "validated", "invalidated"];

type FiltersProps = {
  label: string;
  counts: Record<string, number>;
  active: string;
  // The data mark the filters carry, which says which filter a button belongs to.
  mark: string;
  keys?: readonly string[];
  style?: CSSProperties;
  onPick(key: string): void;
};

/* The design system's FilterBar, one choice at a time. A key shows when it
   has a count, and ALL always shows. Pressing the active filter again clears
   it, as the FilterBar asks. */
function Filters({label, counts, active, mark, keys = FILTER_KEYS, style, onPick}: FiltersProps){
  return <div className="adp-filters" role="group" aria-label={label} style={style}>
    {keys.filter(f => f === "all" || counts[f]).map(f => <button key={f} type="button" className="adp-filter" aria-pressed={active === f}
      {...{[mark]: f}} onClick={() => onPick(active === f ? "all" : f)}>{f.toUpperCase()} <span>{counts[f]}</span></button>)}
  </div>;
}

/* A live update can empty the bucket a reader filtered on. The FilterBar
   then falls back to ALL, so the list never goes blank behind a filter
   that no longer shows. */
const liveFilter = (active: string, counts: Record<string, number>) => active === "all" || counts[active] ? active : "all";

/* A watch's due state as a small StatusChip. The state word always shows,
   so the color never carries the state alone. Each state keeps the tone it
   had before the design system: overdue reads bad, soon and unanchored warn,
   upcoming ok, and closed neutral. */
const DUE_TONE: Record<DueState, string> = {overdue: " adp-chip--invalidated", soon: " adp-chip--open", unanchored: " adp-chip--open",
  upcoming: " adp-chip--validated", closed: " adp-chip--closed"};
function DueChip({state}: {state: DueState}){
  return <span className={"adp-chip adp-chip--s" + DUE_TONE[state]}>{state.toUpperCase()}</span>;
}

// The Left column counts days to the due date. An overdue watch counts below
// zero, and a watch with no date or a closed one has no count.
const leftText = (n: number | null) => n == null ? "—" : n + "d";

// A status word as a small StatusChip in the tone of its kind. The word is
// the kind itself unless the log wrote its own, such as a settled outcome.
function StatusChip({kind, word}: {kind: string; word?: string}){
  const tone = kind === "open" || kind === "validated" || kind === "invalidated" || kind === "unknown" ? " adp-chip--" + kind : "";
  return <span className={"adp-chip adp-chip--s" + tone}>{word ?? kind.toUpperCase()}</span>;
}

type WatchLink = (wid: string, title?: string) => ReactNode;

/* A decision's coverage cell, shared by the inspector and the ledger. An
   open decision whose watch has closed is unwatched again, so the marker
   leads. A settled watch keeps its cell to the id, and how coverage ended
   rides the link's hover title. */
function WatchCell({d, link}: {d: CoverageRow; link: WatchLink}){
  if (d.watch) return <>{link(d.watch)}</>;
  const mark = <span className="adp-chip adp-chip--s adp-chip--open">no watch</span>;
  if (d.settled) return <>{d.statusKind === "open" ? <>{mark}{" "}</> : null}{link(d.settled.wid, "closed " + d.settled.outcome + " " + d.settled.closed)}</>;
  return d.statusKind === "open" ? mark : null;
}

// A click inside a row goes to the control it hit and stops there, so the
// row's own open action does not run as well.
const only = (f: () => void) => (e: MouseEvent) => { e.stopPropagation(); f(); };

// These links route in the app and carry no href, so they need the pointer the browser gives only to an href.
const PTR: CSSProperties = {cursor: "pointer"};
const NW: CSSProperties = {whiteSpace: "nowrap"};
const MONO: CSSProperties = {fontFamily: "var(--font-mono)", fontSize: 12};

function Chips({list, onChip}: {list: CitationChip[]; onChip(key: string): void}){
  return <span style={{display: "inline-flex", flexWrap: "wrap", gap: 4}}>{list.map(c => <a key={c.key} className="adp-chip adp-chip--s" data-key={c.key}
    title={c.title} style={PTR} onClick={only(() => onChip(c.key))}>{c.label}</a>)}</span>;
}

/* A panel's head, as the Main board draws it: a mono eyebrow and its row
   count. The panel sits under the pane, the board's 56px below the
   article, which the pane's own 16px margin makes up with this 40px. */
function PanelHead({title, count}: {title: string; count: number}){
  return <div style={{display: "flex", alignItems: "baseline", gap: 12}}>
    <h3 className="adp-label">{title}</h3><span style={{font: "400 11px/24px var(--font-mono)", color: "var(--faint)"}}>{count}</span></div>;
}
const PANEL: CSSProperties = {marginTop: 40};
const TABLE: CSSProperties = {marginTop: 12};
// A cited row the reader came for takes the raised ground. The accent belongs to the live dot alone.
const HL: CSSProperties = {background: "var(--panel-2)"};

type PanelActions = {
  onSort(t: string, k: string): void;
  onRow(id: string): void;
  onWatch(wid: string): void;
  onChip(key: string): void;
};

type DecisionsPanelProps = PanelActions & {sort: SortState; count: number; filters: ReactNode; rows: DecisionPanelRow[]};

/* The Table component's decision columns, in its order, then the sections
   that cite each entry. The design system drops that last column, and we
   keep it because it is the one way from a row to the text that cites it. */
function DecisionsPanel({sort, count, filters, rows, onSort, onRow, onWatch, onChip}: DecisionsPanelProps){
  const wl = (wid: string, title?: string) => <a className="wl" data-item={wid} title={title} style={PTR} onClick={only(() => onWatch(wid))}>{wid}</a>;
  const th = (k: string, text: string, num?: boolean) => <Th sort={sort} t="dec" k={k} label={text} num={num} onSort={k => onSort("dec", k)}/>;
  return <section aria-label="Decisions cited" style={PANEL}><PanelHead title="Decisions cited here" count={count}/>
    {filters}
    <div style={{overflowX: "auto"}}><table className="adp-table" style={TABLE}>
      <thead><tr>{th("id", "Entry")}{th("title", "Decision")}{th("conf", "Conf")}{th("status", "Status")}{th("watch", "Watch")}{th("age", "Age", true)}{th("cited", "Cited in")}</tr></thead>
      <tbody>{rows.map(d => <tr key={d.id} className={"dlrow" + (d.hl ? " is-hl" : "")} data-dl={d.id} style={{...PTR, ...(d.hl ? HL : null)}} onClick={() => onRow(d.id)}>
        <td className="adp-col-id">{d.id}</td><td>{d.title}</td>
        <td className="adp-col-conf" style={NW}>{d.conf}</td>
        <td><StatusChip kind={d.statusKind}/></td>
        <td className="adp-col-id"><WatchCell d={d} link={wl}/></td>
        <td className="adp-col-num">{d.age == null ? "—" : d.age + "d"}</td>
        <td><Chips list={d.chips} onChip={onChip}/></td>
      </tr>)}</tbody>
    </table></div></section>;
}

type WatchesPanelProps = Omit<PanelActions, "onRow"> & {sort: SortState; rows: WatchPanelRow[]};

/* The Table component's watch columns, in its order, with two columns the
   design system drops. Status keeps the due state's word on screen, and
   Cited in keeps the way to the text that cites the watch. */
function WatchesPanel({sort, rows, onSort, onWatch, onChip}: WatchesPanelProps){
  const th = (k: string, text: string, num?: boolean) => <Th sort={sort} t="iw" k={k} label={text} num={num} onSort={k => onSort("iw", k)}/>;
  return <section aria-label="Watches cited" style={PANEL}><PanelHead title="Watches cited here" count={rows.length}/>
    <div style={{overflowX: "auto"}}><table className="adp-table" style={TABLE}>
      <thead><tr>{th("wid", "Watch")}{th("what", "What to check")}{th("dl", "Entry")}{th("due", "Due")}{th("state", "Status")}{th("left", "Left", true)}{th("cited", "Cited in")}</tr></thead>
      <tbody>{rows.map(w => <tr key={w.wid} className={"wrow" + (w.hl ? " is-hl" : "")} data-item={w.wid} style={w.hl ? HL : undefined}>
        <td className="adp-col-id">{w.wid}</td><td>{w.what}</td>
        <td className="adp-col-id">{w.dls.map((d, i) => <Fragment key={d}>{i ? " " : null}<a className="wl" data-item={d} style={PTR} onClick={only(() => onWatch(d))}>{d}</a></Fragment>)}</td>
        {/* A date holds one line, and an unanchored watch's window prose wraps in its place. */}
        <td style={{...MONO, ...(w.dueDated ? NW : null)}}>{w.dueText}</td>
        <td><DueChip state={w.state}/></td>
        <td className={"adp-col-num" + (w.state === "soon" ? " adp-col-num--soon" : "")}>{leftText(w.left)}</td>
        <td><Chips list={w.chips} onChip={onChip}/></td>
      </tr>)}</tbody>
    </table></div></section>;
}

export {Th, Filters, liveFilter, DueChip, StatusChip, leftText, WatchCell, DecisionsPanel, WatchesPanel, ShowMore, matches,
  PAGE_HEAD, PAGE_TITLE, PAGE_SUB, SEARCH, PAGE_ROWS, PTR, NW, MONO};
export type {PanelActions};
