/**
 * A provider over a port. The editor holds it through the interface only, so
 * where the checking runs — a worker here, a backend later — is not something
 * the plugin can observe. Closing it takes the port down with it.
 */
import type {
	CheckResponse,
	LanguageTag,
	ProviderStatus,
	SpellProvider,
	SpellWorkerRequest,
	SpellWorkerResponse,
	SuggestResponse,
} from "./rich-text-spellcheck.js";

export interface SpellWorkerPort {
	post(message: SpellWorkerRequest): void;
	listen(listener: (message: SpellWorkerResponse) => void): void;
	fail(listener: (detail: string) => void): void;
	terminate(): void;
}

/**
 * How long a menu waits for its suggestions before it is told there are none
 * coming. A worker that took the request and went quiet is indistinguishable
 * from a slow one, and skeleton rows that never fill are the worst of both.
 */
export const SUGGEST_DEADLINE_MS = 5000;

/**
 * How long a pass waits before the checker is called stopped. Hunspell answers
 * a paragraph in single-digit milliseconds, so anything past this is a wedged
 * engine rather than a slow one — and a wedged engine is invisible: the marks
 * simply stop moving while `spellcheck` stays off, which on screen is text with
 * nothing wrong in it. The deadline is what turns that into a failure the
 * writer is told about and the browser's own checker takes back.
 */
export const CHECK_DEADLINE_MS = 5000;

interface Waiting {
	settle(response: CheckResponse): void;
	drop(): void;
}

export const openSpellProvider = (
	language: LanguageTag,
	base: string,
	port: SpellWorkerPort,
	bytesExpected = 0,
): SpellProvider => {
	const pending = new Map<string, Waiting>();
	const asking = new Map<
		string,
		{ settle(response: SuggestResponse): void; abandon(reason: Error): void }
	>();
	const listeners = new Set<(status: ProviderStatus) => void>();
	let status: ProviderStatus = {
		state: "opening",
		language,
		bytesLoaded: 0,
		bytesTotal: 0,
	};

	/**
	 * A check that never comes back costs a pass; a suggestion that never comes
	 * back leaves a menu open in front of someone. The one is dropped, the other
	 * is told.
	 */
	const abandonSuggestion = (requestId: string, detail: string): void => {
		const request = asking.get(requestId);
		if (!request) return;
		asking.delete(requestId);
		request.abandon(new Error(detail));
	};

	const abandonSuggestions = (detail: string): void => {
		for (const requestId of [...asking.keys()])
			abandonSuggestion(requestId, detail);
	};

	const publish = (next: ProviderStatus): void => {
		status = next;
		for (const listener of listeners) listener(next);
	};

	port.listen((message) => {
		if (message.type === "opening") {
			publish({
				state: "opening",
				language,
				bytesLoaded: message.bytesLoaded,
				bytesTotal: message.bytesTotal,
			});
			return;
		}
		if (message.type === "ready") {
			publish({ state: "ready", language });
			return;
		}
		if (message.type === "failed") {
			publish({
				state: "failed",
				language,
				reason: message.reason,
				detail: message.detail,
			});
			abandonSuggestions(message.detail);
			return;
		}
		if (message.type === "suggested") {
			const request = asking.get(message.requestId);
			if (!request) return;
			asking.delete(message.requestId);
			request.settle({
				requestId: message.requestId,
				word: message.word,
				suggestions: message.suggestions,
			});
			return;
		}
		const waiting = pending.get(message.requestId);
		if (!waiting) return;
		pending.delete(message.requestId);
		waiting.settle({
			requestId: message.requestId,
			revision: message.revision,
			findings: message.findings,
		});
	});
	const stopped = (detail: string): void => {
		if (status.state !== "failed")
			publish({ state: "failed", language, reason: "worker", detail });
		abandonSuggestions(detail);
	};
	port.fail(stopped);
	port.post({ type: "open", language, base, bytesExpected });

	return {
		language,
		onStatus: (listener) => {
			listeners.add(listener);
			listener(status);
			return () => {
				listeners.delete(listener);
			};
		},
		check: (request) =>
			new Promise((resolve) => {
				const deadline = setTimeout(() => {
					pending.delete(request.requestId);
					stopped(
						`the ${language} checker did not answer within ${CHECK_DEADLINE_MS}ms`,
					);
					// An empty answer rather than a promise nobody settles: the pass is
					// over, and the marks it would have painted are the ones the failed
					// status has just cleared.
					resolve({
						requestId: request.requestId,
						revision: request.revision,
						findings: [],
					});
				}, CHECK_DEADLINE_MS);
				pending.set(request.requestId, {
					settle: (response) => {
						clearTimeout(deadline);
						resolve(response);
					},
					drop: () => clearTimeout(deadline),
				});
				port.post({ type: "check", ...request });
			}),
		suggest: (request) =>
			new Promise((resolve, reject) => {
				const deadline = setTimeout(
					() =>
						abandonSuggestion(
							request.requestId,
							`no suggestions for "${request.word}" within ${SUGGEST_DEADLINE_MS}ms`,
						),
					SUGGEST_DEADLINE_MS,
				);
				asking.set(request.requestId, {
					settle: (response) => {
						clearTimeout(deadline);
						resolve(response);
					},
					abandon: (reason) => {
						clearTimeout(deadline);
						reject(reason);
					},
				});
				port.post({ type: "suggest", ...request });
			}),
		close: () => {
			for (const waiting of pending.values()) waiting.drop();
			pending.clear();
			abandonSuggestions("the checker closed");
			listeners.clear();
			port.terminate();
		},
	};
};
