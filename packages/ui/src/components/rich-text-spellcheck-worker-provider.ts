/**
 * The `spellcheck.provider` a composer hands the editor, over a real worker.
 * A language with no dictionary answers null and no worker ever starts.
 *
 * Its own module, and deliberately not on the package barrel: a bundler emits
 * the worker chunk for whatever graph reaches this `new URL`, and until the
 * build carries an engine (#692, decision 11) that chunk has no business in an
 * app build.
 */

import type {
	LanguageTag,
	SpellProvider,
	SpellWorkerResponse,
} from "./rich-text-spellcheck.js";
import type { SpellWorkerPort } from "./rich-text-spellcheck-provider.js";
import { openSpellProvider } from "./rich-text-spellcheck-provider.js";
import { dictionaryFor } from "./rich-text-spellcheck-words.js";

const workerPort = (worker: Worker): SpellWorkerPort => ({
	post: (message) => worker.postMessage(message),
	listen: (listener) =>
		worker.addEventListener("message", (event: MessageEvent) =>
			listener(event.data as SpellWorkerResponse),
		),
	fail: (listener) =>
		worker.addEventListener("error", (event: ErrorEvent) =>
			listener(event.message),
		),
	terminate: () => worker.terminate(),
});

export const openSpellcheckWorker = async (
	language: LanguageTag,
): Promise<SpellProvider | null> => {
	if (!dictionaryFor(language)) return null;
	const worker = new Worker(
		new URL("./rich-text-spellcheck-worker.ts", import.meta.url),
		{ type: "module" },
	);
	return openSpellProvider(language, workerPort(worker));
};
