/**
 * The checking side, off the main thread. It answers with the revision it was
 * asked at and never touches the document, which is what lets the editor throw
 * a late answer away. The word list it consults is a stub; the engine that
 * replaces it changes nothing above this file.
 */

import type {
	CheckRequest,
	Finding,
	SpellWorkerRequest,
	SpellWorkerResponse,
} from "./rich-text-spellcheck.js";
import {
	dictionaryFor,
	findMisspellings,
	suggestionsFor,
} from "./rich-text-spellcheck-words.js";

interface WorkerScope {
	postMessage(message: SpellWorkerResponse): void;
	addEventListener(
		type: "message",
		listener: (event: MessageEvent<SpellWorkerRequest>) => void,
	): void;
}

const spell = (request: CheckRequest): Finding[] => {
	const words = dictionaryFor(request.language);
	if (!words) return [];
	return request.spans.flatMap((span) =>
		findMisspellings(span.text, words).map((range) => ({
			spanId: span.spanId,
			start: range.start,
			end: range.end,
			kind: "spelling" as const,
			suggestions: [],
		})),
	);
};

const scope = globalThis as unknown as WorkerScope;

scope.addEventListener("message", ({ data }) => {
	if (data.type === "open") {
		scope.postMessage({ type: "ready", language: data.language });
		return;
	}
	if (data.type === "suggest") {
		const words = dictionaryFor(data.language);
		scope.postMessage({
			type: "suggested",
			requestId: data.requestId,
			word: data.word,
			suggestions: words ? suggestionsFor(data.word, words) : [],
		});
		return;
	}
	scope.postMessage({
		type: "checked",
		requestId: data.requestId,
		revision: data.revision,
		findings: spell(data),
	});
});
