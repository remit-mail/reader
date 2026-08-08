/**
 * What the editor asks and what an answer looks like. Nothing here is shaped by
 * a particular engine: a span is one text node's characters, a finding is a
 * range inside it, and `revision` is the document the spans were read at, so an
 * answer that arrives after the text moved is dropped rather than painted onto
 * characters that are no longer there (#692).
 */

export type LanguageTag = string;

export interface CheckSpan {
	readonly spanId: string;
	readonly text: string;
}

export interface CheckRequest {
	readonly requestId: string;
	readonly language: LanguageTag;
	readonly revision: number;
	readonly spans: readonly CheckSpan[];
}

export interface Finding {
	readonly spanId: string;
	readonly start: number;
	readonly end: number;
	readonly kind: "spelling";
	readonly suggestions: readonly string[];
}

export interface CheckResponse {
	readonly requestId: string;
	readonly revision: number;
	readonly findings: readonly Finding[];
}

export type ProviderStatus =
	| { readonly state: "opening"; readonly language: LanguageTag }
	| { readonly state: "ready"; readonly language: LanguageTag }
	| {
			readonly state: "failed";
			readonly language: LanguageTag;
			readonly reason: "download" | "engine" | "worker";
			readonly detail: string;
	  };

export interface SpellProvider {
	readonly language: LanguageTag;
	/** Emits the current status to the listener before any later one. */
	onStatus(listener: (status: ProviderStatus) => void): () => void;
	check(request: CheckRequest): Promise<CheckResponse>;
	close(): void;
}

export interface SpellcheckOptions {
	/** Resolving null means no dictionary for that language. */
	provider(language: LanguageTag): Promise<SpellProvider | null>;
	onStatus?(status: ProviderStatus): void;
}

export type SpellWorkerRequest =
	| { readonly type: "open"; readonly language: LanguageTag }
	| ({ readonly type: "check" } & CheckRequest);

export type SpellWorkerResponse =
	| { readonly type: "ready"; readonly language: LanguageTag }
	| ({ readonly type: "checked" } & CheckResponse);
