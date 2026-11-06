/* The browser entry for the vanilla pages. Each page reads the libraries as
   six globals, the names they had as plain script files. We hand each page a
   plain copy of the module, because a test installs a wrapper on a global's
   method to count calls, and a module namespace is read-only. */
import * as ADPParserLib from "./lib/adp-parser-lib.ts";
import * as ADPIndexLib from "./lib/adp-index-lib.ts";
import * as ADPIndexBuilder from "./lib/adp-index-builder-lib.ts";
import * as ADPDeriveLib from "./lib/adp-derive-lib.ts";
import * as ADPPromptLib from "./lib/adp-prompt-lib.ts";
import * as ADPShellLib from "./lib/adp-shell-lib.ts";

Object.assign(globalThis, {
  ADPParserLib: {...ADPParserLib},
  ADPIndexLib: {...ADPIndexLib},
  ADPIndexBuilder: {...ADPIndexBuilder},
  ADPDeriveLib: {...ADPDeriveLib},
  ADPPromptLib: {...ADPPromptLib},
  ADPShellLib: {...ADPShellLib},
});
