/* A vm boot for the prompt builder's page script, so the suites can pin
   behavior that lives inside the page IIFE and never reaches the lib, such as
   the import report's unknown-key entries and the draft restore. We evaluate
   the real adp-prompt-lib.js and the real main IIFE from prompt-builder.html
   against a small stubbed DOM, with no build step and no dependency, so the
   whole suite still runs on stock node --test. The stub covers only what the
   page touches on its load, import, and export paths. If the page grows a new
   DOM dependency on those paths, grow the stub with it. */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// ---- element stubs ----

/* We model an element as a plain object with the handful of properties the
   page reads and writes. innerHTML assignment parses just enough markup to
   materialize the input, select, and button children the page queries for.
   A select stub keeps its option list and refuses a value outside it, the
   way a real select does, so a future edit that assigns a raw imported phase
   fails here instead of only in a browser. */
function parseAttrs(str){
  const attrs = {};
  const re = /([a-zA-Z-]+)="([^"]*)"|([a-zA-Z-]+)/g;
  let m;
  while ((m = re.exec(str))) {
    if (m[1] !== undefined) attrs[m[1]] = m[2];
    else attrs[m[3]] = "";
  }
  return attrs;
}

function makeEl(tag, attrs){
  const el = {
    tagName: String(tag).toUpperCase(),
    attrs: Object.assign({}, attrs || {}),
    children: [],
    parent: null,
    listeners: {},
    checked: false,
    disabled: false,
    textContent: "",
    _value: "",
    _options: null,
    _raw: ""
  };
  el.className = el.attrs.class || "";
  if ("checked" in el.attrs) el.checked = true;
  if ("value" in el.attrs) el._value = el.attrs.value;
  Object.defineProperty(el, "value", {
    get(){ return el._value; },
    set(v){
      v = String(v);
      // Real selects fall back to no selection when no option matches.
      if (el._options && v !== "" && !el._options.includes(v)) v = "";
      el._value = v;
    }
  });
  Object.defineProperty(el, "innerHTML", {
    get(){ return el._raw; },
    set(html){
      el._raw = html;
      el.children.forEach(c => { c.parent = null; });
      el.children = [];
      const re = /<input\b([^>]*)>|<select\b([^>]*)>([\s\S]*?)<\/select>|<button\b([^>]*)>/g;
      let m;
      while ((m = re.exec(html))) {
        let child;
        if (m[1] !== undefined) child = makeEl("input", parseAttrs(m[1]));
        else if (m[2] !== undefined) {
          child = makeEl("select", parseAttrs(m[2]));
          child._options = [];
          const or = /<option\b[^>]*value="([^"]*)"/g;
          let om;
          while ((om = or.exec(m[3]))) child._options.push(om[1]);
        }
        else child = makeEl("button", parseAttrs(m[4]));
        el.appendChild(child);
      }
    }
  });
  el.classList = {
    contains(c){ return el.className.split(/\s+/).includes(c); },
    add(c){ if (!el.classList.contains(c)) el.className = (el.className + " " + c).trim(); },
    remove(c){ el.className = el.className.split(/\s+/).filter(x => x && x !== c).join(" "); },
    toggle(c, force){
      const want = force === undefined ? !el.classList.contains(c) : !!force;
      if (want) el.classList.add(c); else el.classList.remove(c);
      return want;
    }
  };
  el.getAttribute = k => (k === "class" ? el.className : (k in el.attrs ? el.attrs[k] : null));
  el.setAttribute = (k, v) => { el.attrs[k] = String(v); };
  el.addEventListener = (type, fn) => { (el.listeners[type] = el.listeners[type] || []).push(fn); };
  el.appendChild = child => { child.parent = el; el.children.push(child); return child; };
  el.remove = () => {
    if (el.parent) el.parent.children = el.parent.children.filter(c => c !== el);
    el.parent = null;
  };
  el.focus = () => {};
  el.querySelector = sel => queryAll(el, sel)[0] || null;
  el.querySelectorAll = sel => queryAll(el, sel);
  el.closest = sel => {
    let node = el;
    while (node && node.tagName) {
      if (sel.split(",").some(part => matchesCompound(node, tokenize(part)))) return node;
      node = node.parent;
    }
    return null;
  };
  return el;
}

// ---- a small selector engine, covering only what the page uses ----

function parseSimple(s){
  const out = {tag: null, id: null, classes: [], attrs: [], checked: false};
  s = s.replace(/:checked/g, () => { out.checked = true; return ""; });
  s = s.replace(/\[([a-zA-Z-]+)(?:=(?:"([^"]*)"|([^\]]*)))?\]/g, (m, k, q, u) => {
    out.attrs.push([k, q !== undefined ? q : (u !== undefined ? u : null)]);
    return "";
  });
  s = s.replace(/#([\w-]+)/g, (m, id) => { out.id = id; return ""; });
  s = s.replace(/\.([\w-]+)/g, (m, c) => { out.classes.push(c); return ""; });
  s = s.trim();
  if (s && s !== "*") out.tag = s.toUpperCase();
  return out;
}

function matchesSimple(el, sel){
  const p = typeof sel === "string" ? parseSimple(sel) : sel;
  if (p.tag && el.tagName !== p.tag) return false;
  if (p.id && el.attrs.id !== p.id) return false;
  if (p.classes.some(c => !el.classList.contains(c))) return false;
  for (const [k, v] of p.attrs) {
    const got = el.getAttribute(k);
    if (got === null) return false;
    if (v !== null && got !== v) return false;
  }
  if (p.checked && !el.checked) return false;
  return true;
}

function tokenize(part){ return part.trim().split(/\s+/); }

function matchesCompound(el, tokens){
  let i = tokens.length - 1;
  if (!matchesSimple(el, tokens[i])) return false;
  let node = el;
  i--;
  while (i >= 0) {
    if (tokens[i] === ">") {
      i--;
      node = node.parent;
      if (!node || !node.tagName || !matchesSimple(node, tokens[i])) return false;
      i--;
    } else {
      let anc = node.parent;
      while (anc && anc.tagName && !matchesSimple(anc, tokens[i])) anc = anc.parent;
      if (!anc || !anc.tagName) return false;
      node = anc;
      i--;
    }
  }
  return true;
}

function walk(root, out){
  for (const child of root.children) {
    out.push(child);
    walk(child, out);
  }
  return out;
}

function queryAll(root, selector){
  const all = walk(root, []);
  const parts = selector.split(",").map(tokenize);
  return all.filter(el => parts.some(tokens => matchesCompound(el, tokens)));
}

// ---- the static page tree ----

/* Only ids and containers the main IIFE touches. The tree shape matters in
   one place: the named form fields and the list containers must sit under
   <main>, because applyPromptData sweeps "main input[type=text],main textarea"
   while the paste drawer lives outside that sweep, as it does on the page. */
const LISTS = ["priorities", "out_of_scope", "must_not", "references", "links",
               "lessons_learned", "requirements", "defers"];

function buildTree(FORMATS){
  const root = makeEl("#document");
  const add = (tag, attrs, parent) => parent.appendChild(makeEl(tag, attrs));

  const header = add("header", {}, root);
  ["openbtn", "pastebtn", "copy", "download", "clear", "example", "pasteimport"]
    .forEach(id => add("button", {id}, header));
  add("input", {id: "openfile"}, header);
  add("div", {id: "pastedrawer"}, header);
  add("textarea", {id: "pastearea"}, header);
  add("span", {id: "pastemsg"}, header);
  add("div", {id: "status", class: "status ok"}, header);
  add("span", {id: "status-txt"}, header);
  add("div", {id: "live-status"}, header);

  const main = add("main", {}, root);
  [["input", "t_id"], ["input", "t_title"], ["input", "t_author"], ["input", "t_date"],
   ["textarea", "preamble"], ["input", "r_lens"], ["textarea", "prompt"],
   ["textarea", "c_bg"], ["input", "o_dest"], ["textarea", "o_struct"]]
    .forEach(([tag, id]) => add(tag, tag === "input" ? {id, type: "text"} : {id}, main));
  const fmt = add("select", {id: "o_fmt"}, main);
  fmt._options = [""].concat(FORMATS);
  ["p_apply", "p_stake", "p_log", "p_flag"]
    .forEach(id => { add("input", {id, type: "checkbox"}, main).checked = true; });
  add("div", {id: "artifacts"}, main);
  LISTS.forEach(name => {
    add("div", {class: "list-rows", "data-list": name}, main);
    add("button", {class: "add", "data-add": name}, main);
  });

  const aside = add("aside", {}, root);
  add("pre", {id: "code"}, aside);
  add("div", {id: "issues", class: "issues empty"}, aside);
  add("h4", {id: "issues-h"}, aside);
  add("ul", {id: "issues-list"}, aside);
  add("div", {id: "toast"}, root);
  return root;
}

// ---- captured timers, storage, boot ----

function makeClock(){
  const pending = new Map();
  let nextId = 1;
  return {
    setTimeout(fn){ const id = nextId++; pending.set(id, fn); return id; },
    clearTimeout(id){ pending.delete(id); },
    // We drain repeatedly because one flushed callback can schedule another.
    settle(){
      while (pending.size) {
        const fns = [...pending.values()];
        pending.clear();
        fns.forEach(fn => fn());
      }
    }
  };
}

const HTML_PATH = path.join(__dirname, "..", "prompt-builder.html");
const LIB_PATH = path.join(__dirname, "..", "adp-prompt-lib.js");

function mainScript(){
  const html = fs.readFileSync(HTML_PATH, "utf8");
  const blocks = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  const script = blocks.find(s => s.includes("window.ADPPromptLib"));
  if (!script) throw new Error("main IIFE not found in prompt-builder.html");
  return script;
}

/* Boot the page. opts.storage seeds localStorage with a Map from a previous
   boot, which is how the draft-restore tests model a reload. The returned
   handle exposes the stub document plus small drivers for the event paths the
   tests exercise. */
function bootBuilder(opts){
  opts = opts || {};
  const lib = require(LIB_PATH);
  const clock = makeClock();
  const storage = opts.storage || new Map();
  const copied = [];
  const root = buildTree(lib.FORMATS);

  const docListeners = {};
  const document = {
    children: root.children,
    createElement: tag => makeEl(tag),
    addEventListener(type, fn){ (docListeners[type] = docListeners[type] || []).push(fn); },
    querySelector: sel => queryAll(root, sel)[0] || null,
    querySelectorAll: sel => queryAll(root, sel)
  };

  const sandbox = {
    document,
    localStorage: {
      getItem: k => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => { storage.set(k, String(v)); },
      removeItem: k => { storage.delete(k); }
    },
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    navigator: {clipboard: {writeText: async t => { copied.push(t); }}},
    confirm: () => true,
    console,
    window: {addEventListener(){}}
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(LIB_PATH, "utf8"), sandbox);
  // In a vm sandbox window is not globalThis, so the lib lands on the global
  // and we copy it to where the page's destructure looks.
  sandbox.window.ADPPromptLib = sandbox.ADPPromptLib;
  vm.runInContext(mainScript(), sandbox);

  const $ = sel => document.querySelector(sel);

  function fireDoc(type, target){ (docListeners[type] || []).forEach(fn => fn({target})); }
  function click(el){
    const results = (el.listeners.click || []).map(fn => fn({target: el}));
    fireDoc("click", el);
    return Promise.all(results);
  }
  const fireInput = el => fireDoc("input", el);
  const fireChange = el => fireDoc("change", el);

  function importText(text){
    $("#pastearea").value = text;
    click($("#pasteimport"));
    return $("#pastemsg").textContent;
  }
  // The copy button hands CURRENT to the clipboard stub, which is the only
  // place the page exposes the exact export bytes.
  async function exportYaml(){
    await click($("#copy"));
    return copied[copied.length - 1];
  }
  const listEls = name => $(`.list-rows[data-list="${name}"]`).children.slice();
  function rows(name){
    return listEls(name).map(row => {
      const fields = queryAll(row, "[data-field]");
      if (!fields.length) return row.querySelector("input").value;
      const out = {};
      fields.forEach(f => { out[f.getAttribute("data-field")] = f.value; });
      return out;
    });
  }
  const issueKeys = () => [...$("#issues-list").innerHTML.matchAll(/<code>([^<]*)<\/code>/g)].map(m => m[1]);

  return {
    document, $, storage, copied,
    settle: clock.settle,
    click, fireInput, fireChange,
    addRow: name => click($(`[data-add="${name}"]`)),
    importText, exportYaml, listEls, rows, issueKeys,
    statusText: () => $("#status-txt").textContent
  };
}

module.exports = {bootBuilder};
