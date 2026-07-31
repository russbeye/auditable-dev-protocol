/* adp-prompt-lib.js — shared pure logic for the ADP prompt builder.
   parseYAML, buildYaml, validate and the shared constants, extracted verbatim
   from prompt-builder.html (PB-002-extract-prompt-lib). Exposed as one
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

  // Build YAML in template key order. Omit empty optional blocks.
  function buildYaml(d){
    const L=[];
    L.push(`schema_version: "1.0"`);
    L.push("");
    // task (always emit; warnings handle empties) — emit only non-empty keys
    L.push("task:");
    ["id","title","author","date"].forEach(k=>{ if(d.task[k]) L.push(`  ${k}: ${qstr(d.task[k])}`); });
    L.push("");
    if(d.preamble){ L.push(block("preamble", d.preamble, 0)); L.push(""); }
    // role (optional)
    if(d.role.lens || d.role.priorities.length){
      L.push("role:");
      if(d.role.lens) L.push(`  lens: ${qstr(d.role.lens)}`);
      if(d.role.priorities.length){ L.push("  priorities:"); d.role.priorities.forEach(p=>L.push(`    - ${qstr(p)}`)); }
      L.push("");
    }
    if(d.prompt){ L.push(block("prompt", d.prompt, 0)); L.push(""); }
    // constraints (optional)
    if(d.constraints.out_of_scope.length || d.constraints.must_not.length){
      L.push("constraints:");
      if(d.constraints.out_of_scope.length){ L.push("  out_of_scope:"); d.constraints.out_of_scope.forEach(x=>L.push(`    - ${qstr(x)}`)); }
      if(d.constraints.must_not.length){ L.push("  must_not:"); d.constraints.must_not.forEach(x=>L.push(`    - ${qstr(x)}`)); }
      L.push("");
    }
    // context (optional)
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
    // lessons (optional)
    const lessons=d.lessons_learned.filter(x=>x.context||x.takeaway);
    if(lessons.length){
      L.push("lessons_learned:");
      lessons.forEach(x=>{ L.push(`  - context: ${qstr(x.context)}`); L.push(`    takeaway: ${qstr(x.takeaway)}`); });
      L.push("");
    }
    // output
    L.push("output:");
    if(d.output.format) L.push(`  format: ${qstr(d.output.format)}`);
    if(d.output.destination) L.push(`  destination: ${qstr(d.output.destination)}`);
    if(d.output.structure){ L.push(block("structure", d.output.structure, 2)); }
    L.push("");
    // requirements
    const reqs=d.requirements.filter(r=>r.id||r.statement||r.verify);
    L.push("requirements:");
    reqs.forEach(r=>{
      L.push(`  - id: ${qstr(r.id)}`);
      L.push(`    statement: ${qstr(r.statement)}`);
      L.push(`    verify: ${qstr(r.verify)}`);
    });
    L.push("");
    // protocol
    L.push("protocol:");
    L.push(`  apply: ${d.protocol.apply}`);
    L.push(`  stake_single_recommendation: ${d.protocol.stake_single_recommendation}`);
    L.push(`  log_assumptions: ${d.protocol.log_assumptions}`);
    L.push(`  flag_low_confidence: ${d.protocol.flag_low_confidence}`);
    if(d.protocol.artifacts.length){ L.push("  artifacts:"); d.protocol.artifacts.forEach(a=>L.push(`    - ${a}`)); }
    return L.join("\n").replace(/\n{3,}/g,"\n\n").replace(/\s+$/,"")+"\n";
  }

  // Validation mirrors validate-prompt.py (surfaced as warnings)
  function validate(d){
    const e=[];
    ["id","title","author","date"].forEach(k=>{ if(!d.task[k]) e.push([`task.${k}`,"required"]); });
    if(d.role.priorities.length && !d.role.lens) e.push(["role.lens","required when role is used"]);
    if(!d.prompt) e.push(["prompt","required"]);
    if(!FORMATS.includes(d.output.format)) e.push(["output.format","pick one of code|patch|json|yaml|markdown|prose"]);
    if(!d.output.destination) e.push(["output.destination","required"]);
    const reqs=d.requirements.filter(r=>r.id||r.statement||r.verify);
    if(reqs.length===0) e.push(["requirements","at least one complete requirement"]);
    reqs.forEach((r,i)=>{ ["id","statement","verify"].forEach(k=>{ if(!r[k]) e.push([`requirements[${i}].${k}`,"required within item"]); }); });
    d.context.references.filter(r=>r.lines||r.note).forEach((r,i)=>{ if(!r.path) e.push([`context.references[${i}].path`,"required when reference is used"]); });
    d.lessons_learned.forEach((x,i)=>{ const any=x.context||x.takeaway; if(any && (!x.context||!x.takeaway)) e.push([`lessons_learned[${i}]`,"needs context and takeaway"]); });
    return e;
  }

  // Minimal block-YAML parser covering the schema this builder emits:
  // nested maps (2-space indent), scalar/quoted/boolean values, block scalars (|),
  // scalar sequences and sequences of scalar-valued maps. Keys are identifiers.
  function parseYAML(text){
    const lines=String(text).replace(/\r\n/g,"\n").replace(/\t/g,"  ").split("\n");
    const N=lines.length; let i=0;
    const indentOf=s=>s.match(/^ */)[0].length;
    const skippable=s=>s.trim()===""||/^\s*#/.test(s);
    const KEY=/^([A-Za-z0-9_]+):(?:\s+(.*)|\s*)$/;

    function parseScalar(s){
      let v=s.trim();
      if(v==="") return "";
      if(v[0]==='"'&&v[v.length-1]==='"') return v.slice(1,-1).replace(/\\"/g,'"').replace(/\\\\/g,"\\");
      if(v[0]==="'"&&v[v.length-1]==="'") return v.slice(1,-1).replace(/''/g,"'");
      if(v==="true") return true;
      if(v==="false") return false;
      if(v==="null"||v==="~") return null;
      return v;
    }
    function parseBlockScalar(parentIndent){
      const buf=[]; let blockIndent=null;
      while(i<N){
        if(lines[i].trim()===""){ buf.push(""); i++; continue; }
        const ci=indentOf(lines[i]);
        if(ci<=parentIndent) break;
        if(blockIndent===null) blockIndent=ci;
        buf.push(lines[i].slice(blockIndent)); i++;
      }
      while(buf.length&&buf[buf.length-1]==="") buf.pop();
      return buf.join("\n");
    }
    function parseNodeDeeper(parentIndent){
      let j=i; while(j<N&&skippable(lines[j])) j++;
      if(j>=N) return null;
      const ci=indentOf(lines[j]); if(ci<=parentIndent) return null;
      i=j; const body=lines[i].slice(ci);
      return (body[0]==="-"&&(body.length===1||body[1]===" ")) ? parseSeq(ci) : parseMap(ci);
    }
    function parseMap(indent){
      const obj={};
      while(i<N){
        if(skippable(lines[i])){ i++; continue; }
        const ci=indentOf(lines[i]); if(ci<indent) break; if(ci>indent){ i++; continue; }
        const m=lines[i].slice(indent).match(KEY); if(!m){ i++; continue; }
        const key=m[1]; const rest=m[2]!==undefined?m[2]:"";
        if(/^[|>][+-]?$/.test(rest)){ i++; obj[key]=parseBlockScalar(indent); }
        else if(rest===""){ i++; obj[key]=parseNodeDeeper(indent); }
        else { obj[key]=parseScalar(rest); i++; }
      }
      return obj;
    }
    function parseSeq(indent){
      const arr=[];
      while(i<N){
        if(skippable(lines[i])){ i++; continue; }
        const ci=indentOf(lines[i]); if(ci<indent) break; if(ci>indent){ i++; continue; }
        const body=lines[i].slice(ci);
        if(body[0]!=="-"||(body.length>1&&body[1]!==" ")) break;
        if(body==="-"){ i++; arr.push(parseNodeDeeper(ci)); continue; }
        const after=body.slice(1).replace(/^\s+/,"");
        const itemIndent=ci+(body.length-after.length);
        const km=(after[0]!=='"'&&after[0]!=="'")?after.match(KEY):null;
        if(km){
          const obj={}; const key=km[1]; const rest=km[2]!==undefined?km[2]:"";
          if(/^[|>][+-]?$/.test(rest)){ i++; obj[key]=parseBlockScalar(itemIndent-1); }
          else if(rest===""){ i++; obj[key]=parseNodeDeeper(itemIndent-1); }
          else { obj[key]=parseScalar(rest); i++; }
          while(i<N){
            if(skippable(lines[i])){ i++; continue; }
            if(indentOf(lines[i])!==itemIndent) break;
            const m2=lines[i].slice(itemIndent).match(KEY); if(!m2) break;
            const k2=m2[1]; const r2=m2[2]!==undefined?m2[2]:"";
            if(/^[|>][+-]?$/.test(r2)){ i++; obj[k2]=parseBlockScalar(itemIndent); }
            else if(r2===""){ i++; obj[k2]=parseNodeDeeper(itemIndent); }
            else { obj[k2]=parseScalar(r2); i++; }
          }
          arr.push(obj);
        } else { arr.push(parseScalar(after)); i++; }
      }
      return arr;
    }
    while(i<N&&skippable(lines[i])) i++;
    if(i>=N) return {};
    return parseMap(indentOf(lines[i]));
  }

  const ADPPromptLib={parseYAML,buildYaml,validate,ARTIFACTS,FORMATS,DEFAULT_ARTIFACTS};
  if(typeof module!=="undefined"&&module.exports){ module.exports=ADPPromptLib; }
  else{ global.ADPPromptLib=ADPPromptLib; }
})(typeof globalThis!=="undefined"?globalThis:this);
