/* Checks a filled prompt against the template structure.

   Usage: node validate-prompt.mts path/to/prompt.yaml

   Exit codes:
     0  valid
     1  invalid, with one "  - <key> <message>" line per problem on stdout
     2  usage error, a missing or non-UTF-8 file, a mapping that uses
        YAML outside the subset, or a plain value whose YAML type changes
        the verdict

   We read the prompt with the same parseYAML and validate() that mission
   control uses, so a prompt never passes one and fails the other. */
import {createRequire} from "node:module";
import fs from "node:fs";

type PromptLib = {
  parseYAML(text: string, issues?: string[], yaml11?: boolean): unknown,
  validate(doc: unknown): [string, string][],
};
const lib = createRequire(import.meta.url)("./adp-prompt-lib.js") as PromptLib;

const keys = (errors: [string, string][]) => [...new Set(errors.map(e => e[0]))].sort().join("\n");

/* The verdict for one file, as the exit code. We set process.exitCode and
   never call process.exit, because on macOS a pipe writes asynchronously and
   an early exit can cut off the lines we already wrote. */
function check(args: string[]): number {
  if (args.length !== 1){
    process.stderr.write("usage: validate-prompt.mts path/to/prompt.yaml\n");
    return 2;
  }
  const file = args[0];

  let text: string;
  try {
    // A fatal decoder refuses bytes that are not UTF-8. The default decode
    // would swap them for U+FFFD and judge a prompt the author never wrote.
    text = new TextDecoder("utf-8", {fatal: true}).decode(fs.readFileSync(file));
  } catch (e: any) {
    process.stderr.write(`error: could not read ${file}: ${e.message}\n`);
    return 2;
  }

  // parseYAML reads a subset of YAML and names every construct outside it
  // that it skips or keeps as plain text. A verdict over a partial mapping would judge a
  // document the author did not write, so we refuse to give one. When the
  // parse yields nothing at all, for example a sequence at the root, no
  // mapping exists to misjudge, and validate() gives the root verdict.
  const issues: string[] = [];
  const doc = lib.parseYAML(text, issues);
  if (issues.length && Object.keys(doc as object).length){
    process.stderr.write(`error: ${file} uses YAML outside the supported subset:\n`);
    for (const i of issues) process.stderr.write(`  - ${i}\n`);
    return 2;
  }

  // We also judge the file as a YAML 1.1 loader types it. A
  // plain value like `apply: yes` is a boolean there and text in mission
  // control, and the two readings can give different verdicts. We answer
  // only when both readings flag the same keys, so the verdict we print is
  // the one either reader would give.
  const errors = lib.validate(doc);
  const typed: string[] = [];
  const typedErrors = lib.validate(lib.parseYAML(text, typed, true));
  if (keys(errors) !== keys(typedErrors)){
    process.stderr.write(`error: ${file} has plain values whose YAML type changes the verdict:\n`);
    for (const t of typed) process.stderr.write(`  - ${t}\n`);
    return 2;
  }

  if (errors.length){
    process.stdout.write(`INVALID: ${file}\n`);
    for (const [key, msg] of errors) process.stdout.write(`  - ${key} ${msg}\n`);
    return 1;
  }
  process.stdout.write(`VALID: ${file}\n`);
  return 0;
}

process.exitCode = check(process.argv.slice(2));
