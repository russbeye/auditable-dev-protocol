/* A vm boot for the mission-control page, in the builder-harness pattern. We
   run the real pre-paint script, the real libs, and the real page IIFE from
   mission-control.html against a small stubbed DOM, so the suite pins the
   exact code the browser gets with no build step. The stub covers only what
   the page touches on its boot, switch, toggle, seam, selection, file-op, and
   hash paths. If the page grows a new DOM dependency on those paths, grow the
   stub with it. */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// ---- element stubs ----

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
    textContent: "",
    value: "",
    files: [],
    open: false,
    _raw: ""
  };
  el.className = el.attrs.class || "";
  el.id = el.attrs.id || "";
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
  Object.defineProperty(el, "innerHTML", {
    // An element built by the parser has no raw string of its own, so its
    // markup is re-serialized from the tree. Text order inside mixed content
    // is approximate, which is fine for the regex assertions tests make.
    get(){ return el._raw || el.textContent + el.children.map(serialize).join(""); },
    set(html){
      el._raw = html;
      el.children.forEach(c => { c.parent = null; });
      el.children = [];
      parseInto(el, String(html));
    }
  });
  el.getAttribute = k => (k === "class" ? el.className : (k in el.attrs ? el.attrs[k] : null));
  el.setAttribute = (k, v) => {
    if (k === "class") el.className = String(v);
    else el.attrs[k] = String(v);
  };
  el.appendChild = child => { child.parent = el; el.children.push(child); return child; };
  el.addEventListener = (type, fn) => {
    (el.listeners[type] = el.listeners[type] || []).push(fn);
  };
  el.click = () => {};
  el.focus = () => {};
  el.closest = sel => {
    let n = el;
    while (n && n.classList) {
      if (sel[0] === "." && n.classList.contains(sel.slice(1))) return n;
      n = n.parent;
    }
    return null;
  };
  if (el.tagName === "SELECT"){
    // A select's value follows its selected option until a change hands it
    // an explicit one, which is how the harness fires change events.
    let explicit = null;
    Object.defineProperty(el, "value", {
      get(){
        if (explicit !== null) return explicit;
        const opts = walk(el, []).filter(c => c.tagName === "OPTION");
        const sel = opts.find(o => "selected" in o.attrs) || opts[0];
        return sel ? sel.attrs.value : "";
      },
      set(v){ explicit = String(v); }
    });
  }
  if ("selected" in el.attrs || "disabled" in el.attrs || "multiple" in el.attrs){ /* attrs carry these */ }
  return el;
}

/* A small tag-soup parser for the markup our builders emit: open and close
   tags, void elements, text. Enough for the page's own output; never a
   general HTML parser. */
const VOID = new Set(["input", "br", "hr", "img", "meta", "link"]);
function parseInto(parent, html){
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^"'>])*)>|([^<]+)/g;
  const stack = [parent];
  let m;
  while ((m = re.exec(html))) {
    const top = stack[stack.length - 1];
    if (m[4] !== undefined){
      top.textContent += m[4];
      continue;
    }
    const tag = m[2].toLowerCase();
    if (m[1]){
      // A stray close tag never pops past the parse root.
      if (stack.length > 1) stack.pop();
      continue;
    }
    const el = makeEl(tag, parseAttrs(m[3] || ""));
    if ("open" in el.attrs) el.open = true;
    top.appendChild(el);
    if (!VOID.has(tag) && !/\/\s*$/.test(m[3] || "")) stack.push(el);
  }
}

function serialize(el){
  const tag = el.tagName.toLowerCase();
  const attrs = Object.entries(el.attrs)
    .map(([k, v]) => (v === "" ? " " + k : ` ${k}="${v}"`)).join("");
  return `<${tag}${attrs}>` + el.textContent + el.children.map(serialize).join("") + `</${tag}>`;
}

function walk(root, out){
  for (const child of root.children) {
    out.push(child);
    walk(child, out);
  }
  return out;
}

// The page queries by #id, .class, and tag name only, so the matcher stops
// there.
function findAll(root, sel){
  const all = walk(root, []);
  if (sel[0] === "#") return all.filter(el => el.attrs.id === sel.slice(1));
  if (sel[0] === ".") return all.filter(el => el.classList.contains(sel.slice(1)));
  return all.filter(el => el.tagName === sel.toUpperCase());
}

// ---- the static page tree ----

/* Only the ids, classes, and nesting the page IIFE touches. A structural test
   in shell-page.test.js holds the real markup to the same shape. */
function buildTree(){
  const root = makeEl("#document");
  const add = (tag, attrs, parent) => parent.appendChild(makeEl(tag, attrs));

  add("div", {class: "shellmask", id: "shellmask"}, root);
  const shell = add("div", {class: "shell"}, root);
  const header = add("header", {}, shell);
  add("span", {class: "chit", id: "projChit"}, header);
  const themeBtn = add("button", {class: "chit click", id: "themeBtn"}, header);
  add("span", {id: "ttIcon"}, themeBtn);
  add("nav", {class: "tabs", id: "tabs"}, header);
  add("button", {class: "newtask", id: "newTaskBtn"}, header);
  const main = add("div", {class: "main"}, shell);
  add("aside", {class: "rail", id: "rail"}, main);
  const stage = add("main", {class: "stage"}, main);
  [["inspector", "scrInspector"], ["watchboard", "scrWatch"], ["ledgers", "scrLedgers"],
   ["calibration", "scrCalib"], ["resume pack", "scrPack"], ["new task", "scrNew"]]
    .forEach(([s, id]) => add("section", {class: "screen", "data-s": s, id}, stage));
  add("footer", {id: "foot"}, shell);
  add("input", {type: "file", id: "openDoc", multiple: ""}, root);
  add("input", {type: "file", id: "openYaml"}, root);
  return root;
}

// ---- script extraction ----

const HTML_PATH = path.join(__dirname, "..", "mission-control.html");
const LIBS = ["adp-parser-lib.js", "adp-index-lib.js", "adp-index-builder-lib.js",
  "adp-derive-lib.js", "adp-shell-lib.js"];

function inlineScripts(){
  const html = fs.readFileSync(HTML_PATH, "utf8");
  const blocks = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
    .map(m => m[1]).filter(s => s.trim());
  const prePaint = blocks.find(s => s.includes("prefers-color-scheme"));
  const main = blocks.find(s => s.includes("ADPShellLib"));
  if (!prePaint || !main) throw new Error("expected scripts not found in mission-control.html");
  return {prePaint, main};
}

// ---- boot ----

/* Boot the page. opts.stored seeds the adp-theme key, opts.matchMediaLight
   answers the system-preference probe, opts.storageThrows models a browser
   that blocks storage, opts.fetch is the seam's network, opts.hash seeds
   location.hash before the scripts run, and opts.picker installs a
   showOpenFilePicker stub, which is how a test enters the watch path. The
   default fetch rejects, which is what a file:// open does. */
function bootShell(opts){
  opts = opts || {};
  const storage = new Map();
  if (opts.stored !== undefined) storage.set("adp-theme", opts.stored);
  const root = buildTree();
  const documentElement = makeEl("html");

  const document = {
    documentElement,
    activeElement: null,
    getElementById: id => findAll(root, "#" + id)[0] || null,
    querySelector: sel => findAll(root, sel)[0] || null,
    querySelectorAll: sel => findAll(root, sel),
    addEventListener: (type, fn) => root.addEventListener(type, fn)
  };
  const localStorage = {
    getItem(k){
      if (opts.storageThrows) throw new Error("storage blocked");
      return storage.has(k) ? storage.get(k) : null;
    },
    setItem(k, v){
      if (opts.storageThrows) throw new Error("storage blocked");
      storage.set(k, String(v));
    }
  };

  const windowListeners = {};
  const window = {
    matchMedia: () => ({matches: !!opts.matchMediaLight}),
    addEventListener: (type, fn) => {
      (windowListeners[type] = windowListeners[type] || []).push(fn);
    }
  };
  if (opts.picker) window.showOpenFilePicker = opts.picker;

  const location = {hash: opts.hash || "", href: "http://local/mission-control.html" + (opts.hash || "")};
  const hashes = [];
  const history = {
    replaceState(_s, _t, url){
      location.hash = String(url);
      location.href = "http://local/mission-control.html" + url;
      hashes.push(String(url));
    }
  };
  const clipboard = [];
  const navigator = {clipboard: {writeText(t){ clipboard.push(String(t)); return Promise.resolve(); }}};

  // Timers are captured, never scheduled: h.tick() runs the poll loop once
  // and timeouts run on demand, so tests stay synchronous-by-choice.
  const intervals = [], timeouts = [];
  const timers = {
    setInterval(fn, ms){ intervals.push({fn, ms}); return intervals.length; },
    clearInterval(){},
    setTimeout(fn, ms){ timeouts.push({fn, ms}); return timeouts.length; },
    clearTimeout(){}
  };

  // A FileReader that resolves on the microtask queue, like the real one
  // resolves after the read. Test files are {name, __text}.
  function FileReader(){
    this.readAsText = f => {
      Promise.resolve().then(() => {
        this.result = String(f.__text != null ? f.__text : "");
        if (this.onload) this.onload();
      });
    };
  }

  // The seam warns to the console when a load fails. We capture those lines,
  // so a test can assert the trace instead of spilling it into the runner.
  const warns = [];
  const sandbox = {
    document,
    localStorage,
    window,
    location,
    history,
    navigator,
    FileReader,
    setInterval: timers.setInterval,
    clearInterval: timers.clearInterval,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    fetch: opts.fetch || (() => Promise.reject(new Error("no network"))),
    console: {warn: (...args) => { warns.push(args.map(String).join(" ")); }}
  };
  vm.createContext(sandbox);

  const scripts = inlineScripts();
  vm.runInContext(scripts.prePaint, sandbox);
  for (const lib of LIBS) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "..", lib), "utf8"), sandbox);
  }
  vm.runInContext(scripts.main, sandbox);

  const $ = sel => document.querySelector(sel);
  const $$ = sel => document.querySelectorAll(sel);

  // A real click bubbles, so we call the listeners of every ancestor with the
  // clicked element as the target. Disabled controls swallow the click, like
  // the browser does.
  function click(el){
    if (!el) throw new Error("click target not found");
    if (el.attrs && "disabled" in el.attrs) return;
    let n = el, reachedRoot = false;
    while (n) {
      (n.listeners && n.listeners.click || []).forEach(fn => fn({target: el}));
      if (n === root) reachedRoot = true;
      n = n.parent;
    }
    if (!reachedRoot) (root.listeners.click || []).forEach(fn => fn({target: el}));
  }

  // change fires on the element then reaches the document's delegated
  // listener, which is the only place the page listens for it.
  function change(el, value){
    if (value !== undefined) el.value = value;
    (el.listeners.change || []).forEach(fn => fn({target: el}));
    (root.listeners.change || []).forEach(fn => fn({target: el}));
  }

  function fireWindow(type, ev){
    (windowListeners[type] || []).forEach(fn => fn(Object.assign({preventDefault(){}}, ev)));
  }

  // One tick of the shared poll loop.
  function tick(){
    intervals.forEach(iv => iv.fn());
  }
  function runTimeouts(){
    const due = timeouts.splice(0);
    due.forEach(t => t.fn());
  }

  // Enough macrotask turns to drain the promise chains the seam and the
  // file operations create.
  async function settle(){
    for (let i = 0; i < 4; i++) await new Promise(r => setImmediate(r));
  }

  return {document, documentElement, $, $$, storage, click, change, fireWindow,
    tick, runTimeouts, settle, warns, hashes, clipboard, location, intervals};
}

module.exports = {bootShell};
