/* adp-parser-lib.ts — shared pure rendering logic for the ADP artifact
   viewer. The markdown renderer, the section splitter with its key dedupe,
   and the decision-log card pipeline. Node runs this module as it stands. */

/* =========================================================
   Hand-rolled markdown renderer (artifact subset)
   ========================================================= */
function esc(s: unknown): string{return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
// esc leaves double quotes alone, which is fine for element content. A
// value inside a quoted attribute needs them escaped too, or a document
// title could close the attribute early.
function escAttr(s: unknown): string{return esc(s).replace(/"/g,'&quot;');}

// We never let a document-controlled URL become an anchor unless its scheme
// is on this list. Anything else degrades to visible text. If a legitimate
// new scheme turns up, add it here.
const LINK_SCHEMES: string[]=['http','https','mailto'];
// We test the URL as it will sit inside the href attribute. A double quote
// would close the attribute and plant a live event handler. A C0 control
// character can hide a scheme, because the browser strips those before it
// parses the URL. The control class also catches code-span placeholders,
// whose restored content would re-enter the attribute unescaped. A URL with
// no scheme is a relative path or a #fragment, and those stay clickable.
function safeLinkUrl(url: string): boolean{
  if(/[\u0000-\u001f\u007f"]/.test(url)) return false;
  const m=/^([a-z][a-z0-9+.-]*):/i.exec(url);
  return !m || LINK_SCHEMES.includes(m[1].toLowerCase());
}

// A code span opens on a run of backticks and closes on the next run of
// the same length, so a double-backtick span can hold a single backtick.
// splitRow() finds spans with this same pattern.
const CODE_SPAN=/(?<!`)(`+)(?!`)([\s\S]*?[^`])\1(?!`)/g;
// A line ending inside a span reads as a space. When the content both
// starts and ends with a space, we strip one from each side, so authors
// can write `` `x` `` to show a backtick next to the edge.
function spanText(c: string): string{
  c=c.replace(/\n/g,' ');
  return /^ [\s\S]* $/.test(c) && /[^ ]/.test(c) ? c.slice(1,-1) : c;
}
// These are the escaped characters that the link and emphasis rules below
// would read as syntax. We write them as numeric entities so those rules
// skip them. None of them can sit in a URL scheme, so an entity never hides
// a scheme from safeLinkUrl. Every other escaped character is plain text.
const SYNTAX_ESC: Record<string, string>={'*':'&#42;','_':'&#95;','[':'&#91;',']':'&#93;','(':'&#40;',')':'&#41;'};

// Callers pass raw document text and never markup we already built. Code
// spans come out of the raw text before anything else runs, because their
// contents must stay literal and must be escaped only once. Each one leaves
// a NUL-wrapped index behind and goes back in at the end. A backslash
// before ASCII punctuation outside a span makes that character literal.
function inline(s: unknown): EscapedHtml{
  const codes: string[]=[];
  let t = String(s).replace(CODE_SPAN,(m: string,run: string,c: string)=>{codes.push(spanText(c));return '\u0000'+(codes.length-1)+'\u0000';});
  t = esc(t);
  t = t.replace(/\\(&amp;|&lt;|&gt;|[!-\/:-@\[-`{-~])/g,(m: string,c: string)=>SYNTAX_ESC[c]||c);
  // We only build the anchor when safeLinkUrl passes. A rejected run stays
  // in place as escaped plain text, so nothing silently vanishes. The URL
  // is already escaped here, so it goes into the href as it is. A second
  // escape would turn the "&" of a query string into "&amp;amp;".
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g,(m: string,txt: string,url: string)=>safeLinkUrl(url)
    ? `<a href="${url}" target="_blank" rel="noopener noreferrer">${txt}</a>`
    : m);
  // Bold needs text against both of its delimiters, so "2 ** 8" stays
  // prose. An underscore pair also stays out of words, as in foo__bar.
  t = t.replace(/\*\*([^*\s](?:[^*]*[^*\s])?)\*\*/g,'<strong>$1</strong>');
  t = t.replace(/(^|[^\w])__([^_\s](?:[^_]*[^_\s])?)__(?!\w)/g,'$1<strong>$2</strong>');
  // A single asterisk with a space beside it is prose, as in "AV-* and"
  // on one line with "PB-*" on the next, so emphasis needs text against
  // both of its asterisks.
  t = t.replace(/(^|[^*\w])\*([^*\s](?:[^*]*[^*\s])?)\*(?!\w)/g,'$1<em>$2</em>');
  t = t.replace(/\u0000(\d+)\u0000/g,(m: string,i: string)=>`<code>${esc(codes[+i])}</code>`);
  return t as EscapedHtml;
}
// We wrap free-standing status keywords in pills. The input is HTML we
// already rendered, so we lift each tag into a placeholder before the
// scan and restore it after. That keeps pills out of attribute text,
// where an href can carry a path segment like /HIGH. The guard leaves a
// keyword plain inside a word, directly after a tag, and inside double
// quotes. A slash is prose, so VALIDATED/INVALIDATED pills both words.
function decorate(html: EscapedHtml): EscapedHtml{
  const tags: string[]=[];
  let t = html.replace(/<[^>]*>/g,m=>{tags.push(m);return '\u0000'+(tags.length-1)+'\u0000';});
  t = t.replace(/(^|[^A-Za-z0-9_"\u0000])(INVALIDATED|VALIDATED|UNOBSERVABLE|UNKNOWN|PENDING|MEDIUM|MED|HIGH|OPEN|LOW)\b/g,
    (m: string,pre: string,w: string)=>pre+`<span class="pill ${TOK[w]}">${w}</span>`);
  return t.replace(/\u0000(\d+)\u0000/g,(m: string,i: string)=>tags[+i]) as EscapedHtml;
}
// UNKNOWN and UNOBSERVABLE both mean the observability is absent, so they
// share one hue. PENDING is a promised mitigation that has not landed, which
// is outstanding work, so it reads amber the way OPEN does. The corpus
// abbreviates MEDIUM to MED, so both spell the same hue.
const TOK: Record<string, string>={HIGH:'p-high',MEDIUM:'p-med',MED:'p-med',LOW:'p-low','H':'p-high','M':'p-med','L':'p-low',
           OPEN:'p-open',VALIDATED:'p-ok',INVALIDATED:'p-bad',YES:'p-ok',NO:'p-bad','N/A':'p-low',
           UNKNOWN:'p-unk',UNOBSERVABLE:'p-unk',PENDING:'p-open'};

function isTableStart(lines: string[],i: number): string | boolean{
  return lines[i] && lines[i].indexOf('|')>-1 && i+1<lines.length
    && /-/.test(lines[i+1]) && /^[\s|:\-]+$/.test(lines[i+1]) && lines[i+1].indexOf('|')>-1;
}
function isBlockStart(lines: string[],i: number): boolean{
  if(i>=lines.length) return true;
  const l=lines[i];
  if(/^\s*$/.test(l)) return true;
  if(/^\s*```/.test(l)) return true;
  if(/^#{1,6}\s/.test(l)) return true;
  // An ordered item may interrupt a paragraph only when it starts at 1, so
  // a wrapped sentence that puts "130." at the start of a line stays prose.
  const k=listMarker(l);
  if(k && (!k.ordered || k.num===1)) return true;
  if(/^\s*>/.test(l)) return true;
  if(/^\s*([-*_])\1{2,}\s*$/.test(l)) return true;
  if(isTableStart(lines,i)) return true;
  return false;
}

// A pipe inside a paired code span is cell content, not a boundary. We
// find the spans with the same pattern that inline() pairs with, so the
// split and the rendering agree on which backticks pair. A pipe after an
// odd run of backslashes is cell content too, and inline() later drops the
// escaping backslash. An even run is escaped backslashes, as in "C:\\|".
// Inside a span the backslash stays, because authors write `\|` there to
// name the escape itself. We slice each cell out of the original row and
// rewrite nothing, which keeps every byte intact. Note: the edge trims may
// run before the span scan. A character inside a span has a backtick on
// each side, so the row never starts or ends inside one.
function splitRow(r: string): string[]{
  const t=r.trim().replace(/^\|/,'').replace(/\|$/,'');
  const spans: [number, number][]=[]; const re=new RegExp(CODE_SPAN); let m: RegExpExecArray | null;
  while((m=re.exec(t))) spans.push([m.index,m.index+m[0].length]);
  const cells: string[]=[]; let start=0;
  for(let i=0;i<t.length;i++){
    if(t[i]!=='|' || spans.some(([a,b])=>a<i&&i<b)) continue;
    let k=i; while(t[k-1]==='\\') k--;
    if((i-k)%2===0){cells.push(t.slice(start,i));start=i+1;}
  }
  cells.push(t.slice(start));
  return cells.map(c=>c.trim());
}
function cell(c: string): string{
  const key=c.trim().toUpperCase();
  if(TOK[key]) return `<span class="pill ${TOK[key]}">${esc(c.trim())}</span>`;
  return decorate(inline(c));
}
function renderTable(rows: string[]): string{
  const head=splitRow(rows[0]);
  const body=rows.slice(2).filter(r=>r.indexOf('|')>-1).map(splitRow);
  const th=head.map(h=>`<th>${decorate(inline(h))}</th>`).join('');
  const trs=body.map(r=>`<tr>${head.map((_,j)=>`<td>${cell(r[j]!=null?r[j]:'')}</td>`).join('')}</tr>`).join('');
  return `<div class="tbl-wrap"><table class="md-tbl"><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table></div>`;
}

const LIST_ITEM=/^\s*([-*+]|\d+[.)])\s+/;
// We read an item line into its marker, its kind, and its start number.
// The marker alone keys a list, and it is the bullet character or the
// ordered delimiter. The kind and number decide paragraph interruption
// and where the count starts.
function listMarker(line: string): ListMarker | null{
  const m=LIST_ITEM.exec(line);
  if(!m) return null;
  const ordered=/\d/.test(m[1]);
  return {ordered, marker:m[1].slice(-1), num:ordered?parseInt(m[1],10):1};
}

function renderList(lines: string[],start: number): {html: string, next: number}{
  let i=start; const first=listMarker(lines[i])!; const ordered=first.ordered; const items: string[]=[];
  const startNum=first.num;
  // A list goes on only through items with the first item's marker. A
  // change from "-" to "*", or from "1." to "1)", starts a new list.
  const sameList=(l: string)=>{const k=listMarker(l); return !!k && k.marker===first.marker;};
  while(i<lines.length && sameList(lines[i])){
    let content=lines[i].replace(LIST_ITEM,''); i++;
    while(i<lines.length && /^\s{2,}\S/.test(lines[i]) && !listMarker(lines[i])){
      content+=' '+lines[i].trim(); i++;
    }
    items.push(content);
    // A blank line inside a list separates items, the way authors write
    // multi-sentence lists. We continue past the blanks only into an item
    // with the same marker, because a marker change or prose starts a new block.
    let j=i; while(j<lines.length && /^\s*$/.test(lines[j])) j++;
    if(j>i && j<lines.length && sameList(lines[j])) i=j;
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

function subHead(s: string): string{
  const m=s.match(/^\[([^\]]+)\]\s*([\s\S]*)$/);
  if(m) return `<span class="idbadge">${esc(m[1])}</span> <span>${decorate(inline(m[2]))}</span>`;
  return decorate(inline(s));
}

function renderMarkdown(md: unknown): EscapedHtml{
  const lines=String(md).replace(/\r\n/g,'\n').replace(/\t/g,'  ').split('\n');
  let html=''; let i=0;
  while(i<lines.length){
    const line=lines[i];
    if(/^\s*$/.test(line)){i++;continue;}
    if(/^\s*```/.test(line)){
      const buf: string[]=[]; i++;
      while(i<lines.length && !/^\s*```/.test(lines[i])){buf.push(lines[i]);i++;}
      i++; html+=`<pre class="cb"><code>${esc(buf.join('\n'))}</code></pre>`; continue;
    }
    let hm=line.match(/^(#{1,6})\s+(.*)$/);
    if(hm){ const lvl=Math.min(6,Math.max(3,hm[1].length)); html+=`<h${lvl} class="sub">${subHead(hm[2].trim())}</h${lvl}>`; i++; continue; }
    if(/^\s*([-*_])\1{2,}\s*$/.test(line)){html+='<hr>';i++;continue;}
    if(isTableStart(lines,i)){
      const tbl: string[]=[]; while(i<lines.length && lines[i].indexOf('|')>-1 && !/^\s*$/.test(lines[i])){tbl.push(lines[i]);i++;}
      html+=renderTable(tbl); continue;
    }
    if(/^\s*>/.test(line)){
      const buf: string[]=[]; while(i<lines.length && /^\s*>/.test(lines[i])){buf.push(lines[i].replace(/^\s*>\s?/,''));i++;}
      html+=`<blockquote>${renderMarkdown(buf.join('\n'))}</blockquote>`; continue;
    }
    if(listMarker(line)){ const r=renderList(lines,i); html+=r.html; i=r.next; continue; }
    const buf=[lines[i]]; i++;
    while(i<lines.length && !isBlockStart(lines,i)){buf.push(lines[i]);i++;}
    // We render the paragraph as one run, so a code span or bold that wraps
    // across a line still pairs. Each line ending then becomes a <br>,
    // because a hard-wrapped author meant those breaks.
    html+=`<p>${decorate(inline(buf.join('\n'))).replace(/\n/g,'<br>')}</p>`;
  }
  return html as EscapedHtml;
}

/* =========================================================
   Section splitter + artifact registry
   ========================================================= */
const ART: ArtEntry[]=[
  {re:/problem statement/i,            icon:'◎', tag:'P1', kind:'artifact'},
  {re:/knowledge gap/i,                icon:'◫', tag:'P2', kind:'artifact'},
  {re:/open questions/i,               icon:'?', tag:'P2', kind:'artifact'},
  {re:/recommendation brief/i,         icon:'◆', tag:'P3', kind:'artifact'},
  {re:/pre-?mortem/i,                  icon:'⚠', tag:'P4', kind:'artifact'},
  {re:/implementation authorization/i, icon:'⊞', tag:'P4', kind:'artifact'},
  {re:/decision log/i,                 icon:'⎇', tag:'P5', spine:true, kind:'artifact'},
  {re:/test adversary/i,               icon:'⊗', tag:'P6', kind:'artifact'},
  {re:/mandatory review/i,             icon:'🚩', tag:'P7', alert:true, kind:'artifact'},
  {re:/residual risk/i,                icon:'◬', tag:'P7', kind:'artifact'},
  {re:/test coverage gaps/i,           icon:'▤', tag:'P6', kind:'artifact'},
  {re:/pr summary/i,                   icon:'⇡', tag:'P7', kind:'artifact'},
  {re:/deployment risk/i,              icon:'⟲', tag:'P8', kind:'artifact'},
  {re:/obligation ticket/i,            icon:'✓', tag:'P9', kind:'artifact'},
  // Other corpora title their sections "Phase N: <name>" instead of using
  // the artifact names. These rows sit after the artifact rows, so an
  // artifact name inside such a title still wins the tie on the same phase.
  {re:/^phase\s*1\s*:/i,               icon:'◎', tag:'P1', kind:'artifact'},
  {re:/^phase\s*2\s*:/i,               icon:'◫', tag:'P2', kind:'artifact'},
  {re:/^phase\s*3\s*:/i,               icon:'◆', tag:'P3', kind:'artifact'},
  {re:/^phase\s*4\s*:/i,               icon:'⚠', tag:'P4', kind:'artifact'},
  {re:/^phase\s*5\s*:/i,               icon:'⎇', tag:'P5', spine:true, kind:'artifact'},
  {re:/^phase\s*6\s*:/i,               icon:'⊗', tag:'P6', kind:'artifact'},
  {re:/^phase\s*7\s*:/i,               icon:'⇡', tag:'P7', kind:'artifact'},
  {re:/^phase\s*8\s*:/i,               icon:'⟲', tag:'P8', kind:'artifact'},
  {re:/^phase\s*9\s*:/i,               icon:'✓', tag:'P9', kind:'artifact'},
  // Companion sections recur across the record without belonging to a
  // phase, so we give these rows a kind and an empty tag. The index builder
  // reads an empty tag as "no phase", which keeps a ledger from clearing
  // phase 9. We keep them last and anchor them at the title start, so an
  // artifact name inside a title still wins and "Notes on review" stays
  // ad hoc.
  {re:/^(sweep|post-run) amendment\b/i,                        icon:'✎', tag:'', kind:'amendment'},
  {re:/^review (response|findings?|addendum)\b/i,              icon:'↩', tag:'', kind:'review'},
  {re:/^(run status\b|stage\s*\d+\b)/i,                         icon:'◔', tag:'', kind:'status'},
  {re:/^(requirement coverage|verification record|differential corpus render|browser acceptance|files changed)\b/i,
                                                               icon:'▣', tag:'', kind:'evidence'},
  {re:/^(ledger|post-merge note|ticket dispositions|post-run resolutions|closure)\b/i,
                                                               icon:'≡', tag:'', kind:'ledger'}
];
// We treat a title nothing recognizes as an ad hoc section. That is a named
// kind, never an error, and a run should need one or two at most.
function metaFor(title: string): SectionMeta{ for(const a of ART) if(a.re.test(title)) return a; return {icon:'§',tag:'',kind:'ad-hoc'}; }
// We derive the vocabulary from the registry, ad hoc last, so the tests and
// SKILL.md's parity check never read a second copy of it.
const SECTION_KINDS: SectionKind[]=ART.map(a=>a.kind).filter((k,i,all)=>all.indexOf(k)===i).concat(['ad-hoc']);

/* A declared lifecycle block is YAML front matter at byte 0. We only strip
   the opener when a closing bare --- line exists and every interior line is
   blank or a key: value pair. Anything else stays document content, so a
   file that opens with a horizontal rule keeps its text. */
function splitFrontMatter(md: unknown): FrontMatterSplit{
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

function parseSections(md: unknown): ParsedSections{
  const fm=splitFrontMatter(md);
  const lines=fm.rest.split('\n');
  const secs: Section[]=[]; let cur: Section | null=null; const intro: string[]=[];
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

function slug(s: string): string{return 'sec-'+(s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,42)||'x');}

/* render() derives each section element's id from its title. We compute the
   whole key list here so the dedupe rule stays testable on its own. A
   repeated title takes a numeric suffix, counted per base slug in document
   order. */
function sectionKeys(secs: readonly {title: string}[]): string[]{
  const seen: Record<string, number>={};
  return secs.map(sec=>{
    let key=slug(sec.title);
    if(seen[key]!=null){ key=key+'-'+(++seen[key]); } else seen[key]=0;
    return key;
  });
}

/* =========================================================
   Decision Log "ledger card" rendering (the spine)
   ========================================================= */
function parseDLFields(lines: readonly string[]): DLField[]{
  const fields: DLField[]=[]; let cur: DLField | null=null;
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
function dlChipSplit(v: string): DLChipSplit{
  const m=v.trim().match(/^[\s:—–-]*([^\s:—–-]+)(?:[\s:—–-]+([\s\S]*))?$/);
  return m?{word:m[1],tail:(m[2]||'').trim()}:{word:v.trim(),tail:''};
}
/* A value that opens with no known keyword has no keyword to stand for it.
   So we demote the whole value, not just the tail. A bare single word cuts
   nothing and gets no note. */
function dlChip(kind: string,cls: string,known: boolean,v: string): DLChip{
  const s=dlChipSplit(v);
  return {
    html:`<span class="pill dl-pill ${cls}"><i>${kind}</i>${esc(s.word)}</span>` as EscapedHtml,
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
function dlConfKind(v: unknown): DLConfKind{
  const t=String(v==null?'':v).trim().toUpperCase();
  if(t.indexOf('HIGH')===0) return 'high';
  if(t.indexOf('MED')===0) return 'medium';
  if(t.indexOf('LOW')===0) return 'low';
  return 'other';
}
function dlConfPill(v: string): DLChip{
  const cls={high:'p-ok',medium:'p-med',low:'p-high',other:'p-low'}[dlConfKind(v)];
  return dlChip('conf',cls,cls!=='p-low',v);
}
/* The one status classifier. The rail, the status chip, and the audit
   counts all read a card's status through this prefix match, so they can
   never disagree about what a status means. If you add a status keyword,
   add it here and nowhere else. */
function dlStatusKind(v: unknown): DLStatusKind{
  const t=String(v==null?'':v).trim().toUpperCase();
  if(t.indexOf('INVALIDATED')===0) return 'invalidated';
  if(t.indexOf('VALIDATED')===0) return 'validated';
  if(t.indexOf('OPEN')===0) return 'open';
  if(t.indexOf('UNKNOWN')===0) return 'unknown';
  return 'other';
}
function dlStatusPill(v: string): DLChip{
  const cls={invalidated:'p-bad',validated:'p-ok',open:'p-open',unknown:'p-unk',other:'p-low'}[dlStatusKind(v)];
  return dlChip('status',cls,cls!=='p-low',v);
}
function dlRail(status: unknown): string{
  return {invalidated:'rail-bad',validated:'rail-ok',open:'rail-open',unknown:'rail-unk',other:''}[dlStatusKind(status)];
}
/* Field values are plain wrapped prose. A blockquote or fenced block inside
   an entry is card material, not part of the field above it, so we cut the
   field region at the first block line and hand the rest back separately.
   Without the cut, a gate confirmation quoted after the last field rides
   into that field's value. */
function dlSplitBody(lines: string[]): DLBodySplit{
  for(let i=0;i<lines.length;i++){
    if(/^\s*(```|>)/.test(lines[i])){
      return {fieldLines:lines.slice(0,i), trailing:lines.slice(i).join('\n').trim()};
    }
  }
  return {fieldLines:lines, trailing:''};
}

/* The design system's DecisionCard, which mission control draws. The
   default card stays the markup the render goldens pin, so a caller asks for
   this one by option. Confidence is a neutral Tag, and the status alone takes
   a status chip's color. A note that the split word leaves behind becomes a
   field row, as on the default card, so no text is lost. A settled entry
   sets its title lighter. The head is a button that folds the fields, which
   the page wires up. A folded card hides its fields with an inline display,
   because the body's own display rule would outrank the hidden attribute. */
const DS_STATUS: Record<DLStatusKind,string>={invalidated:' adp-chip--invalidated',validated:' adp-chip--validated',
  open:' adp-chip--open',unknown:' adp-chip--unknown',other:''};
function renderDSCard(id: string, title: string, confidence: string, status: string, body: DLField[], trailing: string, open: boolean): EscapedHtml{
  const conf=confidence?dlChipSplit(confidence):null;
  const stat=status?dlChipSplit(status):null;
  const kind=dlStatusKind(status);
  if(conf&&conf.tail) body.push({label:'confidence note',value:dlConfKind(confidence)==='other'?confidence.trim():conf.tail});
  if(stat&&stat.tail) body.push({label:'status note',value:kind==='other'?status.trim():stat.tail});
  const settled=kind==='validated'||kind==='invalidated'||kind==='unknown';
  const rows=body.map(f=>`<div><dt>${esc(f.label)}</dt><dd>${dsTokens(decorate(inline(f.value)))}</dd></div>`).join('');
  const shut=open?'':' style="display:none"';
  const trail=trailing?`<div class="md dl-trail"${shut}>${proseBlocks(renderMarkdown(trailing))}</div>`:'';
  return `<div class="adp-dl${settled?' adp-dl--settled':''}" data-card="${escAttr(id)}">`
    + `<button type="button" class="adp-dl__head" aria-expanded="${open}">`
    + `<span class="adp-dl__id">${id?esc(id):'—'}</span><span class="adp-dl__title">${dsTokens(decorate(inline(title)))}</span>`
    + `<span>${conf?`<span class="adp-chip" title="confidence">${esc(conf.word)}</span>`:''}</span>`
    + `<span>${stat?`<span class="adp-chip${DS_STATUS[kind]}" title="status">${esc(stat.word)}</span>`:''}</span>`
    + `<span class="adp-dl__caret" aria-hidden="true">${open?'▾':'▸'}</span></button>`
    + (rows?`<dl class="adp-dl__body"${shut}>${rows}</dl>`:'')+trail+`</div>` as EscapedHtml;
}

/* The Reading rules of the design system's Prose component, which
   mission control draws by the same option as its cards. A line that opens
   with a bold run-in label, such as "**What the problem is:**", becomes an
   eyebrow heading, and the line's text follows it as a paragraph. The
   template writes these fields on consecutive lines, so a label starts a new
   heading even with no blank line above it. The run metadata lines that
   close a section (confirmed by, date, revision history, and authorized by)
   collapse into one footer line, each label and value as the log wrote it,
   joined with " · ". A metadata line anywhere else stays prose. The heading
   and the footer carry marker attributes, so a test can map them back to
   the text the log holds. */
const META_LABELS=['confirmed by','date','revision history','authorized by'];
const RE_RUNIN=/^\*\*([^*\n]+?):\*\*\s*(.*)$/;
function metaPairs(line: string): DLField[] | null{
  const t=line.trim();
  if(!t.startsWith('**')) return null;
  const pairs: DLField[]=[]; const re=/\*\*([^*\n]+?):\*\*/g; let m: RegExpExecArray | null; let last=-1; let label='';
  while((m=re.exec(t))){
    if(last>=0) pairs.push({label, value:t.slice(last, m.index).trim()});
    label=m[1].trim(); last=re.lastIndex;
  }
  if(last<0) return null;
  pairs.push({label, value:t.slice(last).trim()});
  return pairs.every(f=>META_LABELS.includes(f.label.toLowerCase()))?pairs:null;
}
function renderProse(md: unknown): EscapedHtml{
  const lines=String(md).replace(/\r\n/g,'\n').split('\n');
  let end=lines.length;
  while(end>0 && !lines[end-1].trim()) end--;
  let start=end; const meta: DLField[]=[];
  while(start>0){ const m=metaPairs(lines[start-1]); if(!m) break; meta.unshift(...m); start--; }
  let html=''; let chunk: string[]=[]; let inFence=false;
  const flush=()=>{ if(chunk.join('').trim()) html+=proseBlocks(renderMarkdown(chunk.join('\n'))); chunk=[]; };
  for(let i=0;i<start;i++){
    const line=lines[i];
    if(/^\s*```/.test(line)) inFence=!inFence;
    const m=!inFence ? line.match(RE_RUNIN) : null;
    if(m && !metaPairs(line)){
      flush();
      html+=`<h3 data-runin="">${dsTokens(decorate(inline(m[1].trim())))}</h3>`;
      if(m[2].trim()) chunk.push(m[2]);
      continue;
    }
    chunk.push(line);
  }
  flush();
  if(meta.length) html+=`<footer data-meta="">`+meta.map((f,i)=>(i?'<span aria-hidden="true"> · </span>':'')
    +`<span>${esc(f.label)}:</span> ${dsTokens(decorate(inline(f.value)))}`).join('')+`</footer>`;
  return html as EscapedHtml;
}
/* The markdown blocks inside Prose take the design system's own patterns or,
   where the system has none, on-grid values from its tokens. A table is the
   Table component and a code block the Pre component. A blockquote, a
   numbered list, a rule, a task box, and a fourth to sixth level heading take
   inline values, so the old theme's rules for them no longer reach a ticket.
   A plain list item lays its marker and its content out as a flex row, so we
   wrap the content in one span. Bare, each text run and code span would
   become a flex item of its own and break the line apart. A task item keeps
   its own row of box and text. A numbered list becomes a list of divs with
   the number as text in a blue mono column, as the TicketPrompt board draws
   it, because the Prose rule gives every li a ▸ marker that no inline style
   can remove. Its numbers carry data-num, so a test can tell them from the
   log's text. */
/* A token pill becomes a small chip of the design system. Color means status
   alone (R4), so a confidence word is a neutral Tag, and a status word takes
   the StatusChip of its meaning. The word itself never changes. */
const DS_TOKEN: Record<string, string>={OPEN:' adp-chip--open',PENDING:' adp-chip--open',VALIDATED:' adp-chip--validated',
  YES:' adp-chip--validated',INVALIDATED:' adp-chip--invalidated',NO:' adp-chip--invalidated',UNKNOWN:' adp-chip--unknown',
  UNOBSERVABLE:' adp-chip--unknown'};
function dsTokens(h: string): string{
  return h.replace(/<span class="pill p-[a-z]+">([^<]*)<\/span>/g,(_,w: string)=>`<span class="adp-chip adp-chip--s${DS_TOKEN[w]||''}">${w}</span>`);
}
const SUB_HEAD='margin:32px 0 8px;font:500 11px/24px var(--font-mono);letter-spacing:.14em;text-transform:uppercase;color:var(--blue-bright)';
const CBX='display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;width:16px;height:16px;margin:4px 0 0;padding:0;border:0;'
  +'box-shadow:inset 0 0 0 1px var(--line-bright);background:var(--inset);font:400 11px/16px var(--font-mono);color:var(--ok)';
function numbered(h: string): string{
  return h.replace(/<ol class="md-list"(?: style="counter-reset:li (\d+)")?>([\s\S]*?)<\/ol>/g,(_,skip: string | undefined,body: string)=>{
    let n=skip?+skip:0;
    const items=body.replace(/<li>([\s\S]*?)<\/li>/g,(__,c: string)=>`<div role="listitem" style="display:grid;grid-template-columns:24px minmax(0,1fr);gap:8px">`
      +`<span data-num="" style="font:400 12px/24px var(--font-mono);color:var(--blue-bright)">${++n}</span><span>${c}</span></div>`);
    return `<div role="list" style="margin:0 0 16px;display:flex;flex-direction:column;gap:12px">${items}</div>`;
  });
}
// A quote's last block sits flush on the quote's own bottom padding.
function quoteEnds(h: string): string{
  return h.replace(/<blockquote([^>]*)>([\s\S]*?)<\/blockquote>/g,(_,attrs: string,body: string)=>{
    const i=body.lastIndexOf('<p>');
    return `<blockquote${attrs}>${i<0?body:body.slice(0,i)+'<p style="margin:0">'+body.slice(i+3)}</blockquote>`;
  });
}
function proseBlocks(h: string): string{
  return quoteEnds(numbered(dsTokens(h)))
    .replace(/<li>/g,'<li><span>').replace(/<li class="task">([\s\S]*?)<\/li>/g,'<li class="task">$1</LI>')
    .replace(/<\/li>/g,'</span></li>').replace(/<\/LI>/g,'</li>')
    .replace(/<div class="tbl-wrap"><table class="md-tbl">/g,'<div style="overflow-x:auto;margin:0 0 16px"><table class="adp-table">')
    .replace(/<blockquote>/g,'<blockquote style="margin:0 0 16px;padding:8px 16px;border:0;box-shadow:inset 2px 0 0 var(--line-bright);background:none;color:var(--ink-2)">')
    .replace(/<pre class="cb"><code>/g,'<pre class="adp-pre" style="margin:0 0 16px"><code style="font:inherit;color:inherit;background:none;padding:0">')
    .replace(/<hr>/g,'<hr style="margin:24px 0;height:1px;border:0;background:none;box-shadow:inset 0 1px 0 var(--line)">')
    .replace(/<span class="cbx( on)? ?">/g,()=>`<span style="${CBX}">`)
    .replace(/<h([3-6]) class="sub">/g,(_,n)=>`<h${n} style="${SUB_HEAD}">`);
}
// Markdown with the design system's blocks and chips, for a value that is not
// a log section, such as a multi-line prompt field.
const renderMarkdownDS=(md: unknown): EscapedHtml=>proseBlocks(renderMarkdown(md)) as EscapedHtml;
// One line of inline text with the design system's chips, for a field value.
const decorateDS=(v: unknown): EscapedHtml=>dsTokens(decorate(inline(v))) as EscapedHtml;
const proseHtml=(md: unknown, opts?: DLRenderOpts): EscapedHtml=>opts&&opts.ds?renderProse(md):renderMarkdown(md);

// open sets whether a design system card starts with its fields shown. It
// defaults to shown, and the section renderers show the first card alone.
type DLRenderOpts = {ds?: boolean; open?: boolean};
/* The opening tag of a list of cards. A design system list that follows
   other content in its section sits one space-4 step below it, the gap the
   ticket head keeps above the phase strip. The default list stays the markup
   the goldens pin. */
function cardList(opts: DLRenderOpts | undefined, after: boolean): string{
  if(!(opts&&opts.ds)) return '<div class="dl-cards">';
  return after?'<div class="adp-dl-list" style="margin-top:16px">':'<div class="adp-dl-list">';
}
function renderDLCard(entry: DLEntry, opts?: DLRenderOpts): EscapedHtml{
  const hm=entry.head.match(/^\[([^\]]+)\]\s*([\s\S]*)$/);
  const id=hm?hm[1].trim():''; const title=hm?hm[2].trim():entry.head;
  const split=dlSplitBody(entry.lines);
  const fields=parseDLFields(split.fieldLines);
  let confidence='', status=''; const body: DLField[]=[];
  for(const f of fields){
    const k=f.label.toLowerCase();
    if(k==='confidence'){ confidence=f.value; continue; }
    if(k==='status'){ status=f.value; continue; }
    body.push(f);
  }
  if(opts&&opts.ds) return renderDSCard(id,title,confidence,status,body,split.trailing,opts.open!==false);
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
    </div>` as EscapedHtml;
}
/* We split a section body into pre-entry prose and ### entries in one
   place, because renderDecisionLog and the audit counts must see the same
   cards. A fenced ### line stays inside its code block. */
function parseDLEntries(body: unknown): DLEntries{
  const lines=String(body).replace(/\r\n/g,'\n').split('\n');
  const entries: DLEntry[]=[]; const pre: string[]=[]; let cur: DLEntry | null=null; let inFence=false;
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
function dlEntryStatus(entry: DLEntry): string{
  let status='';
  for(const f of parseDLFields(dlSplitBody(entry.lines).fieldLines)){
    if(f.label.toLowerCase()==='status') status=f.value;
  }
  return status;
}
/* The audit strip and the TOC badge need the same numbers, so we count
   once, over the same entries the cards render, through the same
   classifier the rail uses. */
function dlStatusCounts(body: unknown): DLStatusCounts{
  const counts: DLStatusCounts={open:0,validated:0,invalidated:0,unknown:0,other:0,total:0};
  for(const e of parseDLEntries(body).entries){
    counts[dlStatusKind(dlEntryStatus(e))]++;
    counts.total++;
  }
  return counts;
}
/* A section outside the spine can still record a decision, for example a
   review response that adds DL-007. We draw each such entry with the same
   card the spine uses and keep the prose around it as markdown. A card
   starts at a heading the index would harvest, ### [DL-<n>], and its field
   block ends at the first blank line. Anything after that blank line, even
   a list of bold labels such as "- **PR-COR-001:** fixed", renders after
   the card. A section with no card renders exactly as renderMarkdown would. */
const RE_CARD_HEAD=/^###\s+\[DL-\d+\]/;
function renderSectionBody(body: unknown, opts?: DLRenderOpts): EscapedHtml{
  const lines=String(body).replace(/\r\n/g,'\n').split('\n');
  const out: string[]=[]; let prose: string[]=[]; let cards: string[]=[]; let inFence=false; let any=false; let seen=0;
  const flushCards=()=>{ if(cards.length) out.push(`${cardList(opts,out.length>0)}${cards.join('')}</div>`); cards=[]; };
  const flushProse=()=>{
    const t=prose.join('\n'); prose=[];
    if(!t.trim()) return;
    flushCards(); out.push(proseHtml(t,opts));
  };
  let i=0;
  while(i<lines.length){
    const line=lines[i];
    if(!inFence && RE_CARD_HEAD.test(line)){
      flushProse(); any=true;
      const head=line.replace(/^###\s+/,'').trim(); const card: string[]=[]; let fence=false; i++;
      while(i<lines.length){
        const l=lines[i];
        if(fence){ card.push(l); if(/^\s*```/.test(l)) fence=false; i++; continue; }
        if(/^#{1,3}\s/.test(l) || /^\s*$/.test(l)) break;
        if(/^\s*```/.test(l)) fence=true;
        card.push(l); i++;
      }
      cards.push(renderDLCard({head, lines:card}, opts&&{...opts, open:!seen}));
      seen++;
      continue;
    }
    if(/^\s*```/.test(line)) inFence=!inFence;
    prose.push(line); i++;
  }
  if(!any) return proseHtml(body,opts);
  flushProse(); flushCards();
  return out.join('') as EscapedHtml;
}
function renderDecisionLog(body: unknown, opts?: DLRenderOpts): EscapedHtml{
  const {pre,entries}=parseDLEntries(body);
  // A Decision Log written as prose has no ### entries. Those sections fall
  // back to the generic renderer instead of showing an empty deck of cards.
  if(!entries.length) return proseHtml(body,opts);
  return ((pre?`<div class="md">${proseHtml(pre,opts)}</div>`:'')
    + `${cardList(opts,!!pre)}${entries.map((e,i)=>renderDLCard(e,opts&&{...opts, open:i===0})).join('')}</div>`) as EscapedHtml;
}

export {esc, escAttr, safeLinkUrl, inline, decorate, TOK, renderMarkdown, ART, SECTION_KINDS,
  metaFor, splitFrontMatter, parseSections, slug, sectionKeys, isTableStart, splitRow,
  parseDLFields, dlSplitBody, dlChipSplit, dlConfKind, dlConfPill, dlStatusPill, dlStatusKind,
  dlRail, parseDLEntries, dlEntryStatus, dlStatusCounts, renderDLCard, renderSectionBody,
  renderDecisionLog, renderProse, renderMarkdownDS, decorateDS};
export type {EscapedHtml, SectionKind, SectionMeta, ArtEntry, FrontMatterSplit, Section, ParsedSections,
  DLField, DLChipSplit, DLChip, DLConfKind, DLStatusKind, DLBodySplit, DLEntry, DLEntries, DLStatusCounts, DLRenderOpts};

/* HTML this library built from document text, with every document character
   escaped. React renders a string of HTML only when it carries this brand,
   and only this file casts a string to it, so no other code can hand React
   markup of its own. */
declare const escapedHtml: unique symbol;
type EscapedHtml = string & {readonly [escapedHtml]: true};
type ListMarker = {ordered: boolean, marker: string, num: number};
type SectionKind = 'artifact' | 'amendment' | 'review' | 'status' | 'evidence' | 'ledger' | 'ad-hoc';
interface SectionMeta {icon: string; tag: string; kind: SectionKind; spine?: boolean; alert?: boolean}
interface ArtEntry extends SectionMeta {re: RegExp}
type FrontMatterSplit = {front: string | null, rest: string};
type Section = {title: string, body: string[]};
type ParsedSections = {front: string | null, intro: string, secs: Section[]};
type DLField = {label: string, value: string};
type DLChipSplit = {word: string, tail: string};
type DLChip = {html: EscapedHtml, note: string};
type DLConfKind = 'high' | 'medium' | 'low' | 'other';
type DLStatusKind = 'invalidated' | 'validated' | 'open' | 'unknown' | 'other';
type DLBodySplit = {fieldLines: string[], trailing: string};
type DLEntry = {head: string, lines: string[]};
type DLEntries = {pre: string, entries: DLEntry[]};
type DLStatusCounts = Record<DLStatusKind | 'total', number>;
