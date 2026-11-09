/* The new task screen: a form over one prompt-lib document, a side card
   that judges the export, and the draft that survives a reload. The state
   lives in useNewTask, which the app holds, so a tab switch never drops a
   half-written prompt. The one way in for a written prompt is the
   inspector's "start from this prompt". */
import {useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode} from "react";
import * as PL from "../lib/adp-prompt-lib.ts";
import * as S from "../lib/adp-shell-lib.ts";
import type {PromptDocument} from "../lib/adp-prompt-lib.ts";
import type {BuilderReport} from "../lib/adp-shell-lib.ts";

const NT_DRAFT_KEY = "adp-mc-draft", NT_DRAFT_MS = 400;
// A label that reports an outcome rests after this long, and an armed clear
// disarms after it.
const NT_LABEL_MS = 1200;
// The spoken verdict waits for a wider pause than the draft does, so a
// reader hears the state they stopped on and not every keystroke on the way.
const NT_ANNOUNCE_MS = 800;

type Draft = {doc: PromptDocument; slug: string; slugEdited: boolean};
type Pending = {label: string; go(): void};
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
  const [closed, setClosed] = useState<ReadonlySet<string>>(() => new Set());
  const [spoken, setSpoken] = useState("");
  // A focus target and a scroll request for the screen to serve after its
  // next render. The sequence number lets the same request repeat.
  const [focusTo, setFocusTo] = useState<{path: string; seq: number} | null>(null);
  const [yamlJump, setYamlJump] = useState(0);
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
  const edit = (next: PromptDocument) => { setDoc(next); draftSoon(); };

  /* A form in progress is not replaced without a word. The question waits
     in the ops row with a replace and a keep button, and the old draft
     stands until the reader answers. A blank form takes the prompt at once,
     and the draft saves at once. */
  const startFrom = (text: string, source: string) => {
    const r = readPrompt(text, source);
    if (!r.doc){ setReport(r.report); return; }
    const next = r.doc;
    const go = () => {
      clearTimeout(timers.current.draft); timers.current.draft = undefined;
      setDoc(next); setSlug(""); setSlugEdited(false); setReport(r.report); setPending(null);
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

  // Clear needs a second click inside the window. The first click arms the
  // button in place and the timer disarms it. A modal would block the page.
  const clear = () => {
    clearTimeout(timers.current.arm); timers.current.arm = undefined;
    if (clearLabel){
      clearTimeout(timers.current.draft); timers.current.draft = undefined;
      dropDraft();
      setDoc(blankDoc()); setSlug(""); setSlugEdited(false); setShowYaml(false);
      setReport(null); setPending(null); setCopyLabel(null); setClearLabel(null);
      return;
    }
    setClearLabel("confirm clear");
    timers.current.arm = setTimeout(() => { timers.current.arm = undefined; setClearLabel(null); }, NT_LABEL_MS);
  };

  // The label reports what the clipboard did, because a "copied" that
  // assumes success would hide a denied write. A denied write opens the
  // yaml panel, since the label sends the reader to that text.
  const copy = () => {
    let write: Promise<void>;
    try { write = navigator.clipboard.writeText(yaml); } catch (e) { write = Promise.reject(e); }
    Promise.resolve(write).then(() => setCopyLabel("copied"), () => {
      setCopyLabel("copy failed — select the text");
      setShowYaml(true); setYamlJump(n => n + 1);
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
  const toggleYaml = () => {
    setShowYaml(v => !v);
    if (!showYaml) setYamlJump(n => n + 1);
  };

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
  const toggleSection = (name: string) => setClosed(prev => {
    const next = new Set(prev);
    if (!next.delete(name)) next.add(name);
    return next;
  });

  return {doc, slug, issues, yaml, dir, showYaml, report, pending, copyLabel, clearLabel, closed, spoken, focusTo, yamlJump,
    setField: (path: string, v: unknown) => edit(setPath(doc, path, v)),
    setSlug: (v: string) => { setSlug(v); setSlugEdited(!!v); draftSoon(); },
    startFrom, keep, clear, copy, download, toggleYaml, addRow, delRow, tickArtifact, toggleSection};
}
type NewTaskState = ReturnType<typeof useNewTask>;

// ---- the form ----

type Act = Pick<NewTaskState, "setField" | "addRow" | "delRow">;

function Label({text, htmlFor}: {text: string; htmlFor?: string}){
  return <label className="nt-lbl" htmlFor={htmlFor}>{text}</label>;
}
function Text({path, v, ph, id, act}: {path: string; v: string; ph?: string; id?: string; act: Act}){
  return <input type="text" className="nt-in" id={id} data-nf={path} value={v || ""} placeholder={ph || ""}
    aria-label={ph || path} onChange={e => act.setField(path, e.target.value)}/>;
}
function Area({path, v, ph, id, cls, act}: {path: string; v: string; ph: string; id?: string; cls?: string; act: Act}){
  return <textarea className={"nt-in" + (cls ? " " + cls : "")} id={id} data-nf={path} value={v || ""} placeholder={ph}
    aria-label={ph || path} onChange={e => act.setField(path, e.target.value)}/>;
}
function Del({path, act}: {path: string; act: Act}){
  return <button type="button" className="nt-del" data-ndel={path} aria-label="remove row" onClick={() => act.delRow(path)}>×</button>;
}
function Add({list, text, act}: {list: string; text: string; act: Act}){
  return <button type="button" className="nt-add" data-nadd={list} onClick={() => act.addRow(list)}>+ {text}</button>;
}
// A list of plain strings: one input and a remove button per row.
function List({list, items, label, ph, act}: {list: string; items: string[]; label: string; ph: string; act: Act}){
  return <><div className="nt-sub">{label}</div>
    {items.map((v, i) => <div key={i} className="nt-row nt-row1"><Text path={`${list}.${i}`} v={v} ph={ph} act={act}/><Del path={`${list}.${i}`} act={act}/></div>)}
    <Add list={list} text="add" act={act}/></>;
}

/* A form section that collapses by its heading. The heading holds a real
   button, so Enter and Space work and a screen reader hears the state. The
   body stays in the document while hidden, so its fields keep their
   values and their place. */
function Section({name, sub, nt, children}: {name: string; sub?: string; nt: NewTaskState; children: ReactNode}){
  const open = !nt.closed.has(name);
  const id = "ntsec-" + name.replace(/ /g, "-");
  return <div className="ipanel nt-sec">
    <h2><button type="button" className="nt-sechead" aria-expanded={open} aria-controls={id} onClick={() => nt.toggleSection(name)}>
      {name}{sub ? <>{" "}<span className="isub">{sub}</span></> : null}</button></h2>
    <div id={id} hidden={!open}>{children}</div>
  </div>;
}

function Ops({nt}: {nt: NewTaskState}){
  return <><div className="mops"><span className="mgap"></span>
    <button type="button" className={"op" + (nt.clearLabel ? " is-armed" : "")} data-op="ntclear" onClick={nt.clear}>{nt.clearLabel || "clear"}</button></div>
    {nt.pending ? <p className="nt-report is-warn" role="status">a form is in progress — replace it with {nt.pending.label}?{" "}
      <button type="button" className="op" id="ntReplace" onClick={nt.pending.go}>replace the form</button>{" "}
      <button type="button" className="op" id="ntKeep" onClick={nt.keep}>keep the form</button></p> : null}
    {nt.report ? <p className={"nt-report is-" + nt.report.tone} role="status">{nt.report.text}</p> : null}</>;
}

/* The side card: the badge, the unmet checks by key, the directory line,
   and the export controls. Every row prints its key and the fixed word
   required, so no message can outgrow the card. */
function Side({nt}: {nt: NewTaskState}){
  const n = nt.issues.length;
  return <div className="ipanel nt-side" id="ntSide"><h2>export</h2>
    {n ? <span className="nt-vchit is-bad">⚠ {n} protocol check{n === 1 ? "" : "s"} unmet</span> : <span className="nt-vchit">valid · schema 1.0</span>}
    {n ? <ul className="nt-checks">{nt.issues.map(([k], i) => <li key={i}><code>{k}</code> — required</li>)}</ul> : null}
    <div className="nt-dir" id="ntDir">{nt.dir}</div>
    <div className="nt-sidebtns">
      <button type="button" className="op op-acc" data-op="ntcopy" onClick={nt.copy}>{nt.copyLabel || "⧉ copy yaml"}</button>
      <button type="button" className="op" data-op="ntdl" onClick={nt.download}>↓ download</button>
      <button type="button" className={"op tgl" + (nt.showYaml ? " is-on" : "")} data-op="ntyaml" onClick={nt.toggleYaml}>{nt.showYaml ? "hide yaml" : "view yaml"}</button>
    </div><div className="nt-autosave">draft autosaves locally · restored on return</div>
    <div className="sr-live" id="ntLive" role="status" aria-live="polite">{nt.spoken}</div>
  </div>;
}

function NewTask({nt}: {nt: NewTaskState}){
  const {doc} = nt, t = doc.task, r = doc.role, c = doc.context, o = doc.output, p = doc.protocol;
  const defers = Array.isArray(p.defers) ? p.defers : [];
  const artifacts = Array.isArray(p.artifacts) ? p.artifacts : [];
  const act: Act = nt;
  // The keyboard lands in the row it asked for.
  useLayoutEffect(() => {
    if (!nt.focusTo) return;
    const row = nt.focusTo.path;
    const el = [...document.querySelectorAll<HTMLElement>("#scrNew .nt-in")].find(x => {
      const f = x.getAttribute("data-nf") || "";
      return f === row || f.startsWith(row + ".");
    });
    el?.focus();
  }, [nt.focusTo]);
  useLayoutEffect(() => {
    if (nt.yamlJump) document.getElementById("ntYaml")?.scrollIntoView?.();
  }, [nt.yamlJump]);
  return <><h2>new task</h2>
    <div id="ntOps"><Ops nt={nt}/></div>
    <div className="nt-grid"><div className="nt-form">
      <Section name="task" nt={nt}>
        <div className="nt-row nt-row4">
          <div><Label text="id" htmlFor="nt_id"/><Text path="task.id" v={t.id} ph="AV-016" id="nt_id" act={act}/></div>
          <div><Label text="title" htmlFor="nt_title"/><Text path="task.title" v={t.title} ph="One line naming the task" id="nt_title" act={act}/></div>
          <div><Label text="author" htmlFor="nt_author"/><Text path="task.author" v={t.author} ph="Who wrote this" id="nt_author" act={act}/></div>
          <div><Label text="date" htmlFor="nt_date"/><Text path="task.date" v={t.date} ph="YYYY-MM-DD" id="nt_date" act={act}/></div>
        </div>
        <Label text="slug · directory name only, not in the yaml" htmlFor="ntSlug"/>
        <input type="text" className="nt-in" id="ntSlug" value={nt.slug} placeholder="kebab-case-slug" aria-label="slug" onChange={e => nt.setSlug(e.target.value)}/>
        <Label text="preamble" htmlFor="nt_preamble"/>
        <Area path="preamble" v={doc.preamble} ph="Instructions about how to read this prompt, before the task itself" id="nt_preamble" cls="nt-short" act={act}/>
        <Label text="prompt" htmlFor="nt_prompt"/>
        <Area path="prompt" v={doc.prompt} ph="What to do, and the outcome a person should see when it works" id="nt_prompt" act={act}/>
      </Section>
      <Section name="role" nt={nt}>
        <Label text="lens" htmlFor="nt_lens"/><Text path="role.lens" v={r.lens} ph="The seniority and specialty to reason from" id="nt_lens" act={act}/>
        <List list="role.priorities" items={r.priorities} label="priorities · what wins when goals conflict" ph="e.g. testability" act={act}/>
      </Section>
      <Section name="context" nt={nt}>
        <Label text="background" htmlFor="nt_bg"/>
        <Area path="context.background" v={c.background} ph="System history, intent, org constraints" id="nt_bg" cls="nt-short" act={act}/>
        <List list="constraints.out_of_scope" items={doc.constraints.out_of_scope} label="out of scope · named exclusions" ph="What this task is not" act={act}/>
        <List list="constraints.must_not" items={doc.constraints.must_not} label="must not · hard prohibitions" ph="The line not to cross" act={act}/>
        <div className="nt-sub">references · path, lines, note</div>
        {c.references.map((x, i) => <div key={i} className="nt-row nt-row3">
          <Text path={`context.references.${i}.path`} v={x.path} ph="src/path/to/file.ts" act={act}/>
          <Text path={`context.references.${i}.lines`} v={x.lines} ph="42-88" act={act}/>
          <Text path={`context.references.${i}.note`} v={x.note} ph="Why this location matters" act={act}/>
          <Del path={`context.references.${i}`} act={act}/></div>)}
        <Add list="context.references" text="add reference" act={act}/>
        <List list="context.links" items={c.links} label="links" ph="https://…" act={act}/>
      </Section>
      <Section name="lessons learned" nt={nt}>
        {doc.lessons_learned.map((x, i) => <div key={i} className="nt-row nt-row2">
          <Text path={`lessons_learned.${i}.context`} v={x.context} ph="What a prior session tried or surfaced" act={act}/>
          <Text path={`lessons_learned.${i}.takeaway`} v={x.takeaway} ph="The dead end to avoid, or the fact now known" act={act}/>
          <Del path={`lessons_learned.${i}`} act={act}/></div>)}
        <Add list="lessons_learned" text="add lesson" act={act}/>
      </Section>
      <Section name="requirements" sub="id + statement + how to verify" nt={nt}>
        {doc.requirements.map((x, i) => <div key={i} className="nt-row nt-rowr">
          <Text path={`requirements.${i}.id`} v={x.id} ph="R1" act={act}/>
          <Text path={`requirements.${i}.statement`} v={x.statement} ph="Requirement" act={act}/>
          <Text path={`requirements.${i}.verify`} v={x.verify} ph="How to verify" act={act}/>
          <Del path={`requirements.${i}`} act={act}/></div>)}
        <Add list="requirements" text="add requirement" act={act}/>
      </Section>
      <Section name="output" nt={nt}>
        <div className="nt-row nt-rowo">
          <div><Label text="destination" htmlFor="nt_dest"/><Text path="output.destination" v={o.destination} ph="Where the work lands" id="nt_dest" act={act}/></div>
          <div><Label text="format" htmlFor="nt_fmt"/>
            <select className={"nt-in" + (o.format ? "" : " is-unset")} id="nt_fmt" data-nf="output.format" aria-label="format"
              value={o.format} onChange={e => nt.setField("output.format", e.target.value)}>
              {["", ...PL.FORMATS].map(f => <option key={f} value={f}>{f || "choose…"}</option>)}</select></div>
        </div>
        <Label text="structure" htmlFor="nt_struct"/>
        <Area path="output.structure" v={o.structure} ph="How the output is organized" id="nt_struct" cls="nt-short" act={act}/>
      </Section>
      <Section name="protocol" nt={nt}>
        <div className="nt-togs">{S.NT_SWITCHES.map(([k, text]) =>
          <label key={k} className={"nt-tog" + (p[k] ? " is-on" : "")}><input type="checkbox" data-nf={"protocol." + k} checked={!!p[k]}
            onChange={e => nt.setField("protocol." + k, e.target.checked)}/> {text}</label>)}</div>
        <div className="nt-sub">artifacts · which to produce</div>
        <div className="nt-chips">{PL.ARTIFACTS.map(a =>
          <label key={a} className={"nt-chip" + (artifacts.includes(a) ? " is-on" : "")}><input type="checkbox" data-nart={a} checked={artifacts.includes(a)}
            onChange={e => nt.tickArtifact(a, e.target.checked)}/> {a}</label>)}</div>
        <div className="nt-sub">defers · phases this task defers, with a reason each</div>
        {defers.map((d, i) => <div key={i} className="nt-row nt-rowd">
          <select className={"nt-in" + (d.phase ? "" : " is-unset")} data-nf={`protocol.defers.${i}.phase`} aria-label="phase"
            value={d.phase} onChange={e => nt.setField(`protocol.defers.${i}.phase`, e.target.value)}>
            {["", ...PL.PHASES].map(ph => <option key={ph} value={ph}>{ph ? ph.replace(/_/g, " ") : "phase…"}</option>)}</select>
          <Text path={`protocol.defers.${i}.reason`} v={d.reason} ph="Why this phase does not run" act={act}/>
          <Del path={`protocol.defers.${i}`} act={act}/></div>)}
        <Add list="protocol.defers" text="add deferral" act={act}/>
      </Section>
      {/* The yaml panel sits in the form column. The card sticks over the
          whole grid, so a panel in a row of its own would slide under it. */}
      {nt.showYaml ? <div className="ipanel" id="ntYaml"><h2>prompt.yaml</h2><pre className="packpre" id="ntYamlPre">{nt.yaml}</pre></div> : null}
    </div>
    <Side nt={nt}/></div>
  </>;
}

export {NewTask, useNewTask, readPrompt, NT_DRAFT_KEY};
export type {NewTaskState};
