import {useState, type MouseEvent, type ReactNode} from "react";
import * as D from "../lib/adp-derive-lib.ts";
import * as S from "../lib/adp-shell-lib.ts";
import type {DueState} from "../lib/adp-derive-lib.ts";
import type {Corpus, SortState} from "../lib/adp-shell-lib.ts";
import {Coded, DueChip, MONO, NW, PAGE_HEAD, PAGE_ROWS, PAGE_SUB, PAGE_TITLE, SEARCH, ShowMore, StatusChip, Th, leftText, matches} from "./panels.tsx";

const WATCH_STATES: DueState[] = ["overdue", "soon", "upcoming", "unanchored", "closed"];

type WatchboardProps = {
  corpus: Corpus | null;
  today: string;
  sort: SortState;
  show: ReadonlySet<DueState>;
  onSort(k: string): void;
  onToggleState(s: DueState): void;
  onOpen(tid: string, wid: string | null): void;
};

// A count in the subtitle reads "none" at zero, as the Watches board draws it.
const count = (n: number, word: string) => (n ? n : "none") + " " + word;

/* The corpus-wide watch table, the app's one watch surface. The filters are
   the five due states, any number at once, as they always were. Settled rows
   sit behind the closed filter with the outcome the closure ledger recorded.
   The search narrows every state's rows and counts alike. The links carry
   real deep-link hrefs so the keyboard can reach them, and a click routes in
   the app instead of jumping the hash. */
function Watchboard({corpus, today, sort, show, onSort, onToggleState, onOpen}: WatchboardProps){
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE_ROWS);
  const title = <h1 style={PAGE_TITLE}>Watches</h1>;
  if (!corpus) return <>{title}<Empty text="no corpus behind this page — the watchboard reads the served corpus index."/></>;
  const wb = D.watchboardRows(corpus.index.tickets, today);
  const all = wb.rows.filter(r => matches(query, r.wid, r.tid, r.what));
  const counts = Object.fromEntries(WATCH_STATES.map(s => [s, all.filter(r => r.state === s).length])) as Record<DueState, number>;
  const rows = D.sortRows(all.filter(r => show.has(r.state)), sort.k, sort.d, {
    tid: r => r.tid, wid: r => r.wid, what: r => r.what,
    due: r => r.order, state: r => r.order, left: r => r.order
  });
  const go = (tid: string, wid: string | null) => (e: MouseEvent) => { e.preventDefault(); onOpen(tid, wid); };
  const live = wb.rows.length - wb.counts.closed;
  const head = <div style={PAGE_HEAD}>{title}<p style={PAGE_SUB}>
    {live} live · {wb.counts.closed} settled · {count(wb.counts.overdue, "overdue")} · {count(wb.counts.unanchored, "unanchored")}</p></div>;
  const bar = <div style={{marginTop: 40, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap"}}>
    <input className="adp-input adp-input--sm" type="text" aria-label="Search watches" placeholder="Search watches" value={query}
      style={SEARCH} onChange={e => { setQuery(e.target.value); setLimit(PAGE_ROWS); }}
      onKeyDown={e => { if (e.key === "Escape" && query) { e.preventDefault(); setQuery(""); } }}/>
    <div className="adp-filters" role="group" aria-label="Filter watches">
      {WATCH_STATES.filter(s => wb.counts[s]).map(s => <button key={s} type="button" className="adp-filter"
        aria-pressed={show.has(s)} data-ws={s} onClick={() => onToggleState(s)}>{s.toUpperCase()} <span>{counts[s]}</span></button>)}
    </div></div>;
  // The Watches board fixes the widths of the short columns, so the text to check takes the rest.
  const th = (k: string, label: string, w?: number, num?: boolean) => <Th sort={sort} t="wb" k={k} label={label} w={w} num={num} onSort={onSort}/>;
  const thead = <thead><tr>{th("wid", "Watch", 128)}{th("what", "What to check")}{th("tid", "Ticket", 88)}{th("due", "Due", 96)}{th("state", "Status")}{th("left", "Left", 48, true)}</tr></thead>;
  // An empty table has three truths: a search that matched nothing, filters
  // that hide real rows, and a corpus that never opened a watch. We say which
  // one is happening, in the table's own body, as the no-results board draws it.
  if (!rows.length) return <>{head}{bar}<table className="adp-table" style={{marginTop: 16}}>{thead}<tbody><tr><td colSpan={6}>
    {query && !all.length
      ? <NoMatch what="watches" query={query} scope="IDs, tickets and the text to check, across live and settled" onClear={() => setQuery("")}/>
      : <div role="status">{wb.rows.length
        ? "every watch here is hidden by the status filters."
        : "no watches on record yet — no ticket in this corpus has opened an obligation table."}</div>}
  </td></tr></tbody></table></>;
  return <>{head}{bar}<div style={{overflowX: "auto"}}><table className="adp-table" style={{marginTop: 16}}>{thead}<tbody>
    {rows.slice(0, limit).map(r => <tr className="wbrow" data-wid={r.wid} key={r.dir + "\n" + r.wid}>
      <td className="adp-col-id"><a className="wbl" href={S.hashWrite({t: r.tid, item: r.wid})} data-t={r.tid} data-item={r.wid} onClick={go(r.tid, r.wid)}>{r.wid}</a></td>
      <td><Coded text={r.what}/></td>
      <td style={{...MONO, ...NW}}><a className="wbl" href={S.hashWrite({t: r.tid})} data-t={r.tid} onClick={go(r.tid, null)}>{r.tid}</a></td>
      {/* An unanchored row shows its window prose where a date would sit, so the flag explains itself. */}
      <td style={{...MONO, ...(r.anchored ? NW : null)}}>{r.anchored ? r.due : (r.window || "relative")}</td>
      {/* A settled row puts its outcome and closing day where a live row puts its due state, and Left reads CLOSED. */}
      <td style={NW}>{r.closed ? <><StatusChip kind={D.statusKind(r.outcome)} word={r.outcome ?? undefined}/> <span style={MONO}>{r.closed}</span></> : <DueChip state={r.state}/>}</td>
      <td className={"adp-col-num" + (r.state === "soon" ? " adp-col-num--soon" : "")}>{r.closed ? "CLOSED" : leftText(r.anchored ? r.order : null)}</td>
    </tr>)}
  </tbody></table></div><ShowMore shown={Math.min(limit, rows.length)} total={rows.length} onMore={() => setLimit(n => n + PAGE_ROWS)}/></>;
}

/* A screen with no corpus behind it says so in a Notice, under the page title. */
function Empty({text}: {text: string}): ReactNode {
  return <div className="adp-notice" style={{marginTop: 40}}><span className="adp-notice__text">{text}</span></div>;
}

/* The no-results state, as the WatchesNoResults board draws it: what found
   nothing, what the search covers, and the way back. */
function NoMatch({what, query, scope, onClear}: {what: string; query: string; scope: string; onClear(): void}){
  return <><div role="status" style={{font: "600 15px/24px var(--font-sans)", color: "var(--ink)"}}>No {what} match “{query}”</div>
    <div style={{color: "var(--dim)"}}>The search covers {scope}.</div>
    <div style={{marginTop: 8}}><button type="button" className="adp-btn adp-btn--text" onClick={onClear}>Clear search</button></div></>;
}

export {Watchboard, Empty, NoMatch};
