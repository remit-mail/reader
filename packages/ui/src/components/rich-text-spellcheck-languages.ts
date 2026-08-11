/**
 * What this build carries, and where it serves it from. Both are decided by
 * `REMIT_SPELLCHECK_LANGUAGES` at build time and written in by the web client's
 * spellcheck plugin, which stages exactly the same set — so there is no second
 * list to fall out of step with the files on disk.
 *
 * A build that stages nothing leaves both undefined, and every language is
 * `unavailable`: no worker starts, and the browser keeps checking.
 */

declare const __REMIT_SPELLCHECK_LANGUAGES__: readonly string[];
declare const __REMIT_SPELLCHECK_BASE__: string;
declare const __REMIT_SPELLCHECK_BYTES__: Readonly<Record<string, number>>;

export const spellcheckLanguages = (): readonly string[] =>
	typeof __REMIT_SPELLCHECK_LANGUAGES__ === "undefined"
		? []
		: __REMIT_SPELLCHECK_LANGUAGES__;

/**
 * Absolute, and resolved here rather than baked in: a Storybook build is
 * published under a path it cannot know at build time, so what the plugin
 * writes in is relative and the document says where it lands. The app's own
 * base is already absolute and survives the same resolution unchanged.
 */
export const spellcheckBase = (): string => {
	const staged =
		typeof __REMIT_SPELLCHECK_BASE__ === "undefined" ||
		__REMIT_SPELLCHECK_BASE__ === ""
			? "/spellcheck/"
			: __REMIT_SPELLCHECK_BASE__;
	if (typeof document === "undefined") return staged;
	return new URL(staged, document.baseURI).href;
};

/**
 * What opening a language costs, counted by the build over the bytes it staged.
 * `content-length` cannot answer this: the engine and the dictionaries are
 * served brotli-compressed, so the header is the compressed length while what
 * arrives — and what the composer counts — is the decompressed file.
 */
export const spellcheckBytes = (tag: string): number =>
	typeof __REMIT_SPELLCHECK_BYTES__ === "undefined"
		? 0
		: (__REMIT_SPELLCHECK_BYTES__[tag] ?? 0);

/**
 * The staged dictionary that answers for a tag. `en-GB` takes the British one
 * where the build carries it and the American one where it does not, because
 * being checked against the wrong English is a long way better than not being
 * checked at all.
 */
export const dictionaryTagFor = (
	language: string,
	built: readonly string[] = spellcheckLanguages(),
): string | null => {
	const wanted = language.toLowerCase();
	const exact = built.find((tag) => tag.toLowerCase() === wanted);
	if (exact) return exact;
	const base = wanted.split("-")[0];
	return built.find((tag) => tag.toLowerCase().split("-")[0] === base) ?? null;
};
