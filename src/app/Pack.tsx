/* The Packs drawer: each pack the skill ships, filled from the corpus index
   for the selected ticket, ready to copy into a session. It opens over any
   view from the top bar. */
import {useEffect, useRef, useState} from "react";
import * as S from "../lib/adp-shell-lib.ts";
import type {Advisory} from "../lib/adp-index-builder-lib.ts";
import type {Ticket} from "../lib/adp-index-lib.ts";
import type {Corpus, Pack} from "../lib/adp-shell-lib.ts";

type PackProps = {
  // Null until the pack load answers, and after a load that failed.
  packs: Pack[] | null;
  sel: string | null;
  corpus: Corpus | null;
  today: string;
  t: Ticket | undefined;
  advisories: readonly Advisory[];
  bootNotice: string | null;
  copyLabel: string | null;
  onPick(name: string): void;
  onCopy(text: string): void;
  onClose(): void;
};

// The selected pack is a name, and null means the default: resume-ticket
// when it exists, else the first in the listing.
function packFor(packs: Pack[], sel: string | null): Pack {
  return packs.find(p => p.name === sel) || packs.find(p => p.name === "resume-ticket") || packs[0];
}

const FOCUSABLE = "button:not([disabled]), select, summary, a[href]";

/* The three notices come in order of what is missing: packs, corpus, then
   a ticket to fill from. A corpus-wide pack reads no ticket slot, so it
   fills whether or not a ticket is selected. */
function PackDrawer({packs, sel, corpus, today, t, advisories, bootNotice, copyLabel, onPick, onCopy, onClose}: PackProps){
  const ref = useRef<HTMLElement>(null);
  // The guide's summary is a text button, which hides the browser's own
  // marker, so we draw the system's disclosure glyph from its open state.
  const [guide, setGuide] = useState(false);
  // The drawer is modal, so focus starts inside it and Tab stays inside it.
  // Escape closes it, and the caller hands focus back to the opener.
  useEffect(() => {
    const el = ref.current;
    // Focus lands on the pack picker, the drawer's first choice, or on the
    // first control when there are no packs to pick.
    (el?.querySelector<HTMLElement>("#packSel") || el?.querySelector<HTMLElement>(FOCUSABLE))?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape"){ e.preventDefault(); onClose(); return; }
      if (e.key !== "Tab" || !el) return;
      const all = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const first = all[0], last = all[all.length - 1];
      if (e.shiftKey && document.activeElement === first){ e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last){ e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onClose]);

  const pack = packs && packs.length ? packFor(packs, sel) : null;
  let notice: string | null = null, text = "";
  if (!packs || !packs.length) notice = packs
    ? "the packs directory is empty — drop a .pack.md file into the skill's packs/ directory and reload."
    : "no packs behind this page — packs load from the skill's packs/ directory through the mission control server; a page opened over file:// or with no server has none.";
  else if (!corpus) notice = "no corpus behind this page — a pack fills from the served corpus index.";
  else if (!t && S.packReadsTicket(pack!.text)) notice = bootNotice || "select a ticket from the rail to fill this pack.";
  else text = S.fillPack(pack!.text, S.packContext(corpus.index, t || null, today, advisories));
  const forTicket = pack && t && S.packReadsTicket(pack.text) ? t.id || t.dir : null;

  return <div style={{position: "fixed", inset: 0, zIndex: 20}}>
    <div className="adp-scrim" onClick={onClose}></div>
    <section ref={ref} className="adp-drawer" id="packDrawer" role="dialog" aria-modal="true" aria-labelledby="packTitle"
      style={{position: "absolute", top: 0, right: 0, bottom: 0}}>
      <div className="adp-drawer__head">
        <h2 className="adp-drawer__title" id="packTitle">Packs</h2>
        <div className="adp-drawer__sub">Paste into your next session</div>
        <button type="button" className="adp-btn adp-btn--icon adp-drawer__close" aria-label="Close packs" onClick={onClose}>×</button>
      </div>
      {/* The pack text takes the drawer's spare height and scrolls inside
          itself, so the copy row stays in view. With the guide open the text
          keeps a floor and the body scrolls instead. */}
      <div className="adp-drawer__body" style={{flex: "1 1 auto", minHeight: 0, overflowY: "auto"}}>
        {pack ? <div style={{display: "flex", alignItems: "flex-end", gap: 12, flexWrap: "wrap"}}>
          <label className="adp-field" style={{flex: "1 1 240px"}}>Pack
            <select className="adp-select" id="packSel" value={pack.name} onChange={e => onPick(e.target.value)}>
              {packs!.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
            </select>
          </label>
          {forTicket ? <span className="adp-meta" style={{lineHeight: "36px"}}>for {forTicket}</span> : null}
        </div> : null}
        {notice ? <div className="adp-notice"><span className="adp-notice__text">{notice}</span></div>
          : <pre className="adp-pre" id="packText" style={{flex: "1 1 0px", minHeight: 160}}>{text}</pre>}
        {pack ? <div style={{display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap"}}>
          {notice ? null : <>
            <button type="button" className="adp-btn adp-btn--primary" data-op="copypack" onClick={() => onCopy(text)}>{copyLabel || "Copy pack"}</button>
            <span className="adp-meta">Same index, same bytes</span>
          </>}
          <span id="packSrc" style={{marginLeft: "auto", font: "400 11.5px/20px var(--font-mono)", color: "var(--faint)"}}>{pack.file}</span>
        </div> : null}
        {pack ? <details style={{boxShadow: "inset 0 1px 0 var(--line)", paddingTop: 16}} onToggle={e => setGuide((e.currentTarget as HTMLDetailsElement).open)}>
          <summary className="adp-btn adp-btn--text"><span aria-hidden="true">{guide ? "▾" : "▸"}</span>Write your own pack</summary>
          <div className="adp-prose" style={{marginTop: 16}}>
            <p>Drop a <code>.pack.md</code> file into the skill's <code>packs/</code> directory and reload: it appears here. A pack is plain
              text plus three constructs, filled from the ticket index: <code>{"{{path}}"}</code> inserts one value, <code>{"{{#name}}…{{/name}}"}</code> repeats
              its body for each item of a list, or once when name holds a present value, and <code>{"{{^name}}…{{/name}}"}</code> renders its body only when
              the list is empty or the value is missing. Nothing else is interpreted: a missing value renders empty, and the same index fills the same bytes.</p>
            <h3>slots used by this pack</h3>
            <p id="packSlots" style={{fontFamily: "var(--font-mono)", fontSize: 13}}>{S.packSlots(pack.text).join("  ")}</p>
          </div>
        </details> : null}
      </div>
    </section>
  </div>;
}

export {PackDrawer, packFor};
