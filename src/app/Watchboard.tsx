import {Fragment, type KeyboardEvent, type MouseEvent} from "react";
import * as D from "../lib/adp-derive-lib.ts";
import * as S from "../lib/adp-shell-lib.ts";
import type {DueState, WatchCounts} from "../lib/adp-derive-lib.ts";
import type {Corpus, SortState} from "../lib/adp-shell-lib.ts";

const WATCH_STATES: DueState[] = ["overdue", "soon", "upcoming", "unanchored", "closed"];

type ThProps = {sort: SortState; t: string; k: string; label: string; onSort(k: string): void};

/* A sortable column header. A th turns neither Enter nor Space into a click
   the way a button does, so the key handler fires the same sort the click
   does. aria-sort sits on the one sorted header, and the arrow repeats it for
   the eye, so the arrow stays out of the accessibility tree. */
function Th({sort, t, k, label, onSort}: ThProps){
  const on = sort.k === k;
  const key = (e: KeyboardEvent) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    onSort(k);
  };
  return <th className="sth" scope="col" tabIndex={0} data-t={t} data-k={k}
    aria-sort={on ? (sort.d > 0 ? "ascending" : "descending") : undefined}
    onClick={() => onSort(k)} onKeyDown={key}>
    {label}{on ? <span className="arr" aria-hidden="true">{sort.d > 0 ? "▲" : "▼"}</span> : null}
  </th>;
}

type WatchboardProps = {
  corpus: Corpus | null;
  today: string;
  sort: SortState;
  show: ReadonlySet<DueState>;
  onSort(k: string): void;
  onToggleState(s: DueState): void;
  onOpen(tid: string, wid: string | null): void;
};

/* The corpus-wide watch table, the app's one watch surface. Settled rows sit
   behind the closed chip with the outcome the closure ledger recorded. The
   links carry real deep-link hrefs so the keyboard can reach them, and a
   click routes in the app instead of jumping the hash. */
function Watchboard({corpus, today, sort, show, onSort, onToggleState, onOpen}: WatchboardProps){
  const head = <h2>watchboard <span className="isub">overdue first · unanchored flagged, never dated · settled behind its chip</span></h2>;
  if (!corpus) return <>{head}<div className="ipanel"><p className="dnotice">no corpus behind this page — the watchboard reads the served corpus index.</p></div></>;
  const wb = D.watchboardRows(corpus.index.tickets, today);
  const rows = D.sortRows(wb.rows.filter(r => show.has(r.state)), sort.k, sort.d, {
    tid: r => r.tid, wid: r => r.wid, what: r => r.what,
    due: r => r.order, state: r => r.order,
    outcome: r => r.outcome ? r.outcome + " " + r.closed : ""
  });
  const go = (tid: string, wid: string | null) => (e: MouseEvent) => { e.preventDefault(); onOpen(tid, wid); };
  const counts: WatchCounts = wb.counts;
  const pills = WATCH_STATES.filter(s => counts[s]).map((s, i) => <Fragment key={s}>{i ? " " : null}<button type="button"
    className={"fpill" + (show.has(s) ? " is-on" : "")} data-ws={s} onClick={() => onToggleState(s)}>{s} {counts[s]}</button></Fragment>);
  const panelHead = <h2>every watch, corpus-wide <span className="hsub">{wb.rows.length - counts.closed} live · {counts.closed} settled · {pills}</span></h2>;
  // An empty table has two truths: filters that hide real rows, and a corpus
  // that never opened a watch. We say which one is happening.
  if (!rows.length) return <>{head}<div className="ipanel">{panelHead}<p className="dnotice">{wb.rows.length
    ? "every watch here is hidden by the status filters."
    : "no watches on record yet — no ticket in this corpus has opened an obligation table."}</p></div></>;
  const th = (k: string, label: string) => <Th sort={sort} t="wb" k={k} label={label} onSort={onSort}/>;
  return <>{head}<div className="ipanel">{panelHead}<div className="tblwrap"><table><tbody>
    <tr>{th("tid", "ticket")}{th("wid", "watch")}{th("what", "what to check")}{th("due", "due")}{th("state", "status")}{th("outcome", "outcome")}</tr>
    {rows.map(r => <tr className="wbrow" data-wid={r.wid} key={r.dir + "\n" + r.wid}>
      <td><a className="wbl" href={S.hashWrite({t: r.tid})} data-t={r.tid} onClick={go(r.tid, null)}>{r.tid}</a></td>
      <td><a className="wbl" href={S.hashWrite({t: r.tid, item: r.wid})} data-t={r.tid} data-item={r.wid} onClick={go(r.tid, r.wid)}>{r.wid}</a></td>
      <td>{r.what}</td>
      {/* An unanchored row shows its window prose where a date would sit, so the flag explains itself. */}
      <td className={"mono" + (r.anchored ? " nw" : "")}>{r.anchored ? r.due : (r.window || "relative")}</td>
      <td><span className={"st-" + r.state + " nw"}>{r.label}</span></td>
      <td>{r.closed ? <span className={"st-" + D.statusKind(r.outcome) + " nw"}>{r.outcome + " " + r.closed}</span> : "—"}</td>
    </tr>)}
  </tbody></table></div></div></>;
}

export {Watchboard, Th};
