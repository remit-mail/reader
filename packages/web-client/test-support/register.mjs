import { register } from "node:module";
import { pathToFileURL } from "node:url";
import "./dom-env.mjs";
import "./query-timers.mjs";

register("./loader.mjs", pathToFileURL(`${import.meta.dirname}/`));
