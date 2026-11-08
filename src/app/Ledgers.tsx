/* The corpus-wide record: the assumption ledger and the calibration
   screen. Both read the corpus index only, and every number is the derive
   library's, so the two screens cannot disagree about an entry. */
import {Fragment, type MouseEvent} from "react";
import * as D from "../lib/adp-derive-lib.ts";
import * as P from "../lib/adp-parser-lib.ts";
import * as S from "../lib/adp-shell-lib.ts";
import type {CalibrationTiles} from "../lib/adp-derive-lib.ts";
import type {Corpus, SortState} from "../lib/adp-shell-lib.ts";
import {PillGroup, Pills, WatchCell} from "./panels.tsx";
import {Th} from "./Watchboard.tsx";

// Every kind either classifier can return, so no entry is unreachable by pill.
const LG_STATUS_KEYS = ["all", ...D.STATUS_KINDS];
const LG_CONF_KEYS = ["all", ...D.CONF_KINDS];
const CONF_RANK: Record<string, number> = {high: 3, medium: 2, low: 1};

type LedgersProps = {
  corpus: Corpus | null;
  today: string;
  sort: SortState;
  status: string;
  conf: string;
  onSort(k: string): void;
  onStatus(f: string): void;
  onConf(f: string): void;
  onOpen(tid: string, item: string | null): void;
};

/* Ledger rows link the way board rows do: real deep-link hrefs, so the
   keyboard can reach them, and a click routes in the app. The ticket cell
   lands the default view and the id cell lands the item in its owning
   section. */
function Ledgers({corpus, today, sort, status, conf, onSort, onStatus, onConf, onOpen}: LedgersProps){
  const head = <h2>ledgers <span className="isub">the corpus's decision record · settled rulings included · watches live on the board</span></h2>;
  if (!corpus) return <>{head}<div className="ipanel"><p className="dnotice">no corpus behind this page — the ledgers read the served corpus index.</p></div></>;
  const lg = D.ledgerRows(corpus.index.tickets, today);
  // The pills count the whole record, and the filters cut rows, never
  // counts. Both axes read the classifications the calibration screen
  // counts by, so a segment click lands exactly the entries its cell counted.
  const tally = (keys: readonly string[], of: (r: typeof lg.decisions[number]) => string) => {
    const c: Record<string, number> = {all: lg.decisions.length};
    keys.forEach(k => { c[k] = lg.decisions.filter(r => of(r) === k).length; });
    return c;
  };
  const counts = tally(LG_STATUS_KEYS.slice(1), r => r.kind);
  const confCounts = tally(LG_CONF_KEYS.slice(1), r => P.dlConfKind(r.confidence));
  const shown = lg.decisions.filter(r => (status === "all" || r.kind === status) && (conf === "all" || P.dlConfKind(r.confidence) === conf));
  const rows = D.sortRows(shown, sort.k, sort.d, {
    tid: r => r.tid, id: r => r.id, title: r => r.title,
    conf: r => CONF_RANK[P.dlConfKind(r.confidence)] || 0,
    status: r => r.rank,
    watch: r => r.watch || (r.settled ? r.settled.wid : ""),
    // A dateless card maps to Infinity, so the ascending pass keeps the
    // null-age rows last instead of letting a NaN land them mid-table.
    age: r => r.age == null ? Infinity : r.age
  });
  const link = (tid: string, item: string | null, title?: string) => <a className="wbl" href={S.hashWrite(item ? {t: tid, item} : {t: tid})}
    data-t={tid} data-item={item || undefined} title={title}
    onClick={(e: MouseEvent) => { e.preventDefault(); onOpen(tid, item); }}>{item || tid}</a>;
  const panelHead = <h2>assumptions <span className="hsub">
    <PillGroup label="status"><Pills counts={counts} active={status} mark="data-lgf" keys={LG_STATUS_KEYS} onPick={onStatus}/></PillGroup>
    <PillGroup label="confidence"><Pills counts={confCounts} active={conf} mark="data-lgc" keys={LG_CONF_KEYS} onPick={onConf}/></PillGroup>
  </span></h2>;
  if (!rows.length) return <>{head}<div className="ipanel">{panelHead}<p className="dnotice">{counts.all
    ? "nothing under these filters — the pills count what exists."
    : "no decisions on record — no ticket in this corpus has logged an entry."}</p></div></>;
  const th = (k: string, label: string) => <Th sort={sort} t="la" k={k} label={label} onSort={onSort}/>;
  return <>{head}<div className="ipanel">{panelHead}<div className="tblwrap"><table><tbody>
    <tr>{th("tid", "ticket")}{th("id", "entry")}{th("title", "decision")}{th("conf", "conf")}{th("status", "status")}{th("watch", "watch")}{th("age", "age")}</tr>
    {rows.map(d => <tr key={d.dir + "\n" + d.id} className="lgrow" data-t={d.tid} data-dl={d.id}>
      <td>{link(d.tid, null)}</td>
      <td className="mono nw">{link(d.tid, d.id)}</td>
      <td>{d.title}</td>
      <td><span className={"cf-" + P.dlConfKind(d.confidence) + " nw"}>{P.dlChipSplit(d.confidence).word}</span></td>
      <td><span className={"st-" + d.kind + " nw"}>{d.kind}</span></td>
      <td><WatchCell d={{watch: d.watch, settled: d.settled, statusKind: d.kind}} link={(wid, title) => link(d.tid, wid, title)}/></td>
      <td className="mono nw">{d.age == null ? "—" : d.age + "d"}</td>
    </tr>)}
  </tbody></table></div></div></>;
}

// ---- calibration ----

const CAL_TILES: [keyof CalibrationTiles | "watches", string][] = [["tickets", "tickets indexed"], ["shipped", "shipped or closed"],
  ["decisions", "decisions logged"], ["watches", "watches overdue + unanchored"]];

type CalibrationProps = {corpus: Corpus | null; today: string; onCell(conf: string, kind: string): void};

/* Every number on the screen is the model's, and this component only
   draws. A bar's length is its bucket's share of the largest bucket, and
   its segments split that length by outcome, so a bar reads against the
   corpus and not against its own row. */
function Calibration({corpus, today, onCell}: CalibrationProps){
  const head = <h2>calibration <span className="isub">does stated confidence predict outcomes</span></h2>;
  if (!corpus) return <>{head}<div className="ipanel"><p className="dnotice">no corpus behind this page — calibration reads the served corpus index.</p></div></>;
  const notice = "no decisions on record — no ticket in this corpus has logged an entry.";
  const {tiles, buckets} = D.calibrationModel(corpus.index.tickets, today);
  const tileText = (k: keyof CalibrationTiles | "watches") => k === "watches" ? `${tiles.overdue}+${tiles.unanchored}` : String(tiles[k]);
  const tilesEl = <div className="caltiles">{CAL_TILES.map(([k, label]) => <div key={k} className="caltile" data-tile={k}>
    <div className="caltile-n">{tileText(k)}</div><div className="caltile-l">{label}</div></div>)}</div>;
  const panelHead = <h2>decision outcomes by stated confidence</h2>;
  if (!tiles.decisions) return <>{head}{tilesEl}<div className="ipanel">{panelHead}<p className="dnotice">{notice}</p></div></>;
  const maxN = Math.max(...buckets.map(b => b.total), 1);
  return <>{head}{tilesEl}<div className="ipanel">{panelHead}
    {buckets.map(b => {
      // The other bucket has no word of its own, so it names the tokens it met.
      const label = b.kind === "other" ? b.tokens.join(", ") : b.kind.toUpperCase();
      const kinds = D.STATUS_KINDS.filter(k => b.counts[k]);
      return <div key={b.kind} className="calrow" data-conf={b.kind}>
        <span className="callab"><span className={"cf-" + b.kind}>{label}</span></span>
        <div className="calbar" style={{width: Math.round(b.total / maxN * 1000) / 10 + "%"}}>
          {/* A segment is a button that lands the ledger filtered to its
              cell. The name carries the count, so a screen reader hears what
              a sighted reader infers from the bar's length. */}
          {kinds.map(k => {
            const name = `${b.counts[k]} ${k} at ${label} — open in the ledger`;
            return <button key={k} type="button" className={"calseg calseg-" + k} style={{flex: b.counts[k]}}
              data-calc={b.kind} data-calk={k} title={name} aria-label={name} onClick={() => onCell(b.kind, k)}></button>;
          })}
        </div>
        {/* The separator rides inside the span that follows it, so a wrapped
            count string breaks between whole counts and never ends in a dot. */}
        <span className="calcnt">{kinds.length ? kinds.map((k, i) => <Fragment key={k}>{i ? " " : null}<span className="calnw">{(i ? "· " : "") + b.counts[k] + " " + k}</span></Fragment>) : "—"}
          <br/><span className="calshare">{b.ruled.ruled ? `${b.ruled.validated} of ${b.ruled.ruled} ruled validated` : "none ruled yet"}</span></span>
      </div>;
    })}
    <div className="callegend">{D.STATUS_KINDS.map(k => <span key={k}><i className={"calseg-" + k}></i>{k}</span>)}</div>
  </div></>;
}

export {Ledgers, Calibration};
