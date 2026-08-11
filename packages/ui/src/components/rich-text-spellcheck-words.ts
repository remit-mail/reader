/**
 * The tokeniser. A provider is handed paragraph text and decides for itself
 * where the words are, so this is the one place that answers what a word is —
 * and the session ignore list keys off the same normalisation, so ignoring a
 * word at the start of a sentence ignores it in the middle of the next one.
 */

export interface WordRange {
	readonly start: number;
	readonly end: number;
}

/** What a correction menu shows, and what the engine is asked for. */
export const SUGGESTION_LIMIT = 5;

export const normaliseWord = (word: string): string =>
	word.toLowerCase().replace(/’/g, "'");

/**
 * Every word in the text, in order. Single letters are not offered: they are
 * initials and list markers far more often than they are misspellings.
 */
export const wordsIn = (text: string): readonly WordRange[] => {
	const pattern = /\p{L}[\p{L}\p{M}'’]*/gu;
	const found: WordRange[] = [];
	let match = pattern.exec(text);
	while (match) {
		if (match[0].length > 1) {
			found.push({ start: match.index, end: match.index + match[0].length });
		}
		match = pattern.exec(text);
	}
	return found;
};

export const findMisspellings = (
	text: string,
	known: (word: string) => boolean,
): readonly WordRange[] =>
	wordsIn(text).filter((range) => !known(text.slice(range.start, range.end)));
