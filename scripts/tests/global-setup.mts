/* The bundle test and the launch tests load the app bundle from dist/, so
   we build it once before any test file runs. A test then never reads a
   bundle older than the sources beside it. */
import {build} from "vite";
import {installed, SKILL_DIR} from "../adp-runtime.mts";

/* The launch tests run the real launcher, which reinstalls the dependencies
   when the lockfile is newer than the install. That npm ci would empty the
   node_modules this suite loads from, so we refuse to start until the
   developer installs. */
export function requireInstall(dir: string){
  if (!installed(dir)) throw new Error("node_modules is older than package-lock.json. Run npm ci, then run the suite again.");
}

export default async function setup(){
  // Vitest 5 crashes on a source map when it prints an error thrown here,
  // and the developer sees that crash in place of our message. So we print
  // the message and exit ourselves.
  try { requireInstall(SKILL_DIR); }
  catch (e) { process.stderr.write((e as Error).message + "\n"); process.exit(1); }
  await build({logLevel: "warn"});
}
