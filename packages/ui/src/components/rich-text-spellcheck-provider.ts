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

export const openSpellProvider = (
	language: LanguageTag,
	port: SpellWorkerPort,
): SpellProvider => {
	const pending = new Map<string, (response: CheckResponse) => void>();
	const asking = new Map<
		string,
		{ settle(response: SuggestResponse): void; abandon(reason: Error): void }
	>();
	const listeners = new Set<(status: ProviderStatus) => void>();
	let status: ProviderStatus = { state: "opening", language };

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
		const settle = pending.get(message.requestId);
		if (!settle) return;
		pending.delete(message.requestId);
		settle({
			requestId: message.requestId,
			revision: message.revision,
			findings: message.findings,
		});
	});
	port.fail((detail) => {
		publish({ state: "failed", language, reason: "worker", detail });
		abandonSuggestions(detail);
	});
	port.post({ type: "open", language });

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
				pending.set(request.requestId, resolve);
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
			pending.clear();
			abandonSuggestions("the checker closed");
			listeners.clear();
			port.terminate();
		},
	};
};
