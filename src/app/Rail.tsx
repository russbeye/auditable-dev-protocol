import {Fragment, useEffect, useRef, type CSSProperties, type RefObject} from "react";
import * as S from "../lib/adp-shell-lib.ts";
import type {RailEntry, RailModelGroup} from "../lib/adp-shell-lib.ts";

type RailProps = {
  groups: RailModelGroup[];
  // Every ticket in the corpus, before the filter takes any out.
  total: number;
  selKey: string | null;
  collapsed: ReadonlySet<string>;
  filter: string;
  // Folded, the rail is a 48px strip. Narrow, an open rail lies over the
  // page and the strip keeps its column.
  folded: boolean;
  narrow: boolean;
  attention: number;
  selId: string | null;
  // A count the page raises when / asks for the filter, so each press moves
  // focus there once.
  focusFilter: number;
  onPick(key: string): void;
  onToggle(name: string): void;
  onFilter(q: string): void;
  onFold(folded: boolean): void;
};

/* The ribbon keeps every reason the rail has always shown. Color marks one
   status only, so a needs-attention row draws its ribbon as the warn flag
   and every other row draws it in dim. */
function Ribbon({ribbon, flag}: Pick<RailEntry, "ribbon"> & {flag: boolean}){
  return <span className={flag ? "adp-rail__flag" : undefined}
    style={{display: "block", marginLeft: 0, font: "400 12px/24px var(--font-sans)", ...(flag ? {} : {color: "var(--dim)"})}}>
    {ribbon.reasons.map((r, i) => <Fragment key={i}>{i ? " · " : null}<span>{r.txt}</span></Fragment>)}
    {ribbon.more ? <> <span style={{color: "var(--faint)"}}>+{ribbon.more}</span></> : null}
  </span>;
}

// A group heading is a button, so the keyboard can fold a group too. The
// closed group sits under a rule, as the Rail component draws it.
const HEAD: CSSProperties = {width: "100%", background: "transparent", border: 0, textAlign: "left", cursor: "pointer"};
const CLOSED_HEAD: CSSProperties = {...HEAD, marginTop: 12, boxShadow: "inset 0 1px 0 var(--line)"};
// The open rail on a narrow window lies over the stage, under a scrim that
// closes it, as the NarrowRailOpen board draws it.
const OVER: CSSProperties = {position: "absolute", top: 0, left: 0, bottom: 0, width: 280, zIndex: 2, overflowY: "auto",
  borderRight: 0, boxShadow: "inset -1px 0 0 var(--line-bright), var(--shadow)"};

function Strip({attention, selId, onFold, stripRef}: Pick<RailProps, "attention" | "selId" | "onFold"> & {stripRef: RefObject<HTMLButtonElement | null>}){
  return <aside className="adp-rail adp-rail--collapsed" id="railStrip" aria-label="Tickets" style={{width: "auto"}}>
    <button type="button" ref={stripRef} className="adp-btn adp-btn--icon" id="railShow" aria-expanded="false" aria-controls="rail"
      aria-label="Show tickets sidebar" title="Show tickets  [" style={{borderColor: "var(--line-bright)"}} onClick={() => onFold(false)}>»</button>
    {attention ? <span className="adp-chip adp-chip--s adp-chip--open"
      aria-label={attention + (attention === 1 ? " ticket needs attention" : " tickets need attention")}>{attention}</span> : null}
    {selId ? <span className="adp-rail__vertical">{selId}</span> : null}
  </aside>;
}

/* The rail lists the corpus tickets by group. Each row is a link to its
   ticket's hash, so hover and the selected ground come from the Rail
   component's own rules, and a click picks the ticket in place. */
function Rail(p: RailProps){
  const stripRef = useRef<HTMLButtonElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);
  const over = p.narrow && !p.folded;
  // An open rail on a narrow window takes the keyboard into its filter, and
  // Escape folds it again and hands focus back to the strip's » button.
  useEffect(() => {
    if (!over) return;
    filterRef.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      p.onFold(true);
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [over, p.onFold]);
  useEffect(() => { if (p.focusFilter) filterRef.current?.focus(); }, [p.focusFilter]);
  // The strip's » button takes focus back once the rail folds over a narrow window.
  const wasOver = useRef(false);
  useEffect(() => {
    if (wasOver.current && !over) stripRef.current?.focus();
    wasOver.current = over;
  }, [over]);

  /* The rail scrolls on its own, and a row runs three lines, so a ticket
     near the rail's foot can sit below its first screen. Whenever the
     selection changes or the rail opens, we scroll the rail, and only the
     rail, by the least amount that shows the selected row. A row the reader
     can already see stays put. */
  const railRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const box = railRef.current;
    const row = box && p.selId ? [...box.querySelectorAll<HTMLElement>("[data-key]")].find(el => el.dataset.key === p.selId) : null;
    if (!box || !row) return;
    const r = row.getBoundingClientRect(), b = box.getBoundingClientRect();
    if (r.top < b.top) box.scrollTop -= b.top - r.top;
    else if (r.bottom > b.bottom) box.scrollTop += r.bottom - b.bottom;
  }, [p.selId, p.folded]);

  const strip = <Strip attention={p.attention} selId={p.selId} onFold={p.onFold} stripRef={stripRef}/>;
  if (p.folded) return strip;
  const shown = p.groups.reduce((n, [, list]) => n + list.length, 0);
  const q = p.filter.trim();
  const rail = <aside ref={railRef} className="adp-rail" id="rail" aria-label="Tickets" style={over ? OVER : {width: "auto", overflowY: "auto"}}>
    <div className="adp-rail__head">
      <span className="adp-label" style={{color: "var(--faint)"}}>{q ? shown + " of " + p.total + " tickets" : p.total + " tickets"}</span>
      <button type="button" className="adp-btn adp-btn--icon" id="railHide" aria-expanded="true" aria-controls="rail"
        aria-label="Hide tickets sidebar" title="Hide tickets  [" onClick={() => p.onFold(true)}>«</button>
    </div>
    <div className="adp-rail__filter">
      <input ref={filterRef} className="adp-input adp-input--sm" id="railFilter" type="text" aria-label="Filter tickets"
        placeholder="Filter tickets" value={p.filter} onChange={e => p.onFilter(e.target.value)}
        onKeyDown={e => { if (e.key === "Escape" && p.filter){ e.preventDefault(); e.stopPropagation(); p.onFilter(""); } }}/>
    </div>
    {q && !shown ? <div role="status" style={{padding: "24px 16px 16px"}}>
      <div style={{font: "400 15px/24px var(--font-sans)", color: "var(--ink-2)"}}>No tickets match “{q}”</div>
      <div style={{marginTop: 4, font: "400 13px/24px var(--font-sans)", color: "var(--dim)"}}>Esc clears the filter.</div>
      <div style={{marginTop: 8}}><button type="button" className="adp-btn adp-btn--text" onClick={() => { p.onFilter(""); filterRef.current?.focus(); }}>Clear filter</button></div>
    </div> : null}
    {p.groups.map(([name, list]) => {
      const closed = p.collapsed.has(name);
      return <Fragment key={name}>
        <button type="button" className="adp-rail__group" data-sec={name} aria-expanded={!closed}
          style={name === "closed" ? CLOSED_HEAD : HEAD} onClick={() => p.onToggle(name)}>
          <span><span aria-hidden="true">{closed ? "▸" : "▾"}</span> <span>{name}</span></span>
          <span data-part="count">{list.length}</span>
        </button>
        {closed ? null : list.map(e => <a key={e.key} className="adp-rail__item" data-key={e.key} href={S.hashWrite({t: e.key})}
          aria-current={e.key === p.selKey ? "true" : undefined} onClick={ev => { ev.preventDefault(); p.onPick(e.key); }}>
          <span className="adp-rail__id">{e.id}{e.date ? <> <span style={{color: "var(--faint)"}}>· {e.date}</span></> : null}</span>
          <span className="adp-rail__slug">{e.slug}</span>
          <Ribbon ribbon={e.ribbon} flag={name === "needs attention"}/>
        </a>)}
      </Fragment>;
    })}
  </aside>;
  return over ? <>{strip}<div className="adp-scrim" style={{zIndex: 1}} onClick={() => p.onFold(true)}></div>{rail}</> : rail;
}

export {Rail};
