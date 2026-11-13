/* The phase strip under a ticket's head, drawn with the design system's
   PhaseStrip classes: a P box for the prompt, the nine phase boxes, then a
   box per review round and one box for the extra sections. */
// The fields of a section entry the strip reads. The inspector's entries
// carry more, and they fit this shape.
type StripEntry = {key: string; phase: number | null; canonical: boolean; missing: boolean; prompt?: boolean};
type StripRound = {tok: string; file: string; label: string; title: string};
type StripBox = {label: string; key: string | null; title: string; missing: boolean; current: boolean};
type StripModel = {prompt: StripBox; phases: StripBox[]; extra: StripBox | null; note: string; steps: string[]};

/* A phase box opens the first canonical section of its phase, and it is
   current while any canonical section of that phase is selected. A phase the
   log never wrote is a dashed box and not a link. Every section the phases do
   not hold, such as a ledger, a review response, or a repeated chain, counts
   as extra, and the extra box opens the first of them. The steps are the
   keys that ← and → walk, in the strip's order. */
function stripModel(entries: readonly StripEntry[], selKey: string | null): StripModel {
  const sel = entries.find(en => en.key === selKey) || null;
  const hasPrompt = entries.some(en => en.prompt);
  const prompt: StripBox = {label: "P", key: hasPrompt ? entries.find(en => en.prompt)!.key : null,
    title: hasPrompt ? "Prompt" : "No prompt.yaml", missing: !hasPrompt, current: !!sel?.prompt};
  const phases: StripBox[] = [];
  for (let n = 1; n <= 9; n++){
    const first = entries.find(en => en.phase === n && en.canonical && !en.missing && !en.prompt);
    phases.push({label: String(n), key: first ? first.key : null, title: "Phase " + n + (first ? "" : " · missing"),
      missing: !first, current: !!sel && !sel.missing && sel.canonical && sel.phase === n});
  }
  const extras = entries.filter(en => !en.prompt && !en.missing && !en.canonical);
  const extra: StripBox | null = extras.length ? {label: "+" + extras.length + " extra", key: extras[0].key,
    title: extras.length === 1 ? "1 extra section" : extras.length + " extra sections", missing: false,
    current: !!sel && extras.includes(sel)} : null;
  const written = phases.filter(b => !b.missing).length;
  const note = !written && hasPrompt ? "Prompt only · no phase written yet"
    : written === 9 ? "All nine phases written" : "Dashed boxes are missing phases";
  const steps = [prompt, ...phases, ...(extra ? [extra] : [])].filter(b => !b.missing).map(b => b.key!);
  return {prompt, phases, extra, note, steps};
}

type PhaseStripProps = {model: StripModel; rounds: StripRound[]; onPick(key: string): void; onRound(tok: string, file: string): void};

function Box({b, onPick, wide}: {b: StripBox; onPick(key: string): void; wide?: boolean}){
  const cls = "adp-phase" + (wide ? " adp-phase--wide" : "") + (b.missing ? " adp-phase--missing" : "");
  return b.missing || !b.key ? <span className={cls} title={b.title}>{b.label}</span>
    : <a className={cls} href="#" data-step={b.key} title={b.title} aria-current={b.current ? "step" : undefined}
      onClick={e => { e.preventDefault(); onPick(b.key!); }}>{b.label}</a>;
}

function PhaseStrip({model, rounds, onPick, onRound}: PhaseStripProps){
  return <nav className="adp-phases" id="phaseStrip" aria-label="Phases">
    <div className="adp-phases__boxes">
      <Box b={model.prompt} onPick={onPick}/>
      <span className="adp-phases__sep"></span>
      {model.phases.map(b => <Box key={b.label} b={b} onPick={onPick}/>)}
      {rounds.length || model.extra ? <span className="adp-phases__sep"></span> : null}
      {rounds.map(r => <a key={r.file} className="adp-phase adp-phase--wide" href="#" data-round={r.file} title={r.title}
        onClick={e => { e.preventDefault(); onRound(r.tok, r.file); }}>{r.label}</a>)}
      {model.extra ? <Box b={model.extra} onPick={onPick} wide/> : null}
    </div>
    <span className="adp-phases__note">{model.note}</span>
    <span className="adp-phases__note" style={{color: "var(--faint)"}}>← → to move</span>
  </nav>;
}

export {PhaseStrip, stripModel};
export type {StripEntry, StripModel, StripRound};
