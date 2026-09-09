import { pathToFileURL } from "node:url";

const empty = pathToFileURL(`${import.meta.dirname}/css-empty.mjs`).href;

export const resolve = async (specifier, context, nextResolve) =>
	specifier.endsWith(".css")
		? { url: empty, shortCircuit: true, format: "module" }
		: nextResolve(specifier, context);
