/* The resume pack screen: each pack the skill ships, filled from the
   corpus index for the selected ticket, ready to copy into a session. */
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
};

// The selected pack is a name, and null means the default: resume-ticket
// when it exists, else the first in the listing.
function packFor(packs: Pack[], sel: string | null): Pack {
  return packs.find(p => p.name === sel) || packs.find(p => p.name === "resume-ticket") || packs[0];
}

/* The three notices come in order of what is missing: packs, corpus, then
   a ticket to fill from. A corpus-wide pack reads no ticket slot, so it
   fills whether or not a ticket is selected. */
function PackScreen({packs, sel, corpus, today, t, advisories, bootNotice, copyLabel, onPick, onCopy}: PackProps){
  const head = <h2>resume pack <span className="isub">deterministic · copy into your next interactive session</span></h2>;
  if (!packs || !packs.length) return <>{head}<div className="ipanel"><p className="dnotice">{packs
    ? "the packs directory is empty — drop a .pack.md file into the skill's packs/ directory and reload."
    : "no packs behind this page — packs load from the skill's packs/ directory through the mission control server; a page opened over file:// or with no server has none."}</p></div></>;
  const pack = packFor(packs, sel);
  let notice: string | null = null, text = "";
  if (!corpus) notice = "no corpus behind this page — a pack fills from the served corpus index.";
  else if (!t && S.packReadsTicket(pack.text)) notice = bootNotice || "select a ticket from the rail to fill this pack.";
  else text = S.fillPack(pack.text, S.packContext(corpus.index, t || null, today, advisories));
  return <>{head}
    <div className="packrow">{packs.map(p => <button key={p.name} type="button" className={"pk" + (p === pack ? " is-on" : "")}
      data-pk={p.name} onClick={() => onPick(p.name)}>{p.name}</button>)}</div>
    <div className="packsrc">source: {pack.file}</div>
    {notice ? <div className="ipanel"><p className="dnotice">{notice}</p></div>
      : <><pre className="packpre" id="packText">{text}</pre>
        <div className="mops"><button type="button" className="op op-acc" data-op="copypack" onClick={() => onCopy(text)}>{copyLabel || "⧉ copy pack"}</button></div></>}
    <div className="packdocs"><h3>add your own pack</h3>
      <p>Drop a <code>.pack.md</code> file into the skill's <code>packs/</code> directory and reload: it appears here. A pack is plain
        text plus three constructs, filled from the ticket index: <code>{"{{path}}"}</code> inserts one value, <code>{"{{#name}}…{{/name}}"}</code> repeats
        its body for each item of a list, or once when name holds a present value, and <code>{"{{^name}}…{{/name}}"}</code> renders its body only when
        the list is empty or the value is missing. Nothing else is interpreted: a missing value renders empty, and the same index fills the same bytes.</p>
      <h3>slots used by this pack</h3>
      <div className="slotlist">{S.packSlots(pack.text).join("  ")}</div></div>
  </>;
}

export {PackScreen, packFor};
