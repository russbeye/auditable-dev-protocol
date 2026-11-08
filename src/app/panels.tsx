/* The tables and filter pills that more than one screen draws: the
   decisions and watches a section or a review round cites, the coverage
   cell, and the pill rows. Every value is a React text child, so none of
   these pieces handles HTML. */
import {Fragment, type MouseEvent, type ReactNode} from "react";
import type {CitationChip, CoverageRow, DecisionPanelRow, SortState, WatchPanelRow} from "../lib/adp-shell-lib.ts";
import {Th} from "./Watchboard.tsx";

const PILL_KEYS = ["all", "open", "validated", "invalidated"];

type PillsProps = {
  counts: Record<string, number>;
  active: string;
  // The data mark the pills carry, which says which filter a pill belongs to.
  mark: string;
  keys?: readonly string[];
  onPick(key: string): void;
};

/* One filter pill per key that has a count, "all" always. The pills sit
   apart by a space, as the vanilla builder joined them. */
function Pills({counts, active, mark, keys = PILL_KEYS, onPick}: PillsProps){
  return <>{keys.filter(f => f === "all" || counts[f]).map((f, i) => <Fragment key={f}>{i ? " " : null}<button type="button"
    className={"fpill" + (active === f ? " is-on" : "")} {...{[mark]: f}} onClick={() => onPick(f)}>{f} {counts[f]}</button></Fragment>)}</>;
}

// Two pill groups side by side each start with an "all", so a group label
// says which axis the pill filters.
function PillGroup({label, children}: {label: string; children: ReactNode}){
  return <span className="pillgrp"><span className="pilllab">{label}</span> {children}</span>;
}

type WatchLink = (wid: string, title?: string) => ReactNode;

/* A decision's coverage cell, shared by the inspector and the ledger. An
   open decision whose watch has closed is unwatched again, so the marker
   leads. A settled watch keeps its cell to the id, and how coverage ended
   rides the link's hover title. */
function WatchCell({d, link}: {d: CoverageRow; link: WatchLink}){
  if (d.watch) return <>{link(d.watch)}</>;
  const mark = <span className="st-unanchored nw">no watch</span>;
  if (d.settled) return <>{d.statusKind === "open" ? <>{mark}{" "}</> : null}{link(d.settled.wid, "closed " + d.settled.outcome + " " + d.settled.closed)}</>;
  return d.statusKind === "open" ? mark : null;
}

// A click inside a row goes to the control it hit and stops there, so the
// row's own open action does not run as well.
const only = (f: () => void) => (e: MouseEvent) => { e.stopPropagation(); f(); };

function Chips({list, onChip}: {list: CitationChip[]; onChip(key: string): void}){
  return <>{list.map(c => <a key={c.key} className="pc" data-key={c.key} title={c.title} onClick={only(() => onChip(c.key))}>{c.label}</a>)}</>;
}

type PanelActions = {
  onSort(t: string, k: string): void;
  onRow(id: string): void;
  onWatch(wid: string): void;
  onChip(key: string): void;
};

type DecisionsPanelProps = PanelActions & {label: string; sort: SortState; pills: ReactNode; rows: DecisionPanelRow[]};

function DecisionsPanel({label, sort, pills, rows, onSort, onRow, onWatch, onChip}: DecisionsPanelProps){
  const wl = (wid: string, title?: string) => <a className="wl" data-item={wid} title={title} onClick={only(() => onWatch(wid))}>{wid}</a>;
  const th = (k: string, text: string) => <Th sort={sort} t="dec" k={k} label={text} onSort={k => onSort("dec", k)}/>;
  return <div className="ipanel"><h2>decisions cited by {label} <span className="hsub">{pills}</span></h2>
    <div className="tblwrap"><table><tbody>
      <tr>{th("id", "entry")}{th("title", "decision")}{th("conf", "conf")}{th("status", "status")}{th("watch", "watch")}{th("cited", "cited in")}</tr>
      {rows.map(d => <tr key={d.id} className={"dlrow" + (d.hl ? " is-hl" : "")} data-dl={d.id} onClick={() => onRow(d.id)}>
        <td className="mono nw">{d.id}</td><td>{d.title}</td>
        <td><span className={"cf-" + d.confKind + " nw"}>{d.conf}</span></td>
        <td><span className={"st-" + d.statusKind + " nw"}>{d.statusKind}</span></td>
        <td><WatchCell d={d} link={wl}/></td>
        <td><Chips list={d.chips} onChip={onChip}/></td>
      </tr>)}
    </tbody></table></div></div>;
}

type WatchesPanelProps = Omit<PanelActions, "onRow"> & {label: string; sort: SortState; rows: WatchPanelRow[]};

function WatchesPanel({label, sort, rows, onSort, onWatch, onChip}: WatchesPanelProps){
  const th = (k: string, text: string) => <Th sort={sort} t="iw" k={k} label={text} onSort={k => onSort("iw", k)}/>;
  return <div className="ipanel"><h2>watches cited by {label}</h2>
    <div className="tblwrap"><table><tbody>
      <tr>{th("wid", "id")}{th("what", "what to check")}{th("dl", "decisions")}{th("due", "due")}{th("state", "status")}{th("cited", "cited in")}</tr>
      {rows.map(w => <tr key={w.wid} className={"wrow" + (w.hl ? " is-hl" : "")} data-item={w.wid}>
        <td className="mono nw">{w.wid}</td><td>{w.what}</td>
        <td>{w.dls.map((d, i) => <Fragment key={d}>{i ? " " : null}<a className="wl" data-item={d} onClick={only(() => onWatch(d))}>{d}</a></Fragment>)}</td>
        <td className={"mono" + (w.dueDated ? " nw" : "")}>{w.dueText}</td>
        <td><span className={"st-" + w.state + " nw"}>{w.stateLabel}</span></td>
        <td><Chips list={w.chips} onChip={onChip}/></td>
      </tr>)}
    </tbody></table></div></div>;
}

export {Pills, PillGroup, WatchCell, DecisionsPanel, WatchesPanel};
export type {PanelActions};
