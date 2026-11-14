/* The reviews screen: a ticket's prreview rounds, read from the served
   corpus, one round at a time with its head, its body, and the decisions
   and watches it cites. */
import {Fragment, useEffect, useState, type CSSProperties, type ReactNode} from "react";
import * as D from "../lib/adp-derive-lib.ts";
import * as P from "../lib/adp-parser-lib.ts";
import * as S from "../lib/adp-shell-lib.ts";
import type {Ticket} from "../lib/adp-index-lib.ts";
import type {DLEntry} from "../lib/adp-parser-lib.ts";
import type {Corpus, ReviewGroup, ReviewLedger, ReviewVerdictFields, SortState} from "../lib/adp-shell-lib.ts";
import {FILL, Html, Notice, PANE, P_GRID, P_K, P_V, Permalink, RoundLink, SECTION_HEAD, decisionRows, filterCounts, revTok, typing,
  watchRows} from "./Inspector.tsx";
import {DecisionsPanel, Pills, WatchesPanel, type PanelActions} from "./panels.tsx";

/* Where the screen's round selection lands: the named round when the ticket
   holds it, else the latest round with a notice when a round was named. The
   latest round is the highest k, because prreview numbers rounds across the
   whole directory. */
function resolveRound(groups: ReviewGroup[], file: string | null): {gi: number; ri: number; notice: string | null} | null {
  if (!groups.length) return null;
  for (let gi = 0; gi < groups.length; gi++){
    const ri = groups[gi].rounds.findIndex(r => r.file === file);
    if (ri >= 0) return {gi, ri, notice: null};
  }
  let best = {gi: 0, ri: 0, k: -1};
  groups.forEach((g, gi) => g.rounds.forEach((r, ri) => { if (r.k > best.k) best = {gi, ri, k: r.k}; }));
  return {gi: best.gi, ri: best.ri, notice: file ? `round "${file}" was not found in this ticket. The screen shows the latest round.` : null};
}

function groupsOf(corpus: Corpus | null, t: Ticket | undefined): ReviewGroup[] {
  return t && corpus && corpus.reviews ? S.reviewRounds(corpus.reviews[t.dir]) : [];
}

// ---- the round body ----

/* A round reads on the design system, the way a ticket's log does. A
   severity and a confidence are attributes, so each is a neutral Tag. A
   status is a StatusChip of its meaning, and a ledger closure shows its
   outcome: RESOLVED as validated, ACCEPTED as unknown, and REFUTED as the
   neutral closed chip. */
const {SEVERITY_PILL} = S;
const OUTCOME_CHIP: Record<string, string> = {RESOLVED: " adp-chip--validated", ACCEPTED: " adp-chip--unknown", REFUTED: " adp-chip--closed"};
const STATUS_CHIP: Record<string, string> = {invalidated: " adp-chip--invalidated", validated: " adp-chip--validated",
  open: " adp-chip--open", unknown: " adp-chip--unknown", other: ""};
const Chip = ({kind, word, mod = "", small}: {kind: string; word: string; mod?: string; small?: boolean}) =>
  <span className={"adp-chip" + (small ? " adp-chip--s" : "") + mod} title={kind}>{word}</span>;
const revText = (v: string) => P.decorateDS(v);
// A field row in a card's body: the label above its value.
const RevRow = ({label, text, children}: {label: string; text?: string; children?: ReactNode}) =>
  <div><dt>{label}</dt>{text != null ? <Html as="dd" html={revText(text)}/> : <dd>{children}</dd>}</div>;
const RevText = ({v}: {v: string}) => <Html html={revText(v)}/>;
// A row in a label and value grid, as the prompt view draws one.
const GridRow = ({label, text, children}: {label: string; text?: string; children?: ReactNode}) =>
  <><div data-rev="k" style={P_K}>{label}</div>
    {text != null ? <Html as="div" style={P_V} html={revText(text)}/> : <div style={P_V}>{children}</div>}</>;

type BodyCtx = {ledger: ReviewLedger; tok: string; onRound(tok: string, file: string): void};

/* A finding card is the design system's DecisionCard. The severity, the
   confidence, and the status move into the head, and every other field keeps
   its row. The status shows the ledger's closure when one exists, and the
   card's written Status only when no later round closed the finding. The
   first card of a round starts open and the rest start folded, as in a log. */
function FindingCard({entry, ctx, first}: {entry: DLEntry; ctx: BodyCtx; first: boolean}){
  const [open, setOpen] = useState(first);
  const hm = entry.head.match(/^\[([^\]]+)\]\s*([\s\S]*)$/);
  const id = hm ? hm[1].trim() : "", title = hm ? hm[2].trim() : entry.head;
  const split = P.dlSplitBody(entry.lines);
  let sev = "", conf = "", status = "";
  const rows: ReactNode[] = [];
  const row = (label: string, text: string) => rows.push(<RevRow key={rows.length} label={label} text={text}/>);
  for (const f of P.parseDLFields(split.fieldLines)){
    const k = f.label.toLowerCase();
    if (k === "severity") sev = f.value;
    else if (k === "confidence") conf = f.value;
    else if (k === "status") status = f.value;
    else row(f.label, f.value);
  }
  const tags: ReactNode[] = [];
  if (sev){
    const s = P.dlChipSplit(sev);
    const note = Object.hasOwn(SEVERITY_PILL, s.word.toLowerCase()) ? s.tail : s.tail ? sev.trim() : "";
    tags.push(<Chip key="sev" kind="severity" word={s.word}/>);
    if (note) row("severity note", note);
  }
  if (conf){
    const c = P.dlConfPill(conf);
    tags.push(<Chip key="conf" kind="confidence" word={P.dlChipSplit(conf).word}/>);
    if (c.note) row("confidence note", c.note);
  }
  let chip: ReactNode = null, settled = false;
  const closed = id && ctx.ledger[id];
  if (closed){
    chip = <Chip kind="status" word={closed.outcome} mod={OUTCOME_CHIP[closed.outcome] ?? ""}/>;
    settled = true;
    rows.push(<RevRow key={rows.length} label="closed">{closed.date} in <RoundLink tok={ctx.tok} file={closed.file}
      label={"round " + closed.k} onRound={ctx.onRound}/>{closed.note ? <>{" · "}<RevText v={closed.note}/></> : null}</RevRow>);
  } else if (status){
    const kind = P.dlStatusKind(status), st = P.dlStatusPill(status);
    chip = <Chip kind="status" word={P.dlChipSplit(status).word} mod={STATUS_CHIP[kind]}/>;
    settled = kind === "validated" || kind === "invalidated" || kind === "unknown";
    if (st.note) row("status note", st.note);
  }
  const shut: CSSProperties | undefined = open ? undefined : {display: "none"};
  return <div className={"adp-dl" + (settled ? " adp-dl--settled" : "")} data-card={id}>
    <button type="button" className="adp-dl__head" aria-expanded={open} onClick={() => setOpen(o => !o)}>
      <span className="adp-dl__id">{id || "—"}</span><Html as="span" className="adp-dl__title" html={revText(title)}/>
      <span style={{display: "flex", gap: 8}}>{tags}</span><span style={{display: "flex"}}>{chip}</span>
      <span className="adp-dl__caret" aria-hidden="true">{open ? "▾" : "▸"}</span></button>
    {rows.length ? <dl className="adp-dl__body" style={shut}>{rows}</dl> : null}
    {split.trailing ? <Html as="div" className="md adp-prose dl-trail" style={{...FILL, ...shut}} html={P.renderMarkdownDS(split.trailing)}/> : null}
  </div>;
}

// A labelled field list becomes a label and value grid. Any line that is not
// a field sends the section back to markdown, so nothing in it goes missing.
function fieldGrid(lines: string[]): ReactNode | null {
  const split = P.dlSplitBody(lines);
  const fields = P.parseDLFields(split.fieldLines);
  if (!fields.length || split.trailing || fields.some(f => !f.label)) return null;
  return <div style={P_GRID}>{fields.map((f, i) => <GridRow key={i} label={f.label} text={f.value}/>)}</div>;
}

function ledgerGrid(lines: string[]): ReactNode | null {
  const {rows, clean} = S.ledgerRows(lines);
  if (!rows.length || !clean) return null;
  return <div style={P_GRID}>{rows.map((r, i) =>
    <GridRow key={i} label={r.id}><Chip kind="closed" word={r.outcome} mod={OUTCOME_CHIP[r.outcome] ?? ""} small/>
      {" " + r.date}{r.note ? <>{" · "}<RevText v={r.note}/></> : null}</GridRow>)}</div>;
}

// Each section of a round is a pane, as a log section is in the ticket view.
const Panel = ({title, md, children}: {title: string; md?: string; children?: ReactNode}) =>
  <div className="doc" style={PANE}>{title ? <h2 className="adp-section" style={{...SECTION_HEAD, marginBottom: 16}}>{title}</h2> : null}
    {md != null ? <Html as="div" className="md adp-prose" style={FILL} html={P.renderMarkdownDS(md)}/> : <div className="md adp-prose" style={FILL}>{children}</div>}</div>;
const Md = ({text}: {text: string}) => <Html html={P.renderMarkdownDS(text)}/>;

/* The round body renders section by section, one pane each, the way the
   inspector shows a log section. Review Target, Review Verdict, Findings,
   and Prior Findings carry prreview's field grammar, so they become grids
   and cards. Every other section, and any section that breaks the grammar,
   renders as markdown exactly as the file reads. The file's H1 repeats what
   the round head already says, so we drop it. */
function ReviewBody({text, ctx}: {text: string; ctx: BodyCtx}){
  const doc = P.parseSections(text);
  if (doc.front != null) return <div><Panel title="" md={text}/></div>;
  const intro = doc.intro.replace(/^#\s.*\n?/, "").trim();
  return <div>
    {intro ? <Panel title="" md={intro}/> : null}
    {doc.secs.map((sec, i) => {
      const t = sec.title.trim(), body = sec.body.join("\n");
      let part: ReactNode | null = null;
      if (t === "Review Target" || t === "Review Verdict") part = fieldGrid(sec.body);
      else if (t === "Prior Findings") part = ledgerGrid(sec.body);
      else if (t === "Findings"){
        const {pre, entries} = P.parseDLEntries(body);
        if (entries.length) part = <>{pre ? <Md text={pre}/> : null}<div className="adp-dl-list" style={pre ? {marginTop: 16} : undefined}>
          {entries.map((e, j) => <FindingCard key={j} entry={e} ctx={ctx} first={j === 0}/>)}</div></>;
      }
      return part != null ? <Panel key={i} title={t}>{part}</Panel> : <Panel key={i} title={t} md={body}/>;
    })}
  </div>;
}

// ---- the head ----

// A verdict takes the StatusChip of its meaning, as the StatusChip README
// says: APPROVE as validated and REQUEST CHANGES as invalidated.
const verdictChip = (v: string) => /^APPROVE/i.test(v) ? " adp-chip--validated" : /^REQUEST/i.test(v) ? " adp-chip--invalidated" : "";

function ReviewHead({title, date, fields, notices, prior, dir, onRound}: {title: string; date: string;
  fields: ReviewVerdictFields | null; notices: string[]; prior: (S.ReviewRef & {tok: string})[]; dir: string;
  onRound(tok: string, file: string): void}){
  const f = fields || {};
  return <div style={{margin: "0 0 16px"}}>
    <div style={{display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 8}}>
      <h2 className="adp-section" style={SECTION_HEAD}>{title}</h2>
      <span className="adp-meta">{date}</span>
      {fields && f.verdict ? <Chip kind="verdict" word={f.verdict} mod={verdictChip(f.verdict)}/> : null}
      {fields && f.confidence ? <Chip kind="confidence" word={f.confidence}/> : null}
      <Permalink/>
    </div>
    {notices.map((n, i) => <Notice key={i} text={n}/>)}
    {fields ? <div style={P_GRID}>
      <GridRow label="counts">{f.counts || "—"}</GridRow><GridRow label="opened">{f.opened || "—"}</GridRow>
      <GridRow label="closed">{f.closed || "—"}</GridRow><GridRow label="carried open">{f.carried || "—"}</GridRow></div> : null}
    {prior.length ? <p className="adp-meta" style={{margin: "8px 0 0"}}>earlier rounds: {prior.map((p, i) => <Fragment key={i}>{i ? ", " : null}<RoundLink tok={p.tok}
      file={p.file} label={p.file + (p.dir === dir ? "" : " · " + p.dir)} onRound={onRound}/></Fragment>)}</p> : null}
  </div>;
}

// ---- the screen ----

type ReviewsActions = PanelActions & {
  onRound(tok: string, file: string): void;
  onPick(file: string): void;
  onPr(pr: string): void;
  onFilter(f: string): void;
  // Goes back to the ticket view of the ticket on show.
  onTicket(): void;
};
type ReviewsProps = {
  corpus: Corpus | null;
  today: string;
  t: Ticket | undefined;
  tokenOf(t: Pick<Ticket, "dir">): string;
  round: string | null;
  notice: string | null;
  dlFilter: string;
  decSort: SortState;
  iwSort: SortState;
  // False while a modal holds the page, so ← leaves the screen alone.
  arrows: boolean;
  act: ReviewsActions;
};

function Reviews({corpus, today, t, tokenOf, round, notice, dlFilter, decSort, iwSort, arrows, act}: ReviewsProps){
  // The reviews box is the last stop of the ticket's phase strip, so ←
  // steps back from it into the ticket view.
  useEffect(() => {
    if (!arrows || !t) return;
    const key = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || typing(e.target)) return;
      e.preventDefault();
      act.onTicket();
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [arrows, t, act.onTicket]);
  // A ticket's reviews open from its phase strip, so the screen leads with
  // the way back to that ticket.
  const top = (sub: string | null) => <>
    {t ? <button type="button" className="adp-btn adp-btn--text" data-op="toticket" style={{marginBottom: 8}}
      onClick={act.onTicket}>‹ Back to {t.id || t.dir}</button> : null}
    <h2 className="adp-section" style={{...SECTION_HEAD, marginBottom: 12}}>reviews{sub ? <>{" "}<span className="adp-meta">{sub}</span></> : null}</h2></>;
  // The four regions keep the vanilla page's ids.
  const regions = (topEl: ReactNode, nav: ReactNode, head: ReactNode, body: ReactNode) =>
    <><div id="revTop">{topEl}</div><div id="revNav">{nav}</div><div id="revHead">{head}</div><div id="revBody">{body}</div></>;
  const empty = (sub: string | null, text: string) => regions(top(sub), null, null, <div className="ipanel">
    {notice ? <Notice text={notice}/> : null}<Notice text={text}/></div>);
  if (!t) return empty(null, corpus ? "select a ticket from the rail to read its review rounds."
    : "no corpus behind this page. The reviews screen reads review files from the served corpus.");
  const groups = groupsOf(corpus, t);
  const at = resolveRound(groups, round);
  if (!at) return empty(t.dir, "this ticket has no review files. prreview writes pr-review-*.md beside the audit log.");
  const g = groups[at.gi], r = g.rounds[at.ri];
  const notices = notice ? [notice] : [];
  let fields: ReviewVerdictFields | null = null, prior: (S.ReviewRef & {tok: string})[] = [];
  if (r.error != null) notices.push(`${r.file} is listed in the corpus but could not be read.`);
  else {
    const h = S.reviewHead(r.text);
    fields = h.fields;
    if (!fields) notices.push("this round has no Review Verdict section yet. The head shows what the file name carries.");
    else if (h.missing.length) notices.push(`the Review Verdict section lacks ${h.missing.join(", ")}.`);
    prior = S.priorReviews(r.text, t.dir).map(p => ({...p, tok: revTok(corpus, tokenOf, p.dir)}));
  }
  // The round cites decisions and watches the way a log section does, so
  // it gets the inspector's two panels under the body.
  const title = g.label + " · round " + r.k;
  let panels: ReactNode = null;
  if (r.error == null){
    const items = S.reviewItems(t, r.text);
    const shown = dlFilter === "all" ? items.decisions : items.decisions.filter(d => D.decisionKind(d) === dlFilter);
    panels = <>
      {items.decisions.length ? <DecisionsPanel label={title} sort={decSort} rows={decisionRows(t, shown, decSort, null)}
        pills={<Pills counts={filterCounts(items.decisions)} active={dlFilter} mark="data-rdf" onPick={act.onFilter}/>}
        onSort={act.onSort} onRow={act.onRow} onWatch={act.onWatch} onChip={act.onChip}/> : null}
      {items.watches.length ? <WatchesPanel label={title} sort={iwSort} rows={watchRows(t, items.watches, iwSort, null, today)}
        onSort={act.onSort} onWatch={act.onWatch} onChip={act.onChip}/> : null}
    </>;
  }
  const tok = revTok(corpus, tokenOf, t.dir);
  return regions(top(t.dir),
    <div style={{display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", margin: "0 0 16px"}}>
      {groups.length > 1 ? <select id="revPr" className="adp-select" aria-label="pull request" style={{lineHeight: "normal"}} value={g.pr}
        onChange={e => act.onPr(e.target.value)}>{groups.map(x => <option key={x.pr} value={x.pr}>{x.label}</option>)}</select> : null}
      <button type="button" className="adp-btn" data-revstep="-1" disabled={at.ri <= 0} onClick={() => act.onPick(g.rounds[at.ri - 1].file)}>‹ prev</button>
      <select id="revSel" className="adp-select" aria-label="round" style={{flex: "0 1 440px", minWidth: 220, lineHeight: "normal"}} value={r.file}
        onChange={e => act.onPick(e.target.value)}>
        {g.rounds.map(x => <option key={x.file} value={x.file}>{"round " + x.k + " · " + x.date}</option>)}</select>
      <button type="button" className="adp-btn" data-revstep="1" disabled={at.ri >= g.rounds.length - 1} onClick={() => act.onPick(g.rounds[at.ri + 1].file)}>next ›</button>
    </div>,
    <ReviewHead title={title} date={r.date} fields={fields} notices={notices} prior={prior} dir={t.dir} onRound={act.onRound}/>,
    r.error != null ? null : <><ReviewBody text={String(r.text || "")} ctx={{ledger: S.reviewLedger(g.rounds), tok, onRound: act.onRound}}/>{panels}</>);
}

export {Reviews, ReviewBody, resolveRound, groupsOf};
export type {ReviewsActions};
