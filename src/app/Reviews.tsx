/* The reviews screen: a ticket's prreview rounds, read from the served
   corpus, one round at a time with its head, its body, and the decisions
   and watches it cites. */
import {Fragment, type ReactNode} from "react";
import * as D from "../lib/adp-derive-lib.ts";
import * as P from "../lib/adp-parser-lib.ts";
import * as S from "../lib/adp-shell-lib.ts";
import type {Ticket} from "../lib/adp-index-lib.ts";
import type {DLEntry} from "../lib/adp-parser-lib.ts";
import type {Corpus, ReviewGroup, ReviewLedger, ReviewVerdictFields, SortState} from "../lib/adp-shell-lib.ts";
import {Html, Permalink, RoundLink, decisionRows, filterCounts, revTok, watchRows} from "./Inspector.tsx";
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

const {SEVERITY_PILL, OUTCOME_PILL} = S;

const RevPill = ({kind, cls, word}: {kind: string; cls: string; word: string}) =>
  <span className={"pill dl-pill " + cls}><i>{kind}</i>{word}</span>;
const revText = (v: string) => P.decorate(P.inline(v));
// A field whose whole value is author text renders the parser's markup as
// the value cell itself. A value that mixes our links or pills with author
// text holds the text in a contents span.
const RevRow = ({label, text, children}: {label: string; text?: string; children?: ReactNode}) =>
  <div className="dl-row"><span className="dl-k revk">{label}</span>
    {text != null ? <Html as="span" className="dl-v revv" html={revText(text)}/> : <span className="dl-v revv">{children}</span>}</div>;
const RevText = ({v}: {v: string}) => <Html html={revText(v)}/>;

type BodyCtx = {ledger: ReviewLedger; tok: string; onRound(tok: string, file: string): void};

/* A finding card follows the Decision Log card. The severity, confidence,
   and status move into the head as pills, and every other field keeps its
   row. The status pill shows the ledger's closure when one exists, and the
   card's written Status only when no later round closed the finding. */
function FindingCard({entry, ctx}: {entry: DLEntry; ctx: BodyCtx}){
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
  const pills: ReactNode[] = [];
  let rail = "";
  if (sev){
    const s = P.dlChipSplit(sev), cls = Object.hasOwn(SEVERITY_PILL, s.word.toLowerCase()) ? SEVERITY_PILL[s.word.toLowerCase()] : "";
    const note = cls ? s.tail : s.tail ? sev.trim() : "";
    pills.push(<RevPill key="sev" kind="severity" cls={cls || "p-low"} word={s.word}/>);
    if (note) row("severity note", note);
  }
  if (conf){
    const c = P.dlConfPill(conf);
    pills.push(<Html key="conf" html={c.html}/>);
    if (c.note) row("confidence note", c.note);
  }
  const closed = id && ctx.ledger[id];
  if (closed){
    const [cls, r] = OUTCOME_PILL[closed.outcome] || ["p-low", ""];
    pills.push(<RevPill key="st" kind="status" cls={cls} word={closed.outcome}/>);
    rail = r;
    rows.push(<RevRow key={rows.length} label="closed">{closed.date} in <RoundLink tok={ctx.tok} file={closed.file}
      label={"round " + closed.k} onRound={ctx.onRound}/>{closed.note ? <>{" · "}<RevText v={closed.note}/></> : null}</RevRow>);
  } else if (status){
    const st = P.dlStatusPill(status);
    pills.push(<Html key="st" html={st.html}/>);
    rail = P.dlRail(status);
    if (st.note) row("status note", st.note);
  }
  return <div className={"dl-card " + rail}><div className="dl-head"><span className="dl-id">{id || "—"}</span>
    <Html as="span" className="dl-title" html={revText(title)}/><span className="dl-pills">{pills}</span></div>
    {rows.length ? <div className="dl-grid revgrid">{rows}</div> : null}
    {split.trailing ? <Html as="div" className="md dl-trail" html={P.renderMarkdown(split.trailing)}/> : null}
  </div>;
}

// A labelled field list becomes a ruled grid. Any line that is not a field
// sends the section back to markdown, so nothing in it goes missing.
function fieldGrid(lines: string[]): ReactNode | null {
  const split = P.dlSplitBody(lines);
  const fields = P.parseDLFields(split.fieldLines);
  if (!fields.length || split.trailing || fields.some(f => !f.label)) return null;
  return <div className="dl-card revcard"><div className="dl-grid revgrid">{fields.map((f, i) =>
    <RevRow key={i} label={f.label} text={f.value}/>)}</div></div>;
}

function ledgerGrid(lines: string[]): ReactNode | null {
  const {rows, clean} = S.ledgerRows(lines);
  if (!rows.length || !clean) return null;
  return <div className="dl-card revcard"><div className="dl-grid revgrid">{rows.map((r, i) =>
    <RevRow key={i} label={r.id}><RevPill kind="closed" cls={(OUTCOME_PILL[r.outcome] || ["p-low"])[0]} word={r.outcome}/>
      {" " + r.date}{r.note ? <>{" · "}<RevText v={r.note}/></> : null}</RevRow>)}</div></div>;
}

// Every panel body sits inside the md block, so a code span or a link inside
// a card takes the same style as one in prose.
const Panel = ({title, md, children}: {title: string; md?: string; children?: ReactNode}) =>
  <div className="doc">{title ? <h4>{title}</h4> : null}
    {md != null ? <Html as="div" className="md" html={P.renderMarkdown(md)}/> : <div className="md">{children}</div>}</div>;
const Md = ({text}: {text: string}) => <Html html={P.renderMarkdown(text)}/>;

/* The round body renders section by section, one doc panel each, the way
   the inspector shows a log section. Review Target, Review Verdict,
   Findings, and Prior Findings carry prreview's field grammar, so they
   become cards. Every other section, and any section that breaks the
   grammar, renders as markdown exactly as the file reads. The file's H1
   repeats what the round head already says, so we drop it. */
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
        if (entries.length) part = <>{pre ? <Md text={pre}/> : null}<div className="dl-cards">{entries.map((e, j) =>
          <FindingCard key={j} entry={e} ctx={ctx}/>)}</div></>;
      }
      return part != null ? <Panel key={i} title={t}>{part}</Panel> : <Panel key={i} title={t} md={body}/>;
    })}
  </div>;
}

// ---- the head ----

function ReviewHead({title, date, fields, notices, prior, dir, onRound}: {title: string; date: string;
  fields: ReviewVerdictFields | null; notices: string[]; prior: (S.ReviewRef & {tok: string})[]; dir: string;
  onRound(tok: string, file: string): void}){
  const f = fields || {};
  const chits = [date, ...(fields ? [f.verdict, f.confidence] : [])].filter(Boolean) as string[];
  const dd = (k: string, v: string | undefined) => <Fragment key={k}><dt>{k}</dt><dd>{v || "—"}</dd></Fragment>;
  return <div className="revhead"><div className="tickhead"><span className="tbig">{title}</span>
    {chits.map((c, i) => <span key={i} className="chit">{c}</span>)}{" "}<Permalink/></div>
    {notices.map((n, i) => <p key={i} className="dnotice">{n}</p>)}
    {fields ? <dl className="revfields">{dd("counts", f.counts)}{dd("opened", f.opened)}{dd("closed", f.closed)}{dd("carried open", f.carried)}</dl> : null}
    {prior.length ? <p className="revprior">earlier rounds: {prior.map((p, i) => <Fragment key={i}>{i ? ", " : null}<RoundLink tok={p.tok}
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
  act: ReviewsActions;
};

function Reviews({corpus, today, t, tokenOf, round, notice, dlFilter, decSort, iwSort, act}: ReviewsProps){
  // A ticket's reviews open from its phase strip, so the screen leads with
  // the way back to that ticket.
  const top = (sub: string | null) => <>
    {t ? <button type="button" className="adp-btn adp-btn--text" data-op="toticket" style={{marginBottom: 8}}
      onClick={act.onTicket}>‹ Back to {t.id || t.dir}</button> : null}
    <h2>reviews{sub ? <>{" "}<span className="isub">{sub}</span></> : null}</h2></>;
  // The four regions keep the vanilla page's ids.
  const regions = (topEl: ReactNode, nav: ReactNode, head: ReactNode, body: ReactNode) =>
    <><div id="revTop">{topEl}</div><div id="revNav">{nav}</div><div id="revHead">{head}</div><div id="revBody">{body}</div></>;
  const empty = (sub: string | null, text: string) => regions(top(sub), null, null, <div className="ipanel">
    {notice ? <p className="dnotice">{notice}</p> : null}<p className="dnotice">{text}</p></div>);
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
    <div className="secnav">
      {groups.length > 1 ? <select id="revPr" className="secsel" aria-label="pull request" value={g.pr} onChange={e => act.onPr(e.target.value)}>
        {groups.map(x => <option key={x.pr} value={x.pr}>{x.label}</option>)}</select> : null}
      <button type="button" className="op" data-revstep="-1" disabled={at.ri <= 0} onClick={() => act.onPick(g.rounds[at.ri - 1].file)}>‹ prev</button>
      <select id="revSel" className="secsel" aria-label="round" value={r.file} onChange={e => act.onPick(e.target.value)}>
        {g.rounds.map(x => <option key={x.file} value={x.file}>{"round " + x.k + " · " + x.date}</option>)}</select>
      <button type="button" className="op" data-revstep="1" disabled={at.ri >= g.rounds.length - 1} onClick={() => act.onPick(g.rounds[at.ri + 1].file)}>next ›</button>
    </div>,
    <ReviewHead title={title} date={r.date} fields={fields} notices={notices} prior={prior} dir={t.dir} onRound={act.onRound}/>,
    r.error != null ? null : <><ReviewBody text={String(r.text || "")} ctx={{ledger: S.reviewLedger(g.rounds), tok, onRound: act.onRound}}/>{panels}</>);
}

export {Reviews, ReviewBody, resolveRound, groupsOf};
export type {ReviewsActions};
