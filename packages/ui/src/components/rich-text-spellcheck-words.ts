/**
 * The placeholder a real dictionary replaces (#707): a word list small enough
 * to read, so the marks and the corrections can be driven end to end before an
 * engine exists. The tokeniser is the part that stays — a provider is handed
 * paragraph text and decides for itself where the words are.
 */
import type { LanguageTag } from "./rich-text-spellcheck.js";

export interface WordRange {
	readonly start: number;
	readonly end: number;
}

/** What a correction menu shows, and what the engine is asked for. */
export const SUGGESTION_LIMIT = 5;

const ENGLISH: ReadonlySet<string> = new Set([
	"a",
	"about",
	"address",
	"after",
	"afternoon",
	"again",
	"agenda",
	"all",
	"already",
	"also",
	"always",
	"an",
	"and",
	"answer",
	"any",
	"apologies",
	"approved",
	"are",
	"as",
	"at",
	"attached",
	"available",
	"be",
	"because",
	"been",
	"before",
	"both",
	"budget",
	"but",
	"by",
	"calendar",
	"call",
	"can",
	"change",
	"client",
	"colleague",
	"come",
	"confirm",
	"could",
	"customer",
	"day",
	"deadline",
	"decision",
	"definitely",
	"delivery",
	"did",
	"do",
	"document",
	"does",
	"done",
	"down",
	"draft",
	"each",
	"email",
	"end",
	"environment",
	"even",
	"every",
	"few",
	"figures",
	"find",
	"first",
	"follow",
	"for",
	"forward",
	"friday",
	"from",
	"get",
	"give",
	"go",
	"good",
	"had",
	"has",
	"have",
	"he",
	"help",
	"her",
	"here",
	"him",
	"his",
	"how",
	"i",
	"if",
	"in",
	"into",
	"invoice",
	"is",
	"it",
	"its",
	"just",
	"keep",
	"know",
	"last",
	"let",
	"like",
	"long",
	"look",
	"made",
	"make",
	"many",
	"may",
	"me",
	"meeting",
	"message",
	"month",
	"more",
	"morning",
	"most",
	"much",
	"must",
	"my",
	"necessary",
	"need",
	"new",
	"next",
	"no",
	"not",
	"note",
	"notes",
	"now",
	"number",
	"numbers",
	"occurred",
	"of",
	"off",
	"office",
	"on",
	"once",
	"one",
	"only",
	"or",
	"other",
	"our",
	"out",
	"over",
	"own",
	"page",
	"payment",
	"people",
	"please",
	"presentation",
	"price",
	"process",
	"product",
	"project",
	"put",
	"quarter",
	"question",
	"read",
	"ready",
	"receipt",
	"receive",
	"received",
	"recommend",
	"regards",
	"report",
	"review",
	"right",
	"same",
	"say",
	"schedule",
	"see",
	"send",
	"sent",
	"separate",
	"service",
	"she",
	"should",
	"show",
	"since",
	"so",
	"some",
	"sorry",
	"still",
	"such",
	"summary",
	"support",
	"take",
	"team",
	"tell",
	"than",
	"thanks",
	"that",
	"the",
	"their",
	"them",
	"then",
	"there",
	"these",
	"they",
	"thing",
	"think",
	"this",
	"those",
	"through",
	"time",
	"to",
	"today",
	"together",
	"tomorrow",
	"too",
	"two",
	"up",
	"update",
	"us",
	"use",
	"version",
	"very",
	"want",
	"was",
	"way",
	"we",
	"week",
	"welcome",
	"well",
	"were",
	"what",
	"when",
	"where",
	"which",
	"while",
	"who",
	"why",
	"will",
	"with",
	"word",
	"work",
	"would",
	"year",
	"yes",
	"you",
	"your",
]);

const DICTIONARIES: ReadonlyMap<string, ReadonlySet<string>> = new Map([
	["en", ENGLISH],
]);

export const dictionaryFor = (
	language: LanguageTag,
): ReadonlySet<string> | null =>
	DICTIONARIES.get(language.toLowerCase().split("-")[0]) ?? null;

/**
 * The form a word is looked up and remembered under. The session's ignore list
 * uses it too, so ignoring a word at the start of a sentence ignores it in the
 * middle of the next one.
 */
export const normaliseWord = (word: string): string =>
	word.toLowerCase().replace(/’/g, "'");

export const findMisspellings = (
	text: string,
	words: ReadonlySet<string>,
): readonly WordRange[] => {
	const pattern = /\p{L}[\p{L}\p{M}'’]*/gu;
	const found: WordRange[] = [];
	let match = pattern.exec(text);
	while (match) {
		const word = match[0];
		if (word.length > 1 && !words.has(normaliseWord(word))) {
			found.push({ start: match.index, end: match.index + word.length });
		}
		match = pattern.exec(text);
	}
	return found;
};

const NEAR_ENOUGH = 2;

/**
 * Optimal string alignment: insertions, deletions, substitutions and the
 * swapped pair of letters that is most of what a keyboard produces. Rows are
 * abandoned once every cell in one is further away than a suggestion may be.
 */
const editDistance = (word: string, candidate: string): number => {
	let twoBack: number[] = [];
	let previous = Array.from({ length: candidate.length + 1 }, (_, at) => at);
	for (let row = 1; row <= word.length; row += 1) {
		const current = [row];
		let best = row;
		for (let column = 1; column <= candidate.length; column += 1) {
			const cost = word[row - 1] === candidate[column - 1] ? 0 : 1;
			let step = Math.min(
				current[column - 1] + 1,
				previous[column] + 1,
				previous[column - 1] + cost,
			);
			if (
				row > 1 &&
				column > 1 &&
				word[row - 1] === candidate[column - 2] &&
				word[row - 2] === candidate[column - 1]
			) {
				step = Math.min(step, twoBack[column - 2] + 1);
			}
			current[column] = step;
			if (step < best) best = step;
		}
		if (best > NEAR_ENOUGH) return NEAR_ENOUGH + 1;
		twoBack = previous;
		previous = current;
	}
	return previous[candidate.length];
};

const sharedPrefix = (word: string, candidate: string): number => {
	let shared = 0;
	while (
		shared < word.length &&
		shared < candidate.length &&
		word[shared] === candidate[shared]
	) {
		shared += 1;
	}
	return shared;
};

/** A suggestion arrives dressed the way the word it replaces was written. */
const wearingTheCaseOf = (word: string, suggestion: string): string => {
	const upper = word.toUpperCase();
	if (word === upper && word !== word.toLowerCase())
		return suggestion.toUpperCase();
	if (word[0] === upper[0] && word[0] !== word.toLowerCase()[0]) {
		return suggestion[0].toUpperCase() + suggestion.slice(1);
	}
	return suggestion;
};

/**
 * The corrections a word list can offer without an engine: everything within a
 * couple of keystrokes, nearest first, and the one that starts the same way
 * ahead of the one that does not.
 */
export const suggestionsFor = (
	word: string,
	words: ReadonlySet<string>,
): readonly string[] => {
	const target = normaliseWord(word);
	if (target.length < 2 || words.has(target)) return [];
	const ranked: { candidate: string; distance: number; prefix: number }[] = [];
	for (const candidate of words) {
		if (Math.abs(candidate.length - target.length) > NEAR_ENOUGH) continue;
		const distance = editDistance(target, candidate);
		if (distance > NEAR_ENOUGH) continue;
		ranked.push({
			candidate,
			distance,
			prefix: sharedPrefix(target, candidate),
		});
	}
	ranked.sort(
		(left, right) =>
			left.distance - right.distance ||
			right.prefix - left.prefix ||
			left.candidate.localeCompare(right.candidate),
	);
	return ranked
		.slice(0, SUGGESTION_LIMIT)
		.map(({ candidate }) => wearingTheCaseOf(word, candidate));
};
