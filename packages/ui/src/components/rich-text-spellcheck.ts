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

/**
 * One word, asked when a correction menu opens. Never a paragraph: a menu is
 * about the word under the pointer, and asking wider would spend the engine on
 * words nobody is looking at.
 */
export interface SuggestRequest {
	readonly requestId: string;
	readonly language: LanguageTag;
	readonly word: string;
}

export interface SuggestResponse {
	readonly requestId: string;
	readonly word: string;
	readonly suggestions: readonly string[];
}

export type ProviderStatus =
	| { readonly state: "opening"; readonly language: LanguageTag }
	| { readonly state: "ready"; readonly language: LanguageTag }
	/** Nothing here checks this language, and the browser is welcome to. */
	| { readonly state: "unavailable"; readonly language: LanguageTag }
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
	/** Rejects when the checker cannot answer, so the menu can say so. */
	suggest(request: SuggestRequest): Promise<SuggestResponse>;
	close(): void;
}

export interface SpellcheckOptions {
	/** Resolving null means no dictionary for that language. */
	provider(language: LanguageTag): Promise<SpellProvider | null>;
	onStatus?(status: ProviderStatus): void;
	/**
	 * Adds the word to whatever holds the writer's own words. The correction
	 * menu offers the row only when this is passed.
	 */
	onAddWord?(word: string): void;
}

export type SpellWorkerRequest =
	| { readonly type: "open"; readonly language: LanguageTag }
	| ({ readonly type: "check" } & CheckRequest)
	| ({ readonly type: "suggest" } & SuggestRequest);

export type SpellWorkerResponse =
	| { readonly type: "ready"; readonly language: LanguageTag }
	| {
			readonly type: "failed";
			readonly language: LanguageTag;
			readonly reason: "download" | "engine";
			readonly detail: string;
	  }
	| ({ readonly type: "checked" } & CheckResponse)
	| ({ readonly type: "suggested" } & SuggestResponse);
