/**
 * The stand-in the marks, the menu and the stale-answer stories drive the
 * editor with. It is not a spellchecker and never was: those tests are about
 * what the editor does with an answer, so the answer has to be a fixed one.
 * What a real dictionary says is proved against a real dictionary, in
 * `rich-text-spellcheck-worker.test.ts`.
 */
import { normaliseWord } from "./rich-text-spellcheck-words.js";

const KNOWN = new Set([
	"a",
	"again",
	"agenda",
	"and",
	"are",
	"attached",
	"budget",
	"confirm",
	"figures",
	"for",
	"is",
	"i",
	"meeting",
	"notes",
	"report",
	"schedule",
	"separately",
	"the",
	"this",
	"today",
	"tomorrow",
	"well",
	"will",
]);

const CORRECTIONS = new Map<string, readonly string[]>([
	["ths", ["the", "this", "than", "that", "them"]],
	["redy", ["ready", "read", "very"]],
	["attachd", ["attached"]],
	["tomorow", ["tomorrow"]],
	["budgt", ["budget"]],
	["meetign", ["meeting"]],
	["confrm", ["confirm"]],
	["schedual", ["schedule"]],
	["seperately", ["separately"]],
]);

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

export const stubKnows = (word: string): boolean =>
	KNOWN.has(normaliseWord(word));

export const stubSuggestionsFor = (word: string): readonly string[] =>
	(CORRECTIONS.get(normaliseWord(word)) ?? []).map((suggestion) =>
		wearingTheCaseOf(word, suggestion),
	);
