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

export const spellcheckLanguages = (): readonly string[] =>
	typeof __REMIT_SPELLCHECK_LANGUAGES__ === "undefined"
		? []
		: __REMIT_SPELLCHECK_LANGUAGES__;

export const spellcheckBase = (): string =>
	typeof __REMIT_SPELLCHECK_BASE__ === "undefined"
		? "/spellcheck/"
		: __REMIT_SPELLCHECK_BASE__;

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
