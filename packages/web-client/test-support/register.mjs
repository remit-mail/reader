import { register } from "node:module";
import { pathToFileURL } from "node:url";
import "@remit/test-dom";
// A kit component imports the structural sheet it cannot draw without, and this
// package's suites render those components. Registered here rather than on the
// command line so every process that loads this file — including the children a
// test spawns — resolves a stylesheet the same way.
import "@remit/test-dom/css";
import "./query-timers.mjs";

// A browser resolves the deploy's relative `apiUrl` against the document; Node's
// `Request` has no document, so the generated client's absolute-URL requirement
// is met by pinning the API base to jsdom's own origin.
globalThis.__REMIT_CONFIG__ = { apiUrl: "http://localhost" };

register("./loader.mjs", pathToFileURL(`${import.meta.dirname}/`));
