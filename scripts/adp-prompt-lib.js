/* adp-prompt-lib.js — shared pure logic for the ADP prompt builder.
   parseYAML, buildYaml, validate and the shared constants, extracted from
   prompt-builder.html (PB-002-extract-prompt-lib) and extended with import
   reporting and folded scalars (PB-003-import-fidelity). Exposed as one
   namespace: the browser global `ADPPromptLib` via a plain <script> tag, or
   `module.exports` under Node (`require("./adp-prompt-lib.js")`).
   No dependencies, no build step. */
(function(global){
  "use strict";

  const ARTIFACTS = ["problem_statement","knowledge_gap","recommendation_brief","premortem","decision_log","test_adversary","pr_summary","deployment_risk","obligation_tickets"];
  const FORMATS = ["code","patch","json","yaml","markdown","prose"];
  const DEFAULT_ARTIFACTS = ["decision_log","test_adversary"];

  function qstr(s){ return '"'+String(s).replace(/\\/g,"\\\\").replace(/"/g,'\\"')+'"'; }
  function block(key, val, indent){
    const pad=" ".repeat(indent);
    const lines=String(val).replace(/\s+$/,"").split("\n");
    return pad+key+": |\n"+lines.map(l=>pad+"  "+l).join("\n");
  }

  // We emit the keys in the template's order, so a built document reads the
  // same way the annotated template does. An optional block with nothing in it
  // is left out. We always emit the task block, even when every field is
  // blank, and let validate() report what is missing.
  function buildYaml(d){
    const L=[];
    L.push(`schema_version: "1.0"`);
    L.push("");
    L.push("task:");
    ["id","title","author","date"].forEach(k=>{ if(d.task[k]) L.push(`  ${k}: ${qstr(d.task[k])}`); });
    L.push("");
    if(d.preamble){ L.push(block("preamble", d.preamble, 0)); L.push(""); }
    if(d.role.lens || d.role.priorities.length){
      L.push("role:");
      if(d.role.lens) L.push(`  lens: ${qstr(d.role.lens)}`);
      if(d.role.priorities.length){ L.push("  priorities:"); d.role.priorities.forEach(p=>L.push(`    - ${qstr(p)}`)); }
      L.push("");
    }
    if(d.prompt){ L.push(block("prompt", d.prompt, 0)); L.push(""); }
    if(d.constraints.out_of_scope.length || d.constraints.must_not.length){
      L.push("constraints:");
      if(d.constraints.out_of_scope.length){ L.push("  out_of_scope:"); d.constraints.out_of_scope.forEach(x=>L.push(`    - ${qstr(x)}`)); }
      if(d.constraints.must_not.length){ L.push("  must_not:"); d.constraints.must_not.forEach(x=>L.push(`    - ${qstr(x)}`)); }
      L.push("");
    }
    const refs=d.context.references.filter(r=>r.path||r.lines||r.note);
    if(d.context.background || refs.length || d.context.links.length){
      L.push("context:");
      if(d.context.background){ L.push(block("background", d.context.background, 2)); }
      if(refs.length){
        L.push("  references:");
        refs.forEach(r=>{
          L.push(`    - path: ${qstr(r.path)}`);
          if(r.lines) L.push(`      lines: ${qstr(r.lines)}`);
          if(r.note) L.push(`      note: ${qstr(r.note)}`);
        });
      }
      if(d.context.links.length){ L.push("  links:"); d.context.links.forEach(x=>L.push(`    - ${qstr(x)}`)); }
      L.push("");
    }
    const lessons=d.lessons_learned.filter(x=>x.context||x.takeaway);
    if(lessons.length){
      L.push("lessons_learned:");
      lessons.forEach(x=>{ L.push(`  - context: ${qstr(x.context)}`); L.push(`    takeaway: ${qstr(x.takeaway)}`); });
      L.push("");
    }
    L.push("output:");
    if(d.output.format) L.push(`  format: ${qstr(d.output.format)}`);
    if(d.output.destination) L.push(`  destination: ${qstr(d.output.destination)}`);
    if(d.output.structure){ L.push(block("structure", d.output.structure, 2)); }
    L.push("");
    const reqs=d.requirements.filter(r=>r.id||r.statement||r.verify);
    L.push("requirements:");
    reqs.forEach(r=>{
      L.push(`  - id: ${qstr(r.id)}`);
      L.push(`    statement: ${qstr(r.statement)}`);
      L.push(`    verify: ${qstr(r.verify)}`);
    });
    L.push("");
    L.push("protocol:");
    L.push(`  apply: ${d.protocol.apply}`);
    L.push(`  stake_single_recommendation: ${d.protocol.stake_single_recommendation}`);
    L.push(`  log_assumptions: ${d.protocol.log_assumptions}`);
    L.push(`  flag_low_confidence: ${d.protocol.flag_low_confidence}`);
    if(d.protocol.artifacts.length){ L.push("  artifacts:"); d.protocol.artifacts.forEach(a=>L.push(`    - ${a}`)); }
    return L.join("\n").replace(/\n{3,}/g,"\n\n").replace(/\s+$/,"")+"\n";
  }

  // Validation mirrors validate-prompt.py (surfaced as warnings). The Python
  // side is the authoritative rule set, and the parity suite under
  // scripts/tests/ holds the two to the same verdicts and flagged keys
  // (PB-005-validator-parity). Align that side first when the rules change.
  // Mirror of the Python side's nonempty_str. Only a real string with visible
  // content passes, so booleans and whitespace-only values fail.
  function nonemptyStr(v){ return typeof v==="string" && v.trim()!==""; }
  // Mirror of DATE_RE in validate-prompt.py. We check the shape of the date,
  // not the calendar, so Feb 30 passes by contract. Keep the class [0-9] on
  // both sides. Python's \d also matches non-ASCII digits, and the two
  // validators must reject the same strings.
  const DATE_RE=/^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/;
  function validate(d){
    const e=[];
    // The builder only ever writes 1.0, so this check judges imported documents.
    if(d.schema_version!=="1.0") e.push(["schema_version",'must be the string "1.0"']);
    ["id","title","author","date"].forEach(k=>{ if(!nonemptyStr(d.task[k])) e.push([`task.${k}`,"required"]); });
    // We judge the shape only once the field is present, so one document
    // never flags task.date twice.
    if(nonemptyStr(d.task.date) && !DATE_RE.test(d.task.date)) e.push(["task.date","must match YYYY-MM-DD"]);
    if(d.role.priorities.length && !nonemptyStr(d.role.lens)) e.push(["role.lens","required when role is used"]);
    if(!nonemptyStr(d.prompt)) e.push(["prompt","required"]);
    if(typeof d.preamble!=="string") e.push(["preamble","must be plain text"]);
    if(!FORMATS.includes(d.output.format)) e.push(["output.format","pick one of code|patch|json|yaml|markdown|prose"]);
    if(!nonemptyStr(d.output.destination)) e.push(["output.destination","required"]);
    const reqs=d.requirements.filter(r=>r.id||r.statement||r.verify);
    if(reqs.length===0) e.push(["requirements","at least one complete requirement"]);
    reqs.forEach((r,i)=>{ ["id","statement","verify"].forEach(k=>{ if(!nonemptyStr(r[k])) e.push([`requirements[${i}].${k}`,"required within item"]); }); });
    // We index against the full list, not the in-use subset. A filtered index
    // can name the wrong row when a path-only reference sits before the bad one.
    d.context.references.forEach((r,i)=>{ if((nonemptyStr(r.lines)||nonemptyStr(r.note)) && !nonemptyStr(r.path)) e.push([`context.references[${i}].path`,"required when reference is used"]); });
    d.lessons_learned.forEach((x,i)=>{ const any=x.context||x.takeaway; if(any && (!nonemptyStr(x.context)||!nonemptyStr(x.takeaway))) e.push([`lessons_learned[${i}]`,"needs context and takeaway"]); });
    if(typeof d.protocol.apply!=="boolean") e.push(["protocol.apply","must be true or false"]);
    ["stake_single_recommendation","log_assumptions","flag_low_confidence"].forEach(k=>{ if(d.protocol[k]!==undefined && typeof d.protocol[k]!=="boolean") e.push([`protocol.${k}`,"must be true or false"]); });
    if(!Array.isArray(d.protocol.artifacts)) e.push(["protocol.artifacts","must be a list"]);
    else d.protocol.artifacts.forEach(a=>{ if(!ARTIFACTS.includes(a)) e.push(["protocol.artifacts","unknown artifact: "+a]); });
    return e;
  }

  // Minimal block-YAML parser covering the schema this builder emits:
  // nested maps (2-space indent), scalar/quoted/boolean values, block scalars
  // (| literal, > folded), scalar sequences and sequences of scalar-valued maps.
  // Keys are identifiers. When the caller passes an `issues` array, we add a
  // user-facing entry for every construct outside that dialect. Our import
  // contract is that nothing is dropped or altered without being named.
  function parseYAML(text, issues){
    const lines=String(text).replace(/\r\n/g,"\n").replace(/\t/g,"  ").split("\n");
    const N=lines.length; let i=0;
    const indentOf=s=>s.match(/^ */)[0].length;
    const skippable=s=>s.trim()===""||/^\s*#/.test(s);
    const KEY=/^([A-Za-z0-9_]+):(?:\s+(.*)|\s*)$/;
    const note=msg=>{ if(issues) issues.push(msg); };
    // A YAML plain scalar cannot begin with any of these indicators, so a
    // first-character match is always a construct we do not support.
    const CONSTRUCT={"[":"flow sequence","{":"flow mapping","&":"anchor","*":"alias","!":"tag"};
    // We record skipped lines by 1-based number and report them as ranges at the end.
    const dropped=[];

    function noteLine(idx){
      const t=lines[idx].trim();
      if(indentOf(lines[idx])===0&&(t==="---"||t==="...")) note(`line ${idx+1} ("${t}" marker: multi-document streams are unsupported; still read as one document)`);
      else dropped.push(idx+1);
    }
    // YAML ends a plain scalar at the first "#" that follows whitespace. We
    // cut that tail here, before the structural tests, so a block header or
    // an empty value still reads correctly with a comment after it. Quoted
    // values pass through whole, because parseScalar must find the closing
    // quote before any "#" can count as a comment.
    function decomment(s){
      if(s===""||s[0]==='"'||s[0]==="'") return s;
      if(s[0]==="#") return "";
      const m=s.match(/\s#/);
      return m?s.slice(0,m.index).replace(/\s+$/,""):s;
    }
    function parseScalar(s, at){
      let v=s.trim();
      if(v==="") return "";
      // A quoted scalar ends at its closing quote, so a comment can follow it
      // on the same line. We try the whole-value forms first to keep the old
      // behavior, then accept a quoted value with a comment tail.
      if(v[0]==='"'){
        if(v[v.length-1]==='"') return v.slice(1,-1).replace(/\\"/g,'"').replace(/\\\\/g,"\\");
        const qm=v.match(/^"((?:[^"\\]|\\.)*)"\s+#/);
        if(qm) return qm[1].replace(/\\"/g,'"').replace(/\\\\/g,"\\");
      }
      if(v[0]==="'"){
        if(v[v.length-1]==="'") return v.slice(1,-1).replace(/''/g,"'");
        const qm=v.match(/^'((?:[^']|'')*)'\s+#/);
        if(qm) return qm[1].replace(/''/g,"'");
      }
      if(v==="true") return true;
      if(v==="false") return false;
      if(v==="null"||v==="~") return null;
      if(CONSTRUCT[v[0]]) note(`${at} (${CONSTRUCT[v[0]]} is unsupported; value kept as plain text)`);
      return v;
    }
    // We fold ">" blocks the way YAML does. A single break between two equally
    // indented content lines reads as a space. Each blank line reads as a
    // newline. A break beside a more-indented line stays literal, even when a
    // blank run would normally absorb it.
    function foldLines(buf){
      let out=null, blanks=0, prevIndented=false;
      for(let k=0;k<buf.length;k++){
        const line=buf[k];
        if(line===""){ blanks++; continue; }
        const ind=line[0]===" ";
        if(out===null) out="\n".repeat(blanks)+line;
        else if(blanks>0) out+="\n".repeat(blanks+((ind||prevIndented)?1:0))+line;
        else out+=((ind||prevIndented)?"\n":" ")+line;
        blanks=0; prevIndented=ind;
      }
      return out===null?"":out;
    }
    function parseBlockScalar(parentIndent, header, at){
      // A "+" indicator asks us to keep trailing newlines. No builder field can
      // hold them, so we report the dropped intent instead of losing it silently.
      if(header.indexOf("+")>=0) note(`${at} ("+" chomping is unsupported; trailing newlines dropped)`);
      const buf=[]; let blockIndent=null;
      while(i<N){
        if(lines[i].trim()===""){ buf.push(""); i++; continue; }
        const ci=indentOf(lines[i]);
        // The block ends at the first line less indented than its own first
        // line, not just at the parent's level. Without this check we would
        // swallow a sibling key between the two levels and mangle it in the
        // slice below.
        if(ci<=parentIndent||(blockIndent!==null&&ci<blockIndent)) break;
        if(blockIndent===null) blockIndent=ci;
        buf.push(lines[i].slice(blockIndent)); i++;
      }
      while(buf.length&&buf[buf.length-1]==="") buf.pop();
      return header[0]===">" ? foldLines(buf) : buf.join("\n");
    }
    function parseNodeDeeper(parentIndent, at){
      let j=i; while(j<N&&skippable(lines[j])) j++;
      if(j>=N) return null;
      const ci=indentOf(lines[j]); if(ci<=parentIndent) return null;
      i=j; const body=lines[i].slice(ci);
      return (body[0]==="-"&&(body.length===1||body[1]===" ")) ? parseSeq(ci, at) : parseMap(ci, at);
    }
    function parseMap(indent, at){
      const obj={};
      while(i<N){
        if(skippable(lines[i])){ i++; continue; }
        const ci=indentOf(lines[i]); if(ci<indent) break; if(ci>indent){ noteLine(i); i++; continue; }
        const m=lines[i].slice(indent).match(KEY); if(!m){ noteLine(i); i++; continue; }
        const key=m[1]; const rest=decomment(m[2]!==undefined?m[2]:""); const kp=at?at+"."+key:key;
        if(/^[|>][+-]?$/.test(rest)){ i++; obj[key]=parseBlockScalar(indent, rest, kp); }
        else if(rest===""){ i++; obj[key]=parseNodeDeeper(indent, kp); }
        else { obj[key]=parseScalar(rest, kp); i++; }
      }
      return obj;
    }
    function parseSeq(indent, at){
      const arr=[];
      while(i<N){
        if(skippable(lines[i])){ i++; continue; }
        const ci=indentOf(lines[i]); if(ci<indent) break; if(ci>indent){ noteLine(i); i++; continue; }
        const body=lines[i].slice(ci);
        if(body[0]!=="-"||(body.length>1&&body[1]!==" ")) break;
        const ip=at+"["+arr.length+"]";
        if(body==="-"){ i++; arr.push(parseNodeDeeper(ci, ip)); continue; }
        const after=body.slice(1).replace(/^\s+/,"");
        const itemIndent=ci+(body.length-after.length);
        const km=(after[0]!=='"'&&after[0]!=="'")?after.match(KEY):null;
        if(km){
          const obj={}; const key=km[1]; const rest=decomment(km[2]!==undefined?km[2]:"");
          if(/^[|>][+-]?$/.test(rest)){ i++; obj[key]=parseBlockScalar(itemIndent-1, rest, ip+"."+key); }
          else if(rest===""){ i++; obj[key]=parseNodeDeeper(itemIndent-1, ip+"."+key); }
          else { obj[key]=parseScalar(rest, ip+"."+key); i++; }
          while(i<N){
            if(skippable(lines[i])){ i++; continue; }
            if(indentOf(lines[i])!==itemIndent) break;
            const m2=lines[i].slice(itemIndent).match(KEY); if(!m2) break;
            const k2=m2[1]; const r2=decomment(m2[2]!==undefined?m2[2]:"");
            if(/^[|>][+-]?$/.test(r2)){ i++; obj[k2]=parseBlockScalar(itemIndent, r2, ip+"."+k2); }
            else if(r2===""){ i++; obj[k2]=parseNodeDeeper(itemIndent, ip+"."+k2); }
            else { obj[k2]=parseScalar(r2, ip+"."+k2); i++; }
          }
          arr.push(obj);
        } else { arr.push(parseScalar(decomment(after), ip)); i++; }
      }
      return arr;
    }
    while(i<N&&skippable(lines[i])) i++;
    // A leading document marker is ordinary in single-document YAML, so we
    // skip it without a report.
    if(i<N&&lines[i].trim()==="---") i++;
    while(i<N&&skippable(lines[i])) i++;
    if(i>=N) return {};
    const doc=parseMap(indentOf(lines[i]), "");
    if(dropped.length){
      // We coalesce consecutive skipped lines so one dropped region does not
      // flood the report with an entry per line.
      const runs=[];
      dropped.forEach(n=>{ const r=runs[runs.length-1]; if(r&&n===r[1]+1) r[1]=n; else runs.push([n,n]); });
      runs.forEach(r=>note((r[0]===r[1]?`line ${r[0]}`:`lines ${r[0]}-${r[1]}`)+" skipped (not recognized as part of any field)"));
    }
    return doc;
  }

  /* A status pill is re-reported far more often than it changes, and assistive
     technology should only hear transitions. This factory owns that rule. The
     caller reports the current status value on every render, and we speak only
     when the settled value differs from the last spoken one. The first report
     seeds the baseline silently, so a page load or a draft restore never
     announces the state it opened with. Values compare by strict equality, so
     the builder's issue counts and the viewer's source states both work. We
     take the timer functions and the wording as options, so tests can drive
     the clock and each page speaks its own states. */
  function createStatusAnnouncer(opts){
    const say=opts.say;
    const debounceMs=opts.debounceMs;
    const setT=opts.setTimeout||setTimeout;
    const clearT=opts.clearTimeout||clearTimeout;
    // Without a format option we keep the builder's wording, mirroring its
    // visual pill. If the pill wording in prompt-builder.html changes, change
    // this default with it.
    const format=opts.format||function(count){
      return count===0 ? "Valid" : count+" "+(count===1?"issue":"issues");
    };
    let seeded=false, spoken=null, timer=null;
    return function report(value){
      if(!seeded){ seeded=true; spoken=value; return; }
      clearT(timer);
      timer=setT(function(){
        timer=null;
        if(value===spoken) return;
        spoken=value;
        say(format(value));
      }, debounceMs);
    };
  }

  const ADPPromptLib={parseYAML,buildYaml,validate,createStatusAnnouncer,ARTIFACTS,FORMATS,DEFAULT_ARTIFACTS};
  if(typeof module!=="undefined"&&module.exports){ module.exports=ADPPromptLib; }
  else{ global.ADPPromptLib=ADPPromptLib; }
})(typeof globalThis!=="undefined"?globalThis:this);
