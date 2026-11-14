/* The new task screen: a form over one prompt-lib document, a side card
   that judges the export, and the draft that survives a reload. The state
   lives in useNewTask, which the app holds, so a tab switch never drops a
   half-written prompt. The one way in for a written prompt is the
   inspector's "start from this prompt". */
import {useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode} from "react";
import * as PL from "../lib/adp-prompt-lib.ts";
import * as S from "../lib/adp-shell-lib.ts";
import type {PromptDocument} from "../lib/adp-prompt-lib.ts";
import type {BuilderReport} from "../lib/adp-shell-lib.ts";
import {SELECT} from "./Inspector.tsx";

const NT_DRAFT_KEY = "adp-mc-draft", NT_DRAFT_MS = 400;
// A label that reports an outcome rests after this long, and an armed clear
// disarms after it.
const NT_LABEL_MS = 1200;
// The spoken verdict waits for a wider pause than the draft does, so a
// reader hears the state they stopped on and not every keystroke on the way.
const NT_ANNOUNCE_MS = 800;

type Draft = {doc: PromptDocument; slug: string; slugEdited: boolean};
type Pending = {label: string; go(): void};
// The ticket a prompt came from, by its rail token and the name it shows.
type Origin = {tok: string; label: string};
type Imported = {doc: PromptDocument | null; report: BuilderReport};

const blankDoc = (): PromptDocument => { const d = PL.blankDocument(); d.task.date = S.localDate(); return d; };
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

/* The builder only writes 1.0 documents, so an adopted document carries
   that version whatever its text said. A key or list item the form has no
   place for is dropped before the fill, so normalize cannot blank it into a
   row the bytes never carry. */
function adopt(parsed: unknown): PromptDocument {
  const d = PL.normalize(S.placeable(parsed).doc);
  d.schema_version = "1.0";
  // A value the select cannot show is cleared. The artifacts take the chip
  // row's own order with each name once, so two forms that tick the same
  // chips export the same bytes.
  if (!PL.FORMATS.includes(d.output.format)) d.output.format = "";
  // A key written with no value parses as null, and normalize fills a
  // default only for a key that is absent, so we read null as the untouched
  // chip row.
  const arts = Array.isArray(d.protocol.artifacts) ? d.protocol.artifacts : PL.DEFAULT_ARTIFACTS;
  d.protocol.artifacts = PL.ARTIFACTS.filter(a => arts.includes(a));
  // A toggle holds a boolean. A value it cannot read keeps the blank
  // document's state, which is what an untouched checkbox shows, so a key
  // written with no value never turns the protocol off. An absent key stays
  // absent, because the badge has to keep asking for it.
  const blankSwitches = PL.blankDocument().protocol;
  for (const [k] of S.NT_SWITCHES)
    if (k in d.protocol && typeof d.protocol[k] !== "boolean") d.protocol[k] = blankSwitches[k];
  if (Array.isArray(d.protocol.defers)){
    // normalize passes a deferral through whole, so we fill it to the blank
    // row's shape here. A field the text left out would otherwise reach the
    // export as the word undefined.
    d.protocol.defers = d.protocol.defers.map(x => {
      const row = Object.assign(S.blankRow("protocol.defers") as {phase: string; reason: string}, x);
      if (!PL.PHASES.includes(row.phase)) row.phase = "";
      return row;
    });
    if (!d.protocol.defers.length) delete d.protocol.defers;
  }
  return d;
}

/* One copy of the document with every value trimmed and a blank row dropped
   from the four lists of plain values. The form keeps what the reader
   typed, padding and all, so a caret stays where it was. Every surface that
   writes or judges the export reads this one image. */
function exportedOf(doc: PromptDocument): PromptDocument {
  const trim = (v: unknown): unknown => Array.isArray(v) ? v.map(trim)
    : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, trim(x)]))
    : typeof v === "string" ? v.trim() : v;
  const d = trim(doc) as PromptDocument;
  d.role.priorities = d.role.priorities.filter(x => x !== "");
  d.constraints.out_of_scope = d.constraints.out_of_scope.filter(x => x !== "");
  d.constraints.must_not = d.constraints.must_not.filter(x => x !== "");
  d.context.links = d.context.links.filter(x => x !== "");
  return d;
}

/* A form is in progress when its export differs from the blank one. A
   restored draft has normalize's key order and never equals the blank
   object graph, but its bytes do. The blank takes the draft's own date, so
   a draft saved on an earlier day stays blank until a person types. */
function dirty(doc: PromptDocument, slugEdited: boolean): boolean {
  if (slugEdited) return true;
  const exp = exportedOf(doc), blank = blankDoc();
  blank.task.date = exp.task.date;
  return PL.buildYaml(exp) !== PL.buildYaml(blank);
}

/* A prompt's text read into a document, or the reason it could not be. The
   form adopts a document only after a clean parse, and the report names
   every key the parser skipped or the schema does not know. */
function readPrompt(text: string, source: string): Imported {
  if (!String(text).trim()) return {doc: null, report: {tone: "warn", text: `nothing to import — ${source} is empty.`}};
  const skipped: string[] = [];
  let obj: unknown = null;
  try { obj = PL.parseYAML(text, skipped); } catch { obj = null; }
  if (!obj || typeof obj !== "object" || Array.isArray(obj) || !Object.keys(obj).length)
    return {doc: null, report: {tone: "warn", text: `couldn't parse ${source} as YAML — check indentation and structure.`}};
  const o = obj as Record<string, unknown>;
  const issues: string[] = [];
  if ("schema_version" in o && String(o.schema_version) !== "1.0")
    issues.push(`schema_version is "${String(o.schema_version)}" (this builder writes 1.0); fields may not line up`);
  issues.push(...skipped, ...S.unknownKeys(o), ...S.unknownValues(o));
  return {doc: adopt(o), report: issues.length
    ? {tone: "warn", text: `imported ${source} with ${issues.length} issue${issues.length === 1 ? "" : "s"}: ${issues.join("; ")}`}
    : {tone: "ok", text: `imported ${source} — all recognized fields.`}};
}

/* The draft from the last session. Storage that is unavailable means no
   draft, never a broken screen. A draft that cannot be read is dropped and
   the form boots blank. A draft nobody typed into takes today's date, so
   the directory line never names a day the task did not start on. */
function restore(): Draft {
  const blank = {doc: blankDoc(), slug: "", slugEdited: false};
  let raw: unknown = null;
  try { raw = JSON.parse(localStorage.getItem(NT_DRAFT_KEY) as string); }
  catch { dropDraft(); return blank; }
  if (!raw || typeof raw !== "object") return blank;
  const d = raw as {doc?: unknown; slug?: unknown; slugEdited?: unknown};
  try {
    const doc = adopt(d.doc), slug = String(d.slug || "");
    const slugEdited = !!d.slugEdited && !!slug;
    if (!dirty(doc, slugEdited)) doc.task.date = S.localDate();
    return {doc, slug, slugEdited};
  } catch { dropDraft(); return blank; }
}
function saveDraft(d: Draft){
  try { localStorage.setItem(NT_DRAFT_KEY, JSON.stringify(d)); } catch {}
}
function dropDraft(){
  try { localStorage.removeItem(NT_DRAFT_KEY); } catch {}
}

// A dotted path into the document, where a numeric segment indexes a list.
function setPath(doc: PromptDocument, path: string, v: unknown): PromptDocument {
  const next = clone(doc), ks = path.split(".");
  let o = next as unknown as Record<string, unknown>;
  for (let i = 0; i < ks.length - 1; i++) o = o[ks[i]] as Record<string, unknown>;
  o[ks[ks.length - 1]] = v;
  return next;
}
function listOf(doc: PromptDocument, list: string): unknown[] {
  if (list === "protocol.defers") return doc.protocol.defers || (doc.protocol.defers = []);
  const o = doc as unknown as Record<string, Record<string, unknown[]>>;
  const ks = list.split(".");
  return ks.length === 2 ? o[ks[0]][ks[1]] : o[ks[0]] as unknown as unknown[];
}

function useNewTask(){
  const [first] = useState(restore);
  const [doc, setDoc] = useState(first.doc);
  const [slug, setSlug] = useState(first.slug);
  const [slugEdited, setSlugEdited] = useState(first.slugEdited);
  const [showYaml, setShowYaml] = useState(false);
  const [report, setReport] = useState<BuilderReport | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [copyLabel, setCopyLabel] = useState<string | null>(null);
  const [clearLabel, setClearLabel] = useState<string | null>(null);
  const [origin, setOrigin] = useState<Origin | null>(null);
  // The checklist starts closed, so the bar never covers the form on a short window.
  const [checklist, setChecklist] = useState(false);
  const [spoken, setSpoken] = useState("");
  // A focus target for the screen to serve after its next render. The
  // sequence number lets the same request repeat.
  const [focusTo, setFocusTo] = useState<{path: string; seq: number} | null>(null);
  // The last focus request the screen served. The screen mounts again on
  // each return, so it reads this to act on a request only once.
  const served = useRef({focus: 0});
  // The draft timer fires after the render that follows the edit, so it
  // reads the latest values here and never a stale closure.
  const latest = useRef<Draft>(first);
  latest.current = {doc, slug, slugEdited};
  const timers = useRef<{draft?: ReturnType<typeof setTimeout>; arm?: ReturnType<typeof setTimeout>; copy?: ReturnType<typeof setTimeout>}>({});

  const exported = useMemo(() => exportedOf(doc), [doc]);
  const yaml = useMemo(() => PL.buildYaml(exported), [exported]);
  // asExported edits its argument in place, so it gets its own copy.
  const issues = useMemo(() => PL.validate(PL.asExported(exportedOf(doc))), [doc]);
  const dir = S.promptDir(exported, S.slugOf(slugEdited ? slug : doc.task.title));

  // The first report seeds the announcer silently, so a boot or a restored
  // draft never announces the state it opened with.
  const announce = useRef<((n: number) => void) | null>(null);
  // The timer functions are looked up on each call, not captured once, so
  // a test that swaps the clock in drives the announcer too.
  announce.current ??= PL.createStatusAnnouncer<number>({say: setSpoken, debounceMs: NT_ANNOUNCE_MS,
    setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: t => clearTimeout(t as ReturnType<typeof setTimeout>),
    format: n => n === 0 ? "Valid" : `${n} protocol check${n === 1 ? "" : "s"} unmet`});
  useEffect(() => { announce.current!(issues.length); }, [issues.length]);

  // A tab closed inside a typing pause still keeps the draft.
  useEffect(() => {
    const flush = () => {
      if (timers.current.draft == null) return;
      clearTimeout(timers.current.draft); timers.current.draft = undefined;
      saveDraft(latest.current);
    };
    window.addEventListener("pagehide", flush);
    const t = timers.current;
    return () => { window.removeEventListener("pagehide", flush); clearTimeout(t.draft); clearTimeout(t.arm); clearTimeout(t.copy); };
  }, []);

  const draftSoon = () => {
    clearTimeout(timers.current.draft);
    timers.current.draft = setTimeout(() => { timers.current.draft = undefined; saveDraft(latest.current); }, NT_DRAFT_MS);
  };
  // The first edit after a start from a prompt takes the banner and its
  // Start blank away, so a single click can never discard typed work. A
  // clean import's quiet line leaves with the banner it sat under. A report
  // that names skipped keys stays, because the reader may still need it.
  const leaveStart = () => {
    if (!origin) return;
    setOrigin(null);
    setReport(r => r && r.tone === "ok" ? null : r);
  };
  const edit = (next: PromptDocument) => { setDoc(next); leaveStart(); draftSoon(); };

  /* A form in progress is not replaced without a word. The question waits
     in the ops row with a replace and a keep button, and the old draft
     stands until the reader answers. A blank form takes the prompt at once,
     and the draft saves at once. A new task needs its own id and starts
     today, so the copy leaves the id and the slug blank and takes today's
     date, as the NewTaskFromPrompt board draws it. */
  const startFrom = (text: string, source: string, from: Origin | null = null) => {
    const r = readPrompt(text, source);
    if (!r.doc){ setReport(r.report); return; }
    const next = r.doc;
    next.task.id = "";
    next.task.date = S.localDate();
    const go = () => {
      clearTimeout(timers.current.draft); timers.current.draft = undefined;
      setDoc(next); setSlug(""); setSlugEdited(false); setReport(r.report); setPending(null); setOrigin(from);
      saveDraft({doc: next, slug: "", slugEdited: false});
    };
    if (!dirty(doc, slugEdited)){ go(); return; }
    // An older report names a file nobody is loading now, so the question
    // stands alone.
    setReport(null);
    setPending({label: source, go});
  };
  const keep = () => {
    if (pending) setReport({tone: "ok", text: `kept the form — ${pending.label} was not imported.`});
    setPending(null);
  };

  const blank = () => {
    clearTimeout(timers.current.arm); timers.current.arm = undefined;
    clearTimeout(timers.current.draft); timers.current.draft = undefined;
    dropDraft();
    setDoc(blankDoc()); setSlug(""); setSlugEdited(false); setShowYaml(false);
    setReport(null); setPending(null); setCopyLabel(null); setClearLabel(null); setOrigin(null);
  };
  // Discard needs a second click inside the window. The first click arms the
  // button in place and the timer disarms it. A modal would block the page.
  // "Start blank" on a form just started from a prompt drops it at once,
  // because the reader has typed nothing into it yet.
  const clear = () => {
    clearTimeout(timers.current.arm); timers.current.arm = undefined;
    if (clearLabel){ blank(); return; }
    setClearLabel("Confirm discard");
    timers.current.arm = setTimeout(() => { timers.current.arm = undefined; setClearLabel(null); }, NT_LABEL_MS);
  };

  // The label reports what the clipboard did, because a "copied" that
  // assumes success would hide a denied write. A denied write opens the
  // preview, since the label sends the reader to that text.
  const copy = () => {
    let write: Promise<void>;
    try { write = navigator.clipboard.writeText(yaml); } catch (e) { write = Promise.reject(e); }
    Promise.resolve(write).then(() => setCopyLabel("copied"), () => {
      setCopyLabel("copy failed — select the text");
      setShowYaml(true);
    });
    clearTimeout(timers.current.copy);
    timers.current.copy = setTimeout(() => { timers.current.copy = undefined; setCopyLabel(null); }, NT_LABEL_MS);
  };
  const download = () => {
    const id = String(exported.task.id || "").replace(/[^A-Za-z0-9_.-]/g, "-") || "prompt";
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([yaml], {type: "text/yaml"}));
    a.download = id + ".yaml";
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const toggleYaml = () => setShowYaml(v => !v);

  const addRow = (list: string) => {
    const next = clone(doc);
    const rows = listOf(next, list);
    rows.push(S.blankRow(list));
    edit(next);
    setFocusTo(f => ({path: `${list}.${rows.length - 1}`, seq: (f ? f.seq : 0) + 1}));
  };
  // An emptied defers editor drops the key, so the export stays the same
  // bytes as one written before the editor existed.
  const delRow = (path: string) => {
    const i = path.lastIndexOf(".");
    const list = path.slice(0, i), next = clone(doc);
    listOf(next, list).splice(Number(path.slice(i + 1)), 1);
    if (list === "protocol.defers" && !next.protocol.defers!.length) delete next.protocol.defers;
    edit(next);
  };
  // The chips keep the lib's artifact order whatever order they were ticked
  // in, so two forms with the same ticks export the same bytes.
  const tickArtifact = (a: string, on: boolean) => {
    const set = new Set(doc.protocol.artifacts || []);
    if (on) set.add(a); else set.delete(a);
    edit(setPath(doc, "protocol.artifacts", PL.ARTIFACTS.filter(x => set.has(x))));
  };
  return {doc, slug, issues, yaml, dir, showYaml, report, pending, copyLabel, clearLabel, origin, checklist, spoken, focusTo, served,
    setField: (path: string, v: unknown) => edit(setPath(doc, path, v)),
    setSlug: (v: string) => { setSlug(v); setSlugEdited(!!v); leaveStart(); draftSoon(); },
    startFrom, keep, clear, startBlank: blank, copy, download, toggleYaml, closeYaml: () => setShowYaml(false),
    toggleChecklist: () => setChecklist(v => !v), addRow, delRow, tickArtifact};
}
type NewTaskState = ReturnType<typeof useNewTask>;

// ---- the form ----

type Act = Pick<NewTaskState, "setField" | "addRow" | "delRow">;

const FULL: CSSProperties = {width: "100%"};
// We keep a spoken twin rendered but off screen. display:none would silence
// it for assistive technology, so we clip it to one pixel instead.
const SR_ONLY: CSSProperties = {position: "absolute", width: 1, height: 1, margin: -1, padding: 0, border: 0, overflow: "hidden",
  clip: "rect(0 0 0 0)", whiteSpace: "nowrap"};
type TextProps = {path: string; v: string; ph?: string; id?: string; aria?: string; prose?: boolean; sm?: boolean; act: Act};
function Text({path, v, ph, id, aria, prose, sm, act}: TextProps){
  return <input type="text" className={"adp-input" + (sm ? " adp-input--sm" : "") + (prose ? " adp-input--prose" : "")} id={id} data-nf={path}
    value={v || ""} placeholder={ph || ""} aria-label={aria} style={FULL} onChange={e => act.setField(path, e.target.value)}/>;
}
function Area({path, v, ph, id, aria, rows, act}: {path: string; v: string; ph?: string; id?: string; aria?: string; rows: number; act: Act}){
  return <textarea className="adp-textarea" id={id} data-nf={path} rows={rows} value={v || ""} placeholder={ph || ""} aria-label={aria}
    style={{...FULL, display: "block"}} onChange={e => act.setField(path, e.target.value)}/>;
}
/* The Field component: the label above its control, and an optional hint at
   the right end of the label line. */
function Field({label, hint, children}: {label: string; hint?: string; children: ReactNode}){
  return <label className="adp-field" style={{minWidth: 0}}>
    <span style={{display: "flex", justifyContent: "space-between", gap: 12}}><span>{label}</span>{hint ? <span style={{color: "var(--faint)"}}>{hint}</span> : null}</span>
    {children}</label>;
}
const PAIR: CSSProperties = {display: "grid", gridTemplateColumns: "160px minmax(0, 1fr)", gap: 16};
const STACK: CSSProperties = {display: "flex", flexDirection: "column", gap: 16};
const TWO: CSSProperties = {display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "8px 16px"};
const COUNT: CSSProperties = {font: "400 11px/24px var(--font-mono)", color: "var(--faint)"};

// A form section opens under a mono eyebrow, as the NewTask board draws it.
function Head({name, count}: {name: string; count?: number}){
  return <div style={{margin: "40px 0 12px", display: "flex", alignItems: "baseline", gap: 12}}>
    <h3 className="adp-label">{name}</h3>{count == null ? null : <span style={COUNT}>{count}</span>}</div>;
}
// A repeatable list opens under its name, a hint, and its row count.
function SubHead({name, hint, count}: {name: string; hint?: string; count: number}){
  return <div style={{margin: "24px 0 4px", display: "flex", alignItems: "baseline", gap: 12}}>
    <h4 style={{margin: 0, font: "600 15px/24px var(--font-sans)", color: "var(--ink-2)"}}>{name}</h4>
    {hint ? <span style={{font: "400 13px/24px var(--font-sans)", color: "var(--faint)"}}>{hint}</span> : null}
    <span style={{marginLeft: "auto", font: "400 13px/24px var(--font-sans)", color: "var(--faint)"}}>{count}</span></div>;
}
function Del({path, label, act}: {path: string; label: string; act: Act}){
  return <button type="button" className="adp-btn adp-btn--icon" data-ndel={path} aria-label={label} onClick={() => act.delRow(path)}>×</button>;
}
function Add({list, text, act}: {list: string; text: string; act: Act}){
  return <div style={{marginTop: 4}}><button type="button" className="adp-btn adp-btn--text" data-nadd={list} onClick={() => act.addRow(list)}>+ {text}</button></div>;
}
// A row number sits in the first column, so a reader can name a row.
const Num = ({n}: {n: number}) => <span style={{font: "400 12px/24px var(--font-mono)", color: "var(--blue-bright)"}}>{n}</span>;
const row = (cols: string): CSSProperties => ({marginTop: 8, display: "grid", gridTemplateColumns: cols, gap: 8, alignItems: "center"});

// A list of plain strings: a numbered input and a remove button per row.
function List({list, items, name, hint, noun, add, act}: {list: string; items: string[]; name: string; hint?: string; noun: string; add: string; act: Act}){
  return <><SubHead name={name} hint={hint} count={items.length}/>
    {items.map((v, i) => <div key={i} style={row("24px minmax(0, 1fr) 28px")}><Num n={i + 1}/>
      <Text path={`${list}.${i}`} v={v} aria={`${noun} ${i + 1}`} prose sm act={act}/><Del path={`${list}.${i}`} label={`Remove ${noun} ${i + 1}`} act={act}/></div>)}
    <Add list={list} text={add} act={act}/></>;
}

// The four protocol switches and the nine artifacts by the names the board gives them.
const SWITCH_LABELS: Record<string, string> = {apply: "Apply protocol", stake_single_recommendation: "Stake a recommendation",
  log_assumptions: "Log assumptions", flag_low_confidence: "Flag low confidence"};
const ARTIFACT_LABELS: Record<string, string> = {premortem: "Pre-mortem", pr_summary: "PR summary"};
const artifactLabel = (a: string) => ARTIFACT_LABELS[a] || (a[0].toUpperCase() + a.slice(1)).replace(/_/g, " ");

/* The checklist's Required column names the checks a blank form fails, by
   plain name. Every other unmet check goes under Also fix by its key and
   the validator's own message, so the two columns hold every finding once. */
const REQUIRED: [string, string][] = [["task.id", "Task ID"], ["task.title", "Title"], ["task.author", "Author"], ["prompt", "Prompt"],
  ["output.format", "Output format"], ["output.destination", "Output destination"], ["requirements", "At least one requirement"]];

// The directory line marks each part the form has not filled yet.
function DirLine({dir}: {dir: string}){
  return <>{dir.split(/(<[^>]+>)/).map((x, i) => x.startsWith("<") ? <span key={i} style={{color: "var(--faint)"}}>{x}</span> : x)}</>;
}

function Checklist({nt}: {nt: NewTaskState}){
  const keys = new Set(nt.issues.map(([k]) => k));
  const req = new Set(REQUIRED.map(([k]) => k));
  const other = nt.issues.filter(([k]) => !req.has(k));
  const unmet = REQUIRED.filter(([k]) => keys.has(k)).length;
  const label: CSSProperties = {font: "500 11px/24px var(--font-mono)", letterSpacing: ".14em", textTransform: "uppercase", color: "var(--dim)"};
  const list: CSSProperties = {margin: "8px 0 0", padding: 0, listStyle: "none", display: "flex", flexDirection: "column"};
  // An unmet check carries its key and its place in the validator's list, so
  // a reader of the page can name each finding in the validator's order.
  const at = (k: string) => nt.issues.findIndex(([x]) => x === k);
  // The checklist stays in the document while closed, so the toggle's
  // aria-controls always names an element.
  return <section id="checklist" aria-label="Export checklist" style={{marginBottom: 8, padding: 20, background: "var(--panel)",
    boxShadow: "inset 0 0 0 1px var(--line-bright), var(--shadow)", display: nt.checklist ? "grid" : "none", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 16}}>
    <div><div style={label}>Required · {unmet}</div><ul style={{...list, gap: 4}}>{REQUIRED.map(([k, name]) => {
      const done = !keys.has(k);
      return <li key={k} data-req={k} data-issue={done ? undefined : k} data-at={done ? undefined : at(k)} style={{display: "flex", gap: 12, font: "400 15px/24px var(--font-sans)", color: done ? "var(--dim)" : "var(--ink-2)"}}>
        <span aria-hidden="true" style={{color: done ? "var(--ok)" : "var(--faint)"}}>{done ? "●" : "○"}</span>{name}{done ? <span style={SR_ONLY}> done</span> : null}</li>;
    })}</ul></div>
    <div><div style={label}>Also fix · {other.length}</div><ul style={{...list, gap: 8}}>{other.map(([k, msg], i) => <li key={i} data-issue={k} data-at={nt.issues.findIndex(x => x[0] === k && x[1] === msg)}>
      <div style={{font: "400 12px/24px var(--font-mono)", color: "var(--blue-bright)"}}>{k}</div>
      <div style={{font: "400 15px/24px var(--font-sans)", color: "var(--ink-2)"}}>{msg}</div></li>)}</ul></div>
    <div id="ntDir" style={{gridColumn: "1 / -1", paddingTop: 12, boxShadow: "inset 0 1px 0 var(--line)", font: "400 12px/24px var(--font-mono)",
      color: "var(--dim)", wordBreak: "break-all"}}>Saves to <DirLine dir={nt.dir}/></div>
  </section>;
}

/* The bottom bar stays in view at the foot of the stage while the form
   scrolls. It counts what is left to fix, opens the checklist, and holds the
   export. Copy YAML works on any draft, because a reader may want a draft
   that is not done yet, and the count says what is missing. */
function Bar({nt}: {nt: NewTaskState}){
  const n = nt.issues.length;
  // A sticky box measures its offset inside the stage's padding, so the bar
  // sits 80px lower to reach the window's foot past the page's bottom pad.
  return <div style={{position: "sticky", bottom: -80, marginTop: 40, zIndex: 1}}>
    <Checklist nt={nt}/>
    <div id="ntSide" style={{height: 56, padding: "0 16px", background: "var(--panel)", border: "1px solid var(--line-bright)", display: "flex", alignItems: "center", gap: 16}}>
      <span style={{font: "400 11px/24px var(--font-mono)", letterSpacing: ".08em", textTransform: "uppercase", color: n ? "var(--warn)" : "var(--ok)"}}>
        {n ? `${n} to go` : "Valid · schema 1.0"}</span>
      <button type="button" className="adp-btn adp-btn--text" aria-expanded={nt.checklist} aria-controls="checklist" onClick={nt.toggleChecklist}>
        Checklist {nt.checklist ? "▾" : "▸"}</button>
      <span style={{marginLeft: "auto"}}></span>
      <button type="button" className="adp-btn adp-btn--text" data-op="ntdl" onClick={nt.download}>Download</button>
      <button type="button" className="adp-btn adp-btn--text" data-op="ntyaml" onClick={nt.toggleYaml}>Preview YAML</button>
      <button type="button" className="adp-btn" data-op="ntcopy" onClick={nt.copy}>{nt.copyLabel || "Copy YAML"}</button>
      <div style={SR_ONLY} id="ntLive" role="status" aria-live="polite">{nt.spoken}</div>
    </div>
  </div>;
}

/* What sits under the title: the question before a start replaces a form in
   progress, the banner after a start from a prompt, and the import report
   in its own words, so a reader still sees every key an import skipped. */
function Ops({nt, onOpenTicket}: {nt: NewTaskState; onOpenTicket(tok: string): void}){
  // Under the banner a clean import's report is a quiet line, since the
  // banner already says what was copied. Any other report is a Notice.
  const quiet = !!nt.origin && !nt.pending && nt.report?.tone === "ok";
  const report = !nt.report ? null : quiet
    ? <p role="status" style={{margin: "4px 0 0", font: "400 13px/24px var(--font-sans)", color: "var(--faint)"}}>{nt.report.text}</p>
    : <div className="adp-notice" role="status" style={{marginTop: 16}}><span className="adp-notice__text"
      style={{color: nt.report.tone === "warn" ? "var(--warn)" : undefined}}>{nt.report.text}</span></div>;
  return <>
    {nt.pending ? <div className="adp-notice" role="status" style={{marginTop: 16}}><span className="adp-notice__text">
      a form is in progress — replace it with {nt.pending.label}?{" "}
      <button type="button" className="adp-btn adp-btn--text" id="ntReplace" onClick={nt.pending.go}>replace the form</button>{" "}
      <button type="button" className="adp-btn adp-btn--text" id="ntKeep" onClick={nt.keep}>keep the form</button></span></div> : null}
    {!nt.pending && nt.origin ? <p style={{margin: "16px 0 0", font: "400 15px/24px var(--font-sans)", color: "var(--dim)"}}>
      Started from <a href={S.hashWrite({t: nt.origin.tok})} onClick={e => { e.preventDefault(); onOpenTicket(nt.origin!.tok); }}>{nt.origin.label}</a>’s prompt.
      {" "}Everything but the ID and slug was copied, and the date is today’s.{" "}
      <button type="button" className="adp-btn adp-btn--text" data-op="ntblank" onClick={nt.startBlank}>Start blank</button></p> : null}
    {report}
  </>;
}

const FOCUSABLE = "button:not([disabled]), a[href], textarea, select";

/* Preview YAML, as the PreviewYaml board draws it: a modal drawer with the
   verdict, the text, and the export. Focus starts inside and stays inside.
   Escape, the scrim, and × close it, and focus goes back to the control
   that opened it once the page behind stops being inert. */
function YamlPreview({nt}: {nt: NewTaskState}){
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const el = ref.current;
    el?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape"){ e.preventDefault(); nt.closeYaml(); return; }
      if (e.key !== "Tab" || !el) return;
      const all = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const first = all[0], last = all[all.length - 1];
      if (e.shiftKey && document.activeElement === first){ e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last){ e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("keydown", key); if (opener && opener.isConnected) opener.focus(); };
    // The drawer reads its close action once, when it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const n = nt.issues.length;
  return <div style={{position: "fixed", inset: 0, zIndex: 20}}>
    <div className="adp-scrim" onClick={nt.closeYaml}></div>
    <section ref={ref} className="adp-drawer" id="ntYaml" role="dialog" aria-modal="true" aria-labelledby="ntYamlTitle"
      style={{position: "absolute", top: 0, right: 0, bottom: 0}}>
      <div className="adp-drawer__head">
        <h2 className="adp-drawer__title" id="ntYamlTitle">prompt.yaml</h2>
        <div className="adp-drawer__sub">Preview of this draft · read-only</div>
        <button type="button" className="adp-btn adp-btn--icon adp-drawer__close" aria-label="Close preview" onClick={nt.closeYaml}>×</button>
      </div>
      <div className="adp-drawer__body" style={{flex: "1 1 auto", minHeight: 0}}>
        <div style={{display: "flex", alignItems: "center", gap: 12, font: "400 13px/24px var(--font-sans)", color: "var(--dim)"}}>
          <span style={{font: "400 11px/24px var(--font-mono)", letterSpacing: ".08em", color: n ? "var(--warn)" : "var(--ok)"}}>{n ? `${n} TO GO` : "VALID"}</span>
          schema 1.0 · {n ? `${n} finding${n === 1 ? "" : "s"}` : "no findings"}</div>
        <pre className="adp-pre" id="ntYamlPre" style={{flex: "1 1 0px", minHeight: 160}}>{nt.yaml}</pre>
        <div style={{display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap"}}>
          <button type="button" className="adp-btn adp-btn--primary" data-op="pvcopy" onClick={nt.copy}>{nt.copyLabel || "Copy YAML"}</button>
          <button type="button" className="adp-btn adp-btn--text" data-op="pvdl" onClick={nt.download}>Download</button>
          <span style={{marginLeft: "auto", font: "400 11.5px/20px var(--font-mono)", color: "var(--faint)", overflowWrap: "anywhere"}}>{nt.dir}</span>
        </div>
      </div>
    </section>
  </div>;
}

function NewTask({nt, onOpenTicket}: {nt: NewTaskState; onOpenTicket(tok: string): void}){
  const {doc} = nt, t = doc.task, r = doc.role, c = doc.context, o = doc.output, p = doc.protocol;
  const defers = Array.isArray(p.defers) ? p.defers : [];
  const artifacts = Array.isArray(p.artifacts) ? p.artifacts : [];
  const act: Act = nt;
  // The preamble is optional, so it waits behind its add control until the
  // reader asks for it or a prompt brings one.
  const [preamble, setPreamble] = useState(false);
  const showPreamble = preamble || !!doc.preamble;
  // The keyboard lands in the row it asked for.
  useLayoutEffect(() => {
    if (!nt.focusTo || nt.focusTo.seq === nt.served.current.focus) return;
    nt.served.current.focus = nt.focusTo.seq;
    const at = nt.focusTo.path;
    const el = [...document.querySelectorAll<HTMLElement>("#scrNew [data-nf]")].find(x => {
      const f = x.getAttribute("data-nf") || "";
      return f === at || f.startsWith(at + ".");
    });
    el?.focus();
  }, [nt.focusTo, nt.served]);
  return <div style={{maxWidth: "72ch", margin: "0 auto"}}>
    <h1 style={{margin: 0, font: "600 24px/32px var(--font-sans)", letterSpacing: "normal", textTransform: "none", color: "var(--ink)"}}>New task</h1>
    <p style={{margin: "8px 0 0", font: "400 15px/24px var(--font-sans)", color: "var(--dim)"}}>Writes <code className="adp-code">prompt.yaml</code> for a new run. The draft saves as you type.</p>
    <div id="ntOps"><Ops nt={nt} onOpenTicket={onOpenTicket}/></div>
    <form aria-label="New task" onSubmit={e => e.preventDefault()}>
      <Head name="Task"/>
      <div style={STACK}>
        <div style={PAIR}>
          <Field label="ID"><Text path="task.id" v={t.id} ph="AV-016" id="nt_id" act={act}/></Field>
          <Field label="Title"><Text path="task.title" v={t.title} ph="One line naming the task" id="nt_title" prose act={act}/></Field>
        </div>
        <div style={PAIR}>
          <Field label="Date"><Text path="task.date" v={t.date} ph="YYYY-MM-DD" id="nt_date" act={act}/></Field>
          <Field label="Author"><Text path="task.author" v={t.author} ph="Who wrote this" id="nt_author" act={act}/></Field>
        </div>
        <Field label="Slug" hint="directory name only"><input type="text" className="adp-input" id="ntSlug" value={nt.slug} placeholder="kebab-case-slug"
          style={FULL} onChange={e => nt.setSlug(e.target.value)}/></Field>
      </div>
      <Head name="Preamble"/>
      {showPreamble ? <Area path="preamble" v={doc.preamble} ph="Instructions about how to read this prompt, before the task itself" id="nt_preamble" aria="Preamble" rows={3} act={act}/>
        : <><p style={{margin: 0, font: "400 13px/24px var(--font-sans)", color: "var(--faint)"}}>Optional. Standing instructions read before the prompt.</p>
          <div style={{marginTop: 4}}><button type="button" className="adp-btn adp-btn--text" data-op="ntpreamble" onClick={() => setPreamble(true)}>+ Add a preamble</button></div></>}
      <Head name="Prompt"/>
      <Area path="prompt" v={doc.prompt} ph="What to do, and the outcome a person should see when it works" id="nt_prompt" aria="Prompt" rows={5} act={act}/>
      <Head name="Role"/>
      <Field label="Lens"><Text path="role.lens" v={r.lens} ph="The seniority and specialty to reason from" id="nt_lens" prose act={act}/></Field>
      <List list="role.priorities" items={r.priorities} name="Priorities" hint="what wins when goals conflict" noun="priority" add="Add priority" act={act}/>
      <Head name="Context"/>
      <Field label="Background"><Area path="context.background" v={c.background} ph="System history, intent, org constraints" id="nt_bg" rows={3} act={act}/></Field>
      <List list="constraints.out_of_scope" items={doc.constraints.out_of_scope} name="Out of scope" noun="out of scope" add="Add" act={act}/>
      <List list="constraints.must_not" items={doc.constraints.must_not} name="Must not" noun="must not" add="Add" act={act}/>
      <SubHead name="References" hint="path, lines, note" count={c.references.length}/>
      {c.references.map((x, i) => <div key={i} style={row("24px minmax(0, 1fr) 88px minmax(0, 1fr) 28px")}><Num n={i + 1}/>
        <Text path={`context.references.${i}.path`} v={x.path} ph="src/path/to/file.ts" aria={`Reference ${i + 1} path`} sm act={act}/>
        <Text path={`context.references.${i}.lines`} v={x.lines} ph="42-88" aria={`Reference ${i + 1} lines`} sm act={act}/>
        <Text path={`context.references.${i}.note`} v={x.note} ph="Why this location matters" aria={`Reference ${i + 1} note`} prose sm act={act}/>
        <Del path={`context.references.${i}`} label={`Remove reference ${i + 1}`} act={act}/></div>)}
      <Add list="context.references" text="Add reference" act={act}/>
      <List list="context.links" items={c.links} name="Links" noun="link" add="Add link" act={act}/>
      <SubHead name="Lessons learned" hint="context and takeaway" count={doc.lessons_learned.length}/>
      {doc.lessons_learned.map((x, i) => <div key={i} style={row("24px minmax(0, 1fr) minmax(0, 1fr) 28px")}><Num n={i + 1}/>
        <Text path={`lessons_learned.${i}.context`} v={x.context} ph="What a prior session tried or surfaced" aria={`Lesson ${i + 1} context`} prose sm act={act}/>
        <Text path={`lessons_learned.${i}.takeaway`} v={x.takeaway} ph="The dead end to avoid, or the fact now known" aria={`Lesson ${i + 1} takeaway`} prose sm act={act}/>
        <Del path={`lessons_learned.${i}`} label={`Remove lesson ${i + 1}`} act={act}/></div>)}
      <Add list="lessons_learned" text="Add lesson" act={act}/>
      <Head name="Requirements" count={doc.requirements.length}/>
      {doc.requirements.length ? <div style={{display: "grid", gridTemplateColumns: "56px minmax(0, 1fr) minmax(0, 1fr) 28px", gap: 8, paddingBottom: 8,
        boxShadow: "inset 0 -1px 0 var(--line-bright)", font: "500 10.5px/24px var(--font-mono)", letterSpacing: ".12em", textTransform: "uppercase", color: "var(--dim)"}}>
        <span>ID</span><span>Statement</span><span>Verify</span><span></span></div> : null}
      {doc.requirements.map((x, i) => <div key={i} style={row("56px minmax(0, 1fr) minmax(0, 1fr) 28px")}>
        <Text path={`requirements.${i}.id`} v={x.id} ph="R1" aria={`Requirement ${i + 1} ID`} sm act={act}/>
        <Text path={`requirements.${i}.statement`} v={x.statement} ph="Statement" aria={`Requirement ${i + 1} statement`} prose sm act={act}/>
        <Text path={`requirements.${i}.verify`} v={x.verify} ph="How to verify" aria={`Requirement ${i + 1} verify`} prose sm act={act}/>
        <Del path={`requirements.${i}`} label={`Remove ${x.id || "requirement " + (i + 1)}`} act={act}/></div>)}
      <Add list="requirements" text="Add requirement" act={act}/>
      <Head name="Output"/>
      <div style={STACK}>
        <div style={PAIR}>
          <Field label="Format"><select className="adp-select" id="nt_fmt" data-nf="output.format" value={o.format}
            style={{...SELECT, ...FULL, color: o.format ? undefined : "var(--faint)"}} onChange={e => nt.setField("output.format", e.target.value)}>
            {["", ...PL.FORMATS].map(f => <option key={f} value={f}>{f || "Choose…"}</option>)}</select></Field>
          <Field label="Destination"><Text path="output.destination" v={o.destination} ph="Where the work lands" id="nt_dest" act={act}/></Field>
        </div>
        {/* Structure keeps a text area, because a written prompt can hold a structure of several lines. */}
        <Field label="Structure"><Area path="output.structure" v={o.structure} ph="How the output is organized" id="nt_struct" rows={3} act={act}/></Field>
      </div>
      <Head name="Protocol"/>
      <div style={TWO}>{S.NT_SWITCHES.map(([k]) => <label key={k} className="adp-check"><input type="checkbox" data-nf={"protocol." + k} checked={!!p[k]}
        onChange={e => nt.setField("protocol." + k, e.target.checked)}/>{SWITCH_LABELS[k]}</label>)}</div>
      <SubHead name="Artifacts to produce" count={artifacts.length}/>
      <div style={{...TWO, marginTop: 8}}>{PL.ARTIFACTS.map(a => <label key={a} className="adp-check"><input type="checkbox" data-nart={a}
        checked={artifacts.includes(a)} onChange={e => nt.tickArtifact(a, e.target.checked)}/>{artifactLabel(a)}</label>)}</div>
      {defers.length ? <SubHead name="Deferred phases" hint="each with a reason" count={defers.length}/> : null}
      {defers.map((d, i) => <div key={i} style={row("160px minmax(0, 1fr) 28px")}>
        <select className="adp-select" data-nf={`protocol.defers.${i}.phase`} aria-label={`Deferred phase ${i + 1}`} value={d.phase}
          style={{...SELECT, ...FULL, height: 32, color: d.phase ? undefined : "var(--faint)"}} onChange={e => nt.setField(`protocol.defers.${i}.phase`, e.target.value)}>
          {["", ...PL.PHASES].map(ph => <option key={ph} value={ph}>{ph ? ph.replace(/_/g, " ") : "Phase…"}</option>)}</select>
        <Text path={`protocol.defers.${i}.reason`} v={d.reason} ph="Why this phase does not run" aria={`Deferred phase ${i + 1} reason`} prose sm act={act}/>
        <Del path={`protocol.defers.${i}`} label={`Remove deferred phase ${i + 1}`} act={act}/></div>)}
      <div style={{marginTop: 12}}><button type="button" className="adp-btn adp-btn--text" data-nadd="protocol.defers" onClick={() => act.addRow("protocol.defers")}>
        + Defer a phase, with a reason</button></div>
      <div style={{marginTop: 40, paddingTop: 12, boxShadow: "inset 0 1px 0 var(--line)"}}>
        <button type="button" className="adp-btn adp-btn--text" data-op="ntclear" style={{color: nt.clearLabel ? "var(--warn)" : "var(--dim)"}}
          onClick={nt.clear}>{nt.clearLabel || "Discard draft"}</button></div>
    </form>
    <Bar nt={nt}/>
  </div>;
}

export {NewTask, YamlPreview, useNewTask, readPrompt, NT_DRAFT_KEY};
export type {NewTaskState};
