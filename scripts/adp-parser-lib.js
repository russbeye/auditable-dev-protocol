/* adp-parser-lib.js — shared pure rendering logic for the ADP artifact
   viewer. The markdown renderer, the section splitter with its key dedupe,
   and the decision-log card pipeline, extracted from ADP-Parser.html.
   Exposed as one namespace: the browser global `ADPParserLib` via a plain
   <script> tag, or `module.exports` under Node
   (`require("./adp-parser-lib.js")`). No dependencies, no build step. */
(function(global){
  "use strict";

  /* =========================================================
     Hand-rolled markdown renderer (artifact subset)
     ========================================================= */
  function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
  // esc leaves double quotes alone, which is fine for element content. A
  // value inside a quoted attribute needs them escaped too, or a document
  // title could close the attribute early.
  function escAttr(s){return esc(s).replace(/"/g,'&quot;');}

  // We never let a document-controlled URL become an anchor unless its scheme
  // is on this list. Anything else degrades to visible text. If a legitimate
  // new scheme turns up, add it here.
  const LINK_SCHEMES=['http','https','mailto'];
  // We test the URL as it will sit inside the href attribute. A double quote
  // would close the attribute and plant a live event handler. A C0 control
  // character can hide a scheme, because the browser strips those before it
  // parses the URL. The control class also catches code-span placeholders,
  // whose restored content would re-enter the attribute unescaped. A URL with
  // no scheme is a relative path or a #fragment, and those stay clickable.
  function safeLinkUrl(url){
    if(/[\u0000-\u001f\u007f"]/.test(url)) return false;
    const m=/^([a-z][a-z0-9+.-]*):/i.exec(url);
    return !m || LINK_SCHEMES.includes(m[1].toLowerCase());
  }

  // We escape the text first, so callers pass raw document text and never
  // markup we already built. Code spans come out before the other rules run,
  // because their contents must stay literal. Each one leaves a NUL-wrapped
  // index behind and goes back in at the end.
  function inline(s){
    let t = esc(s);
    const codes=[];
    t = t.replace(/`([^`]+)`/g,(m,c)=>{codes.push(c);return '\u0000'+(codes.length-1)+'\u0000';});
    // We only build the anchor when safeLinkUrl passes. A rejected run stays
    // in place as escaped plain text, so nothing silently vanishes.
    t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g,(m,txt,url)=>safeLinkUrl(url)
      ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${txt}</a>`
      : m);
    t = t.replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>');
    t = t.replace(/__([^_]+)__/g,'<strong>$1</strong>');
    t = t.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g,'$1<em>$2</em>');
    t = t.replace(/\u0000(\d+)\u0000/g,(m,i)=>`<code>${esc(codes[+i])}</code>`);
    return t;
  }
  // We wrap free-standing status keywords in pills. The input is HTML we
  // already rendered, so we lift each tag into a placeholder before the
  // scan and restore it after. That keeps pills out of attribute text,
  // where an href can carry a path segment like /HIGH. The guard leaves a
  // keyword plain inside a word, directly after a tag, and inside double
  // quotes. A slash is prose, so VALIDATED/INVALIDATED pills both words.
  function decorate(html){
    const tags=[];
    let t = html.replace(/<[^>]*>/g,m=>{tags.push(m);return '\u0000'+(tags.length-1)+'\u0000';});
    t = t.replace(/(^|[^A-Za-z0-9_"\u0000])(INVALIDATED|VALIDATED|UNOBSERVABLE|UNKNOWN|PENDING|MEDIUM|MED|HIGH|OPEN|LOW)\b/g,
      (m,pre,w)=>pre+`<span class="pill ${TOK[w]}">${w}</span>`);
    return t.replace(/\u0000(\d+)\u0000/g,(m,i)=>tags[+i]);
  }
  // UNKNOWN and UNOBSERVABLE both mean the observability is absent, so they
  // share one hue. PENDING is a promised mitigation that has not landed, which
  // is outstanding work, so it reads amber the way OPEN does. The corpus
  // abbreviates MEDIUM to MED, so both spell the same hue.
  const TOK={HIGH:'p-high',MEDIUM:'p-med',MED:'p-med',LOW:'p-low','H':'p-high','M':'p-med','L':'p-low',
             OPEN:'p-open',VALIDATED:'p-ok',INVALIDATED:'p-bad',YES:'p-ok',NO:'p-bad','N/A':'p-low',
             UNKNOWN:'p-unk',UNOBSERVABLE:'p-unk',PENDING:'p-open'};

  function isTableStart(lines,i){
    return lines[i] && lines[i].indexOf('|')>-1 && i+1<lines.length
      && /-/.test(lines[i+1]) && /^[\s|:\-]+$/.test(lines[i+1]) && lines[i+1].indexOf('|')>-1;
  }
  function isBlockStart(lines,i){
    if(i>=lines.length) return true;
    const l=lines[i];
    if(/^\s*$/.test(l)) return true;
    if(/^\s*```/.test(l)) return true;
    if(/^#{1,6}\s/.test(l)) return true;
    if(/^\s*([-*+]|\d+\.)\s+/.test(l)) return true;
    if(/^\s*>/.test(l)) return true;
    if(/^\s*([-*_])\1{2,}\s*$/.test(l)) return true;
    if(isTableStart(lines,i)) return true;
    return false;
  }

  // A pipe inside a paired code span is cell content, not a boundary. We
  // find the spans with the same pattern that inline() pairs with, so the
  // split and the rendering agree on which backticks pair. We slice each
  // cell out of the original row and rewrite nothing, which keeps every
  // byte intact. Note: the edge trims may run before the span scan. A
  // character inside a span has a backtick on each side, so the row never
  // starts or ends inside one.
  function splitRow(r){
    const t=r.trim().replace(/^\|/,'').replace(/\|$/,'');
    const spans=[]; const re=/`[^`]+`/g; let m;
    while((m=re.exec(t))) spans.push([m.index,m.index+m[0].length]);
    const cells=[]; let start=0;
    for(let i=0;i<t.length;i++){
      if(t[i]==='|' && !spans.some(([a,b])=>a<i&&i<b)){cells.push(t.slice(start,i));start=i+1;}
    }
    cells.push(t.slice(start));
    return cells.map(c=>c.trim());
  }
  function cell(c){
    const key=c.trim().toUpperCase();
    if(TOK[key]) return `<span class="pill ${TOK[key]}">${esc(c.trim())}</span>`;
    return decorate(inline(c));
  }
  function renderTable(rows){
    const head=splitRow(rows[0]);
    const body=rows.slice(2).filter(r=>r.indexOf('|')>-1).map(splitRow);
    const th=head.map(h=>`<th>${decorate(inline(h))}</th>`).join('');
    const trs=body.map(r=>`<tr>${head.map((_,j)=>`<td>${cell(r[j]!=null?r[j]:'')}</td>`).join('')}</tr>`).join('');
    return `<div class="tbl-wrap"><table class="md-tbl"><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table></div>`;
  }

  function renderList(lines,start){
    let i=start; const ordered=/^\s*\d+\.\s/.test(lines[i]); const items=[];
    const startNum=ordered?parseInt(lines[start].match(/^\s*(\d+)\./)[1],10):1;
    while(i<lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])){
      let content=lines[i].replace(/^\s*([-*+]|\d+\.)\s+/,''); i++;
      while(i<lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*+]|\d+\.)\s+/.test(lines[i])){
        content+=' '+lines[i].trim(); i++;
      }
      items.push(content);
      // A blank line inside a list separates items, the way authors write
      // multi-sentence lists. We continue past the blanks only into an item
      // of the same kind, because a kind change or prose starts a new block.
      let j=i; while(j<lines.length && /^\s*$/.test(lines[j])) j++;
      if(j>i && j<lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[j]) && /^\s*\d+\.\s/.test(lines[j])===ordered) i=j;
    }
    const lis=items.map(c=>{
      const cb=c.match(/^\[([ xX])\]\s+([\s\S]*)$/);
      if(cb){const on=cb[1].toLowerCase()==='x';
        return `<li class="task"><span class="cbx ${on?'on':''}">${on?'✓':''}</span><span>${decorate(inline(cb[2]))}</span></li>`;}
      return `<li>${decorate(inline(c))}</li>`;
    }).join('');
    // The theme numbers items with a CSS counter, not native markers, so a
    // start attribute would do nothing. An inline reset is the one override
    // the counter honors, and only a list that opens past 1 needs it.
    const startStyle=startNum>1?` style="counter-reset:li ${startNum-1}"`:'';
    return {html:`<${ordered?'ol':'ul'} class="md-list"${startStyle}>${lis}</${ordered?'ol':'ul'}>`,next:i};
  }

  function subHead(s){
    const m=s.match(/^\[([^\]]+)\]\s*([\s\S]*)$/);
    if(m) return `<span class="idbadge">${esc(m[1])}</span> <span>${decorate(inline(m[2]))}</span>`;
    return decorate(inline(s));
  }

  function renderMarkdown(md){
    const lines=String(md).replace(/\r\n/g,'\n').replace(/\t/g,'  ').split('\n');
    let html=''; let i=0;
    while(i<lines.length){
      const line=lines[i];
      if(/^\s*$/.test(line)){i++;continue;}
      if(/^\s*```/.test(line)){
        const buf=[]; i++;
        while(i<lines.length && !/^\s*```/.test(lines[i])){buf.push(lines[i]);i++;}
        i++; html+=`<pre class="cb"><code>${esc(buf.join('\n'))}</code></pre>`; continue;
      }
      let hm=line.match(/^(#{1,6})\s+(.*)$/);
      if(hm){ const lvl=Math.min(6,Math.max(3,hm[1].length)); html+=`<h${lvl} class="sub">${subHead(hm[2].trim())}</h${lvl}>`; i++; continue; }
      if(/^\s*([-*_])\1{2,}\s*$/.test(line)){html+='<hr>';i++;continue;}
      if(isTableStart(lines,i)){
        const tbl=[]; while(i<lines.length && lines[i].indexOf('|')>-1 && !/^\s*$/.test(lines[i])){tbl.push(lines[i]);i++;}
        html+=renderTable(tbl); continue;
      }
      if(/^\s*>/.test(line)){
        const buf=[]; while(i<lines.length && /^\s*>/.test(lines[i])){buf.push(lines[i].replace(/^\s*>\s?/,''));i++;}
        html+=`<blockquote>${renderMarkdown(buf.join('\n'))}</blockquote>`; continue;
      }
      if(/^\s*([-*+]|\d+\.)\s+/.test(line)){ const r=renderList(lines,i); html+=r.html; i=r.next; continue; }
      const buf=[lines[i]]; i++;
      while(i<lines.length && !isBlockStart(lines,i)){buf.push(lines[i]);i++;}
      html+=`<p>${buf.map(l=>decorate(inline(l))).join('<br>')}</p>`;
    }
    return html;
  }

  /* =========================================================
     Section splitter + artifact registry
     ========================================================= */
  const ART=[
    {re:/problem statement/i,            icon:'◎', tag:'P1'},
    {re:/knowledge gap/i,                icon:'◫', tag:'P2'},
    {re:/open questions/i,               icon:'?', tag:'P2'},
    {re:/recommendation brief/i,         icon:'◆', tag:'P3'},
    {re:/pre-?mortem/i,                  icon:'⚠', tag:'P4'},
    {re:/implementation authorization/i, icon:'⊞', tag:'P4'},
    {re:/decision log/i,                 icon:'⎇', tag:'P5', spine:true},
    {re:/test adversary/i,               icon:'⊗', tag:'P6'},
    {re:/mandatory review/i,             icon:'🚩', tag:'P7', alert:true},
    {re:/residual risk/i,                icon:'◬', tag:'P7'},
    {re:/test coverage gaps/i,           icon:'▤', tag:'P6'},
    {re:/pr summary/i,                   icon:'⇡', tag:'P7'},
    {re:/deployment risk/i,              icon:'⟲', tag:'P8'},
    {re:/obligation ticket/i,            icon:'✓', tag:'P9'},
    // Other corpora title their sections "Phase N: <name>" instead of using
    // the artifact names. These rows sit after the artifact rows, so an
    // artifact name inside such a title still wins the tie on the same phase.
    {re:/^phase\s*1\s*:/i,               icon:'◎', tag:'P1'},
    {re:/^phase\s*2\s*:/i,               icon:'◫', tag:'P2'},
    {re:/^phase\s*3\s*:/i,               icon:'◆', tag:'P3'},
    {re:/^phase\s*4\s*:/i,               icon:'⚠', tag:'P4'},
    {re:/^phase\s*5\s*:/i,               icon:'⎇', tag:'P5', spine:true},
    {re:/^phase\s*6\s*:/i,               icon:'⊗', tag:'P6'},
    {re:/^phase\s*7\s*:/i,               icon:'⇡', tag:'P7'},
    {re:/^phase\s*8\s*:/i,               icon:'⟲', tag:'P8'},
    {re:/^phase\s*9\s*:/i,               icon:'✓', tag:'P9'}
  ];
  function metaFor(title){ for(const a of ART) if(a.re.test(title)) return a; return {icon:'§',tag:''}; }

  /* A declared lifecycle block is YAML front matter at byte 0. We only strip
     the opener when a closing bare --- line exists and every interior line is
     blank or a key: value pair. Anything else stays document content, so a
     file that opens with a horizontal rule keeps its text. */
  function splitFrontMatter(md){
    const text=String(md).replace(/\r\n/g,'\n');
    if(text.slice(0,4)!=='---\n') return {front:null, rest:text};
    const lines=text.split('\n');
    for(let i=1;i<lines.length;i++){
      if(lines[i]==='---'){
        const inner=lines.slice(1,i);
        if(inner.every(l=>/^\s*$/.test(l)||/^[A-Za-z_][A-Za-z0-9_-]*\s*:/.test(l))){
          return {front:inner.join('\n'), rest:lines.slice(i+1).join('\n')};
        }
        return {front:null, rest:text};
      }
    }
    return {front:null, rest:text};
  }

  function parseSections(md){
    const fm=splitFrontMatter(md);
    const lines=fm.rest.split('\n');
    const secs=[]; let cur=null; const intro=[];
    let inFence=false;
    for(const line of lines){
      if(/^\s*```/.test(line)) inFence=!inFence;
      const m=!inFence && line.match(/^##\s+(.*)$/);
      if(m){ if(cur) secs.push(cur); cur={title:m[1].trim(), body:[]}; }
      else if(cur) cur.body.push(line);
      else intro.push(line);
    }
    if(cur) secs.push(cur);
    return {front:fm.front, intro:intro.join('\n').trim(), secs};
  }

  function slug(s){return 'sec-'+(s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,42)||'x');}

  /* render() derives each section element's id from its title. We compute the
     whole key list here so the dedupe rule stays testable on its own. A
     repeated title takes a numeric suffix, counted per base slug in document
     order. */
  function sectionKeys(secs){
    const seen={};
    return secs.map(sec=>{
      let key=slug(sec.title);
      if(seen[key]!=null){ key=key+'-'+(++seen[key]); } else seen[key]=0;
      return key;
    });
  }

  /* =========================================================
     Decision Log "ledger card" rendering (the spine)
     ========================================================= */
  function parseDLFields(lines){
    const fields=[]; let cur=null;
    for(const raw of lines){
      const line=raw.replace(/\s+$/,'');
      if(/^\s*$/.test(line)) continue;
      const m=line.match(/^\s*[-*+]?\s*\*\*\s*([^*]+?)\s*\*\*\s*:?\s*(.*)$/);
      if(m){ cur={label:m[1].trim().replace(/:\s*$/,''), value:m[2].trim()}; fields.push(cur); }
      else if(cur){ cur.value += ' ' + line.trim(); }
      else fields.push({label:'', value:line.trim()});
    }
    return fields;
  }
  /* We keep the header chips single-word. The chip shows the leading keyword,
     and the prose after the first separator run (dash, colon, or whitespace)
     moves into the card grid as a labelled note row. We demote the evidence
     instead of dropping it. */
  function dlChipSplit(v){
    const m=v.trim().match(/^[\s:—–-]*([^\s:—–-]+)(?:[\s:—–-]+([\s\S]*))?$/);
    return m?{word:m[1],tail:(m[2]||'').trim()}:{word:v.trim(),tail:''};
  }
  /* A value that opens with no known keyword has no keyword to stand for it.
     So we demote the whole value, not just the tail. A bare single word cuts
     nothing and gets no note. */
  function dlChip(kind,cls,known,v){
    const s=dlChipSplit(v);
    return {
      html:`<span class="pill dl-pill ${cls}"><i>${kind}</i>${esc(s.word)}</span>`,
      note: known ? s.tail : (s.tail ? v.trim() : '')
    };
  }
  /* Note: both class matches stay on the full value, not the split word, so
     no existing document changes chip class or rail. */
  /* The one confidence classifier, the twin of dlStatusKind below. The pill,
     the decisions panel's class column, and the sort rank all read a
     harvested confidence through this prefix match, and because it returns a
     closed enum, a document's value can pick a style but never write into
     the attribute that carries it. */
  function dlConfKind(v){
    const t=String(v==null?'':v).trim().toUpperCase();
    if(t.indexOf('HIGH')===0) return 'high';
    if(t.indexOf('MED')===0) return 'medium';
    if(t.indexOf('LOW')===0) return 'low';
    return 'other';
  }
  function dlConfPill(v){
    const cls={high:'p-ok',medium:'p-med',low:'p-high',other:'p-low'}[dlConfKind(v)];
    return dlChip('conf',cls,cls!=='p-low',v);
  }
  /* The one status classifier. The rail, the status chip, and the audit
     counts all read a card's status through this prefix match, so they can
     never disagree about what a status means. If you add a status keyword,
     add it here and nowhere else. */
  function dlStatusKind(v){
    const t=String(v==null?'':v).trim().toUpperCase();
    if(t.indexOf('INVALIDATED')===0) return 'invalidated';
    if(t.indexOf('VALIDATED')===0) return 'validated';
    if(t.indexOf('OPEN')===0) return 'open';
    if(t.indexOf('UNKNOWN')===0) return 'unknown';
    return 'other';
  }
  function dlStatusPill(v){
    const cls={invalidated:'p-bad',validated:'p-ok',open:'p-open',unknown:'p-unk',other:'p-low'}[dlStatusKind(v)];
    return dlChip('status',cls,cls!=='p-low',v);
  }
  function dlRail(status){
    return {invalidated:'rail-bad',validated:'rail-ok',open:'rail-open',unknown:'rail-unk',other:''}[dlStatusKind(status)];
  }
  /* Field values are plain wrapped prose. A blockquote or fenced block inside
     an entry is card material, not part of the field above it, so we cut the
     field region at the first block line and hand the rest back separately.
     Without the cut, a gate confirmation quoted after the last field rides
     into that field's value. */
  function dlSplitBody(lines){
    for(let i=0;i<lines.length;i++){
      if(/^\s*(```|>)/.test(lines[i])){
        return {fieldLines:lines.slice(0,i), trailing:lines.slice(i).join('\n').trim()};
      }
    }
    return {fieldLines:lines, trailing:''};
  }

  function renderDLCard(entry){
    const hm=entry.head.match(/^\[([^\]]+)\]\s*([\s\S]*)$/);
    const id=hm?hm[1].trim():''; const title=hm?hm[2].trim():entry.head;
    const split=dlSplitBody(entry.lines);
    const fields=parseDLFields(split.fieldLines);
    let confidence='', status=''; const body=[];
    for(const f of fields){
      const k=f.label.toLowerCase();
      if(k==='confidence'){ confidence=f.value; continue; }
      if(k==='status'){ status=f.value; continue; }
      body.push(f);
    }
    const conf=confidence?dlConfPill(confidence):null;
    const stat=status?dlStatusPill(status):null;
    // We append the note rows after the author's fields so the pill order
    // and the field order both stay unchanged.
    if(conf&&conf.note) body.push({label:'confidence note',value:conf.note});
    if(stat&&stat.note) body.push({label:'status note',value:stat.note});
    const pills=(conf?conf.html:'')+(stat?stat.html:'');
    const grid=body.map(f=>
      `<div class="dl-row"><span class="dl-k">${esc(f.label)}</span><span class="dl-v">${decorate(inline(f.value))}</span></div>`
    ).join('');
    // Trailing block material renders as markdown below the grid, so a quote
    // or code block stays readable instead of flattening into a field row.
    const trail=split.trailing?`<div class="md dl-trail">${renderMarkdown(split.trailing)}</div>`:'';
    return `<div class="dl-card ${dlRail(status)}">
      <div class="dl-head">
        <span class="dl-id">${id?esc(id):'—'}</span>
        <span class="dl-title">${decorate(inline(title))}</span>
        <span class="dl-pills">${pills}</span>
      </div>
      ${grid?`<div class="dl-grid">${grid}</div>`:''}${trail}
    </div>`;
  }
  /* We split a section body into pre-entry prose and ### entries in one
     place, because renderDecisionLog and the audit counts must see the same
     cards. A fenced ### line stays inside its code block. */
  function parseDLEntries(body){
    const lines=String(body).replace(/\r\n/g,'\n').split('\n');
    const entries=[]; const pre=[]; let cur=null; let inFence=false;
    for(const line of lines){
      if(/^\s*```/.test(line)) inFence=!inFence;
      const m=!inFence && line.match(/^###\s+(.*)$/);
      if(m){ if(cur) entries.push(cur); cur={head:m[1].trim(), lines:[]}; }
      else if(cur) cur.lines.push(line);
      else pre.push(line);
    }
    if(cur) entries.push(cur);
    return {pre:pre.join('\n').trim(), entries};
  }
  /* renderDLCard keeps the last Status field when an entry repeats one. We
     read the status the same way, so a count can never disagree with the
     chip on the card it counted. */
  function dlEntryStatus(entry){
    let status='';
    for(const f of parseDLFields(dlSplitBody(entry.lines).fieldLines)){
      if(f.label.toLowerCase()==='status') status=f.value;
    }
    return status;
  }
  /* The audit strip and the TOC badge need the same numbers, so we count
     once, over the same entries the cards render, through the same
     classifier the rail uses. */
  function dlStatusCounts(body){
    const counts={open:0,validated:0,invalidated:0,unknown:0,other:0,total:0};
    for(const e of parseDLEntries(body).entries){
      counts[dlStatusKind(dlEntryStatus(e))]++;
      counts.total++;
    }
    return counts;
  }
  function renderDecisionLog(body){
    const {pre,entries}=parseDLEntries(body);
    // A Decision Log written as prose has no ### entries. Those sections fall
    // back to the generic renderer instead of showing an empty deck of cards.
    if(!entries.length) return renderMarkdown(body);
    return (pre?`<div class="md">${renderMarkdown(pre)}</div>`:'')
      + `<div class="dl-cards">${entries.map(renderDLCard).join('')}</div>`;
  }

  const ADPParserLib={esc,escAttr,safeLinkUrl,inline,decorate,TOK,renderMarkdown,ART,metaFor,splitFrontMatter,parseSections,slug,sectionKeys,isTableStart,splitRow,parseDLFields,dlSplitBody,dlChipSplit,dlConfKind,dlConfPill,dlStatusPill,dlStatusKind,dlRail,parseDLEntries,dlEntryStatus,dlStatusCounts,renderDLCard,renderDecisionLog};
  if(typeof module!=="undefined"&&module.exports){ module.exports=ADPParserLib; }
  else{ global.ADPParserLib=ADPParserLib; }
})(typeof globalThis!=="undefined"?globalThis:this);
