/**
 * Stylesheet imports for the unit-test processes.
 *
 * A kit component imports the structural sheet it needs beside itself, so the
 * sheet travels with the component into every bundle that mounts it and no app
 * has to remember to ask for one. A bundler resolves that import; Node does
 * not, and refuses the module with "Unknown file extension .css".
 *
 * Registered through `--import` so the hook is installed before the test files
 * are linked — a module graph is resolved in full before any of it evaluates,
 * so a hook registered from inside a test file arrives too late.
 */

import { register } from "node:module";
import { pathToFileURL } from "node:url";

register("./css-hooks.mjs", pathToFileURL(`${import.meta.dirname}/`));
