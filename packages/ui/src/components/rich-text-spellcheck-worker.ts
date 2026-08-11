/**
 * The checking side, off the main thread. It answers with the revision it was
 * asked at and never touches the document, which is what lets the editor throw
 * a late answer away.
 *
 * One worker holds one language's engine. Everything before `ready` is a
 * download, reported as it goes, and every way it can end badly is a message
 * the composer can put words to — never silence, because the browser's own
 * checker is still on and the writer must not be left with neither.
 */

import type {
	CheckRequest,
	Finding,
	SpellWorkerRequest,
	SpellWorkerResponse,
} from "./rich-text-spellcheck.js";
import type { SpellEngine } from "./rich-text-spellcheck-engine.js";
import { openEngine } from "./rich-text-spellcheck-engine.js";
import {
	findMisspellings,
	SUGGESTION_LIMIT,
} from "./rich-text-spellcheck-words.js";

interface WorkerScope {
	postMessage(message: SpellWorkerResponse): void;
	addEventListener(
		type: "message",
		listener: (event: MessageEvent<SpellWorkerRequest>) => void,
	): void;
}

const scope = globalThis as unknown as WorkerScope;

let engine: SpellEngine | null = null;

const spell = (request: CheckRequest, checker: SpellEngine): Finding[] =>
	request.spans.flatMap((span) =>
		findMisspellings(span.text, (word) => checker.spell(word)).map((range) => ({
			spanId: span.spanId,
			start: range.start,
			end: range.end,
			kind: "spelling" as const,
			suggestions: [],
		})),
	);

const open = async (
	language: string,
	base: string,
	bytesExpected: number,
): Promise<void> => {
	// Whatever was answering before is not answering for this language, and a
	// failed open must not leave the previous dictionary marking the new text.
	engine?.close();
	engine = null;
	const result = await openEngine({
		base,
		tag: language,
		bytesExpected,
		onProgress: ({ bytesLoaded, bytesTotal }) =>
			scope.postMessage({
				type: "opening",
				language,
				bytesLoaded,
				bytesTotal,
			}),
	});
	if (!result.ok) {
		scope.postMessage({
			type: "failed",
			language,
			reason: result.reason,
			detail: result.detail,
		});
		return;
	}
	engine = result.engine;
	scope.postMessage({ type: "ready", language });
};

scope.addEventListener("message", ({ data }) => {
	if (data.type === "open") {
		open(data.language, data.base, data.bytesExpected).catch(
			(error: unknown) => {
				scope.postMessage({
					type: "failed",
					language: data.language,
					reason: "engine",
					detail: error instanceof Error ? error.message : String(error),
				});
			},
		);
		return;
	}
	if (data.type === "suggest") {
		scope.postMessage({
			type: "suggested",
			requestId: data.requestId,
			word: data.word,
			suggestions: engine
				? engine.suggest(data.word).slice(0, SUGGESTION_LIMIT)
				: [],
		});
		return;
	}
	scope.postMessage({
		type: "checked",
		requestId: data.requestId,
		revision: data.revision,
		findings: engine ? spell(data, engine) : [],
	});
});
