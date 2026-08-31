import { register } from "node:module";
import { pathToFileURL } from "node:url";
import "@remit/test-dom";
import "./query-timers.mjs";

// A browser resolves the deploy's relative `apiUrl` against the document; Node's
// `Request` has no document, so the generated client's absolute-URL requirement
// is met by pinning the API base to jsdom's own origin.
globalThis.__REMIT_CONFIG__ = { apiUrl: "http://localhost" };

register("./loader.mjs", pathToFileURL(`${import.meta.dirname}/`));
