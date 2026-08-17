import { register } from "node:module";
import { pathToFileURL } from "node:url";
import "@remit/test-dom";
import "./query-timers.mjs";

register("./loader.mjs", pathToFileURL(`${import.meta.dirname}/`));
