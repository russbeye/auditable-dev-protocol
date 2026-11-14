/* The corpus-wide record: the assumption ledger and the calibration that
   heads it. Both read the corpus index only, and every number is the derive
   library's, so the two cannot disagree about an entry. */
import {Fragment, useState, type MouseEvent, type ReactNode} from "react";
import * as D from "../lib/adp-derive-lib.ts";
import * as P from "../lib/adp-parser-lib.ts";
import * as S from "../lib/adp-shell-lib.ts";
import type {Corpus, SortState} from "../lib/adp-shell-lib.ts";
import {Coded, Filters, NW, PAGE_HEAD, PAGE_ROWS, PAGE_SUB, PAGE_TITLE, SEARCH, ShowMore, StatusChip, Th, WatchCell, liveFilter, matches} from "./panels.tsx";
import {Empty, NoMatch} from "./Watchboard.tsx";
import {SELECT} from "./Inspector.tsx";

// Every kind either classifier can return, so no entry is unreachable by a
// filter. The status filters read in the Ledger board's order.
const LG_STATUS_KEYS = ["all", "open", "validated", "invalidated", "unknown", "other"];
const LG_CONF_KEYS = ["all", ...D.CONF_KINDS];
const CONF_RANK: Record<string, number> = {high: 3, medium: 2, low: 1};

type LedgersProps = {
  corpus: Corpus | null;
  today: string;
  sort: SortState;
  status: string;
  conf: string;
  calibration: ReactNode;
  // Below 808px the Ledger lists its entries, as the NarrowLedger board draws it.
  narrow: boolean;
  onSort(k: string): void;
  onStatus(f: string): void;
  onConf(f: string): void;
  onOpen(tid: string, item: string | null): void;
};

/* Ledger rows link the way board rows do: real deep-link hrefs, so the
   keyboard can reach them, and a click routes in the app. The Entry cell
   holds two links, as the Ledger board draws it. The ticket lands the
   default view, and the id lands the item in its owning section. */
function Ledgers({corpus, today, sort, status, conf, calibration, narrow, onSort, onStatus, onConf, onOpen}: LedgersProps){
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE_ROWS);
  const title = <h1 style={PAGE_TITLE}>Ledger</h1>;
  if (!corpus) return <>{title}<Empty text="no corpus behind this page — the ledgers read the served corpus index."/></>;
  const lg = D.ledgerRows(corpus.index.tickets, today);
  const found = lg.decisions.filter(r => matches(query, r.tid, r.id, r.title, r.watch));
  // The filters count what the search found, and they cut rows, never
  // counts. Both axes read the classifications the calibration counts by,
  // so a segment click lands exactly the entries its cell counted.
  const tally = (keys: readonly string[], of: (r: typeof lg.decisions[number]) => string) => {
    const c: Record<string, number> = {all: found.length};
    keys.forEach(k => { c[k] = found.filter(r => of(r) === k).length; });
    return c;
  };
  const counts = tally(LG_STATUS_KEYS.slice(1), r => r.kind);
  const confCounts = tally(LG_CONF_KEYS.slice(1), r => P.dlConfKind(r.confidence));
  const st = liveFilter(status, counts), cf = liveFilter(conf, confCounts);
  const shown = found.filter(r => (st === "all" || r.kind === st) && (cf === "all" || P.dlConfKind(r.confidence) === cf));
  const rows = D.sortRows(shown, sort.k, sort.d, {
    tid: r => r.tid, id: r => r.tid + " " + r.id, title: r => r.title,
    conf: r => CONF_RANK[P.dlConfKind(r.confidence)] || 0,
    status: r => r.rank,
    watch: r => r.watch || (r.settled ? r.settled.wid : ""),
    // A dateless card maps to Infinity, so the ascending pass keeps the
    // null-age rows last instead of letting a NaN land them mid-table.
    age: r => r.age == null ? Infinity : r.age
  });
  // The Entry cell dims the entry beside its ticket, as the Ledger board draws it.
  const link = (tid: string, item: string | null, title?: string, dim?: boolean) => <a className="wbl" href={S.hashWrite(item ? {t: tid, item} : {t: tid})}
    data-t={tid} data-item={item || undefined} title={title} style={dim ? {color: "var(--dim)"} : undefined}
    onClick={(e: MouseEvent) => { e.preventDefault(); onOpen(tid, item); }}>{item || tid}</a>;
  const tickets = corpus.index.tickets.length;
  const head = <div style={PAGE_HEAD}>{title}<p style={PAGE_SUB}>{lg.decisions.length} decisions across {tickets} tickets, settled rulings included</p></div>;
  const bar = <div style={{marginTop: 40, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap"}}>
    <input className="adp-input adp-input--sm" type="text" aria-label="Search decisions" placeholder="Search decisions" value={query}
      style={SEARCH} onChange={e => { setQuery(e.target.value); setLimit(PAGE_ROWS); }}
      onKeyDown={e => { if (e.key === "Escape" && query) { e.preventDefault(); setQuery(""); } }}/>
    <Filters label="Status" counts={counts} active={st} mark="data-lgf" keys={LG_STATUS_KEYS} onPick={onStatus}/>
    <label style={{display: "flex", alignItems: "center", gap: 8, font: "400 13px/24px var(--font-sans)", color: "var(--dim)"}}>Confidence
      <select className="adp-select" data-lgc-sel="" value={cf} style={SELECT} onChange={e => onConf(e.target.value)}>
        {LG_CONF_KEYS.filter(k => k === "all" || confCounts[k] || k === cf).map(k => <option key={k} value={k} data-lgc={k}>
          {k === "all" ? "All" : k[0].toUpperCase() + k.slice(1) + " · " + confCounts[k]}</option>)}</select></label>
  </div>;
  const th = (k: string, label: string, num?: boolean) => <Th sort={sort} t="la" k={k} label={label} num={num} onSort={onSort}/>;
  const thead = <thead><tr>{th("id", "Entry")}{th("title", "Decision")}{th("conf", "Conf")}{th("status", "Status")}{th("watch", "Watch")}{th("age", "Age", true)}</tr></thead>;
  const top = <>{head}{calibration}{bar}</>;
  if (!rows.length) return <>{top}<table className="adp-table" style={{marginTop: 16}}>{thead}<tbody><tr><td colSpan={6}>
    {query && !found.length
      ? <NoMatch what="decisions" query={query} scope="entry IDs, tickets, watches and the decision text, across every status" onClear={() => setQuery("")}/>
      : <div role="status">{lg.decisions.length
        ? "nothing under these filters — the pills count what exists."
        : "no decisions on record — no ticket in this corpus has logged an entry."}</div>}
  </td></tr></tbody></table></>;
  const more = <ShowMore shown={Math.min(limit, rows.length)} total={rows.length} onMore={() => setLimit(n => n + PAGE_ROWS)}/>;
  const watch = (d: typeof rows[number]) => <WatchCell d={{watch: d.watch, settled: d.settled, statusKind: d.kind}} link={(wid, title) => link(d.tid, wid, title)}/>;
  /* On a narrow window each entry is a list item of three lines: the entry,
     its confidence, its status, and its age, then the decision, then its
     watch. The table's sort order still holds, and the watch line shows
     only for an entry that has a watch cell to show. */
  if (narrow) return <>{top}<ul style={{margin: "16px 0 0", padding: 0, listStyle: "none", boxShadow: "inset 0 1px 0 var(--line-bright)"}}>
    {rows.slice(0, limit).map(d => {
      const w = watch(d), hasWatch = !!(d.watch || d.settled || d.kind === "open");
      return <li key={d.dir + "\n" + d.id} className="lgrow" data-t={d.tid} data-dl={d.id} style={{padding: "12px 0", boxShadow: "inset 0 -1px 0 var(--line)"}}>
        <div style={{display: "flex", alignItems: "center", gap: 12, minHeight: 24, flexWrap: "wrap"}}>
          <span className="adp-col-id" style={{font: "400 12px/24px var(--font-mono)"}}>{link(d.tid, null)} {link(d.tid, d.id, undefined, true)}</span>
          <span style={{font: "400 11px/24px var(--font-mono)", letterSpacing: ".08em", color: "var(--ink-2)"}}>{P.dlChipSplit(d.confidence).word}</span>
          <StatusChip kind={d.kind}/>
          <span style={{marginLeft: "auto", font: "400 13px/24px var(--font-sans)", color: "var(--dim)"}}>{d.age == null ? "—" : d.age + "d"}</span>
        </div>
        <div style={{font: "400 15px/24px var(--font-sans)"}}><Coded text={d.title}/></div>
        {hasWatch ? <div style={{font: "400 13px/24px var(--font-sans)", color: "var(--dim)"}}>watch <span style={{font: "400 12px/24px var(--font-mono)"}}>{w}</span></div> : null}
      </li>;
    })}</ul>{more}</>;
  return <>{top}<div style={{overflowX: "auto"}}><table className="adp-table" style={{marginTop: 16}}>{thead}<tbody>
    {rows.slice(0, limit).map(d => <tr key={d.dir + "\n" + d.id} className="lgrow" data-t={d.tid} data-dl={d.id}>
      <td className="adp-col-id">{link(d.tid, null)} {link(d.tid, d.id, undefined, true)}</td>
      <td><Coded text={d.title}/></td>
      <td className="adp-col-conf" style={NW}>{P.dlChipSplit(d.confidence).word}</td>
      <td><StatusChip kind={d.kind}/></td>
      <td className="adp-col-id">{watch(d)}</td>
      <td className="adp-col-num">{d.age == null ? "—" : d.age + "d"}</td>
    </tr>)}
  </tbody></table></div>{more}</>;
}

// ---- calibration ----

// Each outcome takes the Calibration component's segment of its meaning.
// The other kind has no segment of its own, so it takes the neutral rule color.
const SEG: Record<string, string> = {validated: "adp-cal__seg--ok", invalidated: "adp-cal__seg--bad", open: "adp-cal__seg--open", unknown: "adp-cal__seg--unk"};
// A tier this small is flagged in the legend, so its share is not read as a firm rate.
const SMALL_TIER = 10;

type CalibrationProps = {corpus: Corpus | null; today: string; narrow: boolean; onCell(conf: string, kind: string): void};

/* Every number in the section is the model's, and this component only
   draws. Each bar is its own tier's total, as the Calibration component
   asks, and its segments split that total by outcome. A segment is a button
   that lands the ledger filtered to its cell. */
function Calibration({corpus, today, narrow, onCell}: CalibrationProps){
  if (!corpus) return null;
  const {tiles, buckets} = D.calibrationModel(corpus.index.tickets, today);
  // The question and its subtitle share one line, as the Ledger board draws them.
  const head = <div style={{display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginBottom: 20}}>
    <h2 style={{margin: 0, font: "600 16px/24px var(--font-sans)", letterSpacing: "normal", textTransform: "none", color: "var(--ink)"}}>Does stated confidence predict outcomes?</h2>
    <span style={{font: "400 14px/24px var(--font-sans)", color: "var(--dim)"}}>Share of ruled decisions that held</span></div>;
  if (!tiles.decisions) return <section className="adp-cal" aria-label="Calibration" style={{marginTop: 40}}>{head}
    <div role="status" style={{color: "var(--dim)"}}>no decisions on record — no ticket in this corpus has logged an entry.</div></section>;
  const small = buckets.filter(b => b.kind !== "other" && b.total && b.total < SMALL_TIER);
  return <section className="adp-cal" aria-label="Calibration" style={{marginTop: 40}}>{head}
    {/* A narrow window drops the count column and sets each count line
        under its bar, as the NarrowLedger board draws it. */}
    <div className="adp-cal__grid" style={narrow ? {gridTemplateColumns: "64px minmax(0, 1fr) 56px"} : undefined}>{buckets.map(b => {
      // The other bucket has no word of its own, so it names the tokens it met.
      const label = b.kind === "other" ? b.tokens.join(", ") : b.kind.toUpperCase();
      const kinds = D.STATUS_KINDS.filter(k => b.counts[k]);
      return <div key={b.kind} data-conf={b.kind} style={{display: "contents"}}>
        <span className="adp-cal__tier">{label}</span>
        <div className="adp-cal__bar">
          {/* The name carries the count, so a screen reader hears what a sighted reader infers from the segment's length. */}
          {kinds.map(k => {
            const name = `${b.counts[k]} ${k} at ${label} — open in the ledger`;
            return <button key={k} type="button" className={SEG[k] || ""} style={{flex: b.counts[k], minWidth: 4, height: 12, border: 0, padding: 0,
              cursor: "pointer", ...(SEG[k] ? null : {background: "var(--line-bright)"})}}
              data-calc={b.kind} data-calk={k} title={name} aria-label={name} onClick={() => onCell(b.kind, k)}></button>;
          })}
        </div>
        <span className="adp-cal__pct">{b.ruled.ruled ? Math.round(b.ruled.validated / b.ruled.ruled * 100) + "%" : "—"}</span>
        {/* The separator rides inside the span that follows it, so a wrapped count line breaks between whole counts. */}
        <span className="adp-cal__count" style={narrow ? {gridColumn: "2 / -1", marginTop: -12} : undefined}>{kinds.length ? kinds.map((k, i) => <Fragment key={k}>{i ? " " : null}<span style={NW}>{(i ? "· " : "") + b.counts[k] + " " + k}</span></Fragment>) : "—"}
          <br/>{b.ruled.ruled ? `${b.ruled.validated} of ${b.ruled.ruled} ruled validated` : "none ruled yet"}</span>
      </div>;
    })}</div>
    <div className="adp-cal__legend">{D.STATUS_KINDS.map(k => <span key={k}><i className={SEG[k]} style={SEG[k] ? undefined : {background: "var(--line-bright)"}}></i>{k[0].toUpperCase() + k.slice(1)}</span>)}
      <span>Bars are each tier’s own total{small.map(b => ` · ${b.kind.toUpperCase()} has only ${b.total} decisions`).join("")}</span></div>
  </section>;
}

export {Ledgers, Calibration};
