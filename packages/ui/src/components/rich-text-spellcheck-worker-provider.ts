/**
 * The `spellcheck.provider` a composer hands the editor, over a real worker.
 * A language this build carries no dictionary for answers null and no worker
 * ever starts, which is what the editor turns into `unavailable`.
 *
 * Its own module, and deliberately not on the package barrel: a bundler emits
 * the worker chunk for whatever graph reaches this `new URL`, and a build that
 * stages no dictionaries has no business carrying that chunk.
 */

import type {
	LanguageTag,
	SpellProvider,
	SpellWorkerResponse,
} from "./rich-text-spellcheck.js";
import {
	dictionaryTagFor,
	spellcheckBase,
} from "./rich-text-spellcheck-languages.js";
import type { SpellWorkerPort } from "./rich-text-spellcheck-provider.js";
import { openSpellProvider } from "./rich-text-spellcheck-provider.js";

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
	const tag = dictionaryTagFor(language);
	if (!tag) return null;
	const worker = new Worker(
		new URL("./rich-text-spellcheck-worker.ts", import.meta.url),
		{ type: "module" },
	);
	return openSpellProvider(tag, spellcheckBase(), workerPort(worker));
};
