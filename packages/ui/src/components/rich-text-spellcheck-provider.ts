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
} from "./rich-text-spellcheck.js";

export interface SpellWorkerPort {
	post(message: SpellWorkerRequest): void;
	listen(listener: (message: SpellWorkerResponse) => void): void;
	fail(listener: (detail: string) => void): void;
	terminate(): void;
}

export const openSpellProvider = (
	language: LanguageTag,
	port: SpellWorkerPort,
): SpellProvider => {
	const pending = new Map<string, (response: CheckResponse) => void>();
	const listeners = new Set<(status: ProviderStatus) => void>();
	let status: ProviderStatus = { state: "opening", language };

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
	port.fail((detail) =>
		publish({ state: "failed", language, reason: "worker", detail }),
	);
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
		close: () => {
			pending.clear();
			listeners.clear();
			port.terminate();
		},
	};
};
