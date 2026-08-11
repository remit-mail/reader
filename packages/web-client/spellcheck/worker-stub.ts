/**
 * Keeps the spellchecking worker out of a build that staged no dictionaries.
 *
 * Vite emits a worker bundle for whatever module graph reaches a `new
 * Worker(new URL(...))`, and it emits it while transforming that module —
 * before tree-shaking, and whether or not anything in the output still imports
 * it. So a dead branch around the dynamic import is not enough on its own: the
 * bundle is already a file by the time the branch is dropped. The only way the
 * worker never becomes an asset is for the specifier never to resolve to it.
 *
 * The decision is `resolveLanguages`, the same function the staging plugin
 * asks, so there is no second answer to what this build carries.
 */

import type { Plugin } from "vite";
import { resolveLanguages } from "./languages.ts";

const WORKER_MODULE = "@remit/ui/spellcheck-worker";
const STUB = "\0remit-spellcheck-absent";

export const spellcheckWorkerStub = (): Plugin => ({
	name: "remit-spellcheck-worker-stub",
	enforce: "pre",
	resolveId(source) {
		if (source !== WORKER_MODULE) return null;
		const staged = resolveLanguages(process.env.REMIT_SPELLCHECK_LANGUAGES);
		return staged.length === 0 ? STUB : null;
	},
	load(id) {
		// The provider's own contract for a language it cannot check: answer null,
		// start no worker, and leave the browser's checking switched on.
		return id === STUB
			? "export const openSpellcheckWorker = async () => null;\n"
			: null;
	},
});
