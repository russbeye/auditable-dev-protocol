/* A vm boot for the mission-control page, in the builder-harness pattern. We
   run the real pre-paint script, the real libs, and the real page IIFE from
   mission-control.html against a small stubbed DOM, so the suite pins the
   exact code the browser gets with no build step. The stub covers only what
   the chrome touches on its boot, switch, toggle, and seam paths. If the page
   grows a new DOM dependency on those paths, grow the stub with it. */
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
    _raw: ""
  };
  el.className = el.attrs.class || "";
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
    get(){ return el._raw; },
    set(html){
      el._raw = html;
      el.children.forEach(c => { c.parent = null; });
      el.children = [];
      // The chrome only ever writes button markup, so the parser stays that
      // small on purpose.
      const re = /<button\b([^>]*)>([\s\S]*?)<\/button>/g;
      let m;
      while ((m = re.exec(html))) {
        const child = makeEl("button", parseAttrs(m[1]));
        child.textContent = m[2];
        el.appendChild(child);
      }
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
  el.closest = sel => {
    let n = el;
    while (n && n.classList) {
      if (sel[0] === "." && n.classList.contains(sel.slice(1))) return n;
      n = n.parent;
    }
    return null;
  };
  return el;
}

function walk(root, out){
  for (const child of root.children) {
    out.push(child);
    walk(child, out);
  }
  return out;
}

// The chrome queries by #id and .class only, so the matcher stops there.
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
  return root;
}

// ---- script extraction ----

const HTML_PATH = path.join(__dirname, "..", "mission-control.html");
const LIBS = ["adp-parser-lib.js", "adp-index-lib.js", "adp-index-builder-lib.js", "adp-shell-lib.js"];

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
   that blocks storage, and opts.fetch is the seam's network. The default
   fetch rejects, which is what a file:// open does. */
function bootShell(opts){
  opts = opts || {};
  const storage = new Map();
  if (opts.stored !== undefined) storage.set("adp-theme", opts.stored);
  const root = buildTree();
  const documentElement = makeEl("html");

  const document = {
    documentElement,
    getElementById: id => findAll(root, "#" + id)[0] || null,
    querySelector: sel => findAll(root, sel)[0] || null,
    querySelectorAll: sel => findAll(root, sel)
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

  // The seam warns to the console when a load fails. We capture those lines,
  // so a test can assert the trace instead of spilling it into the runner.
  const warns = [];
  const sandbox = {
    document,
    localStorage,
    window: {matchMedia: () => ({matches: !!opts.matchMediaLight})},
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

  // A real click bubbles, so we call the listeners of every ancestor with the
  // clicked element as the target. That is what lets delegation tests work.
  function click(el){
    let n = el;
    while (n) {
      (n.listeners && n.listeners.click || []).forEach(fn => fn({target: el}));
      n = n.parent;
    }
  }

  // Two macrotask turns drain every microtask chain the seam creates.
  async function settle(){
    await new Promise(r => setImmediate(r));
    await new Promise(r => setImmediate(r));
  }

  return {document, documentElement, $, storage, click, settle, warns};
}

module.exports = {bootShell};
