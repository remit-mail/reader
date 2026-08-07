import { useCallback, useEffect, useMemo, useState } from "react";
import { detectComposeLanguage } from "../lib/detect-compose-language.js";

/**
 * Where the composer's current language came from. A value rather than an
 * `isManual` flag: the chip reads it, and the spellchecker slice (#692) will
 * want to know whether a language was chosen or guessed before it spends a
 * worker on it.
 */
export type ComposeLanguageSource = "account" | "detected" | "manual";

export interface ComposeLanguageState {
	language: string;
	source: ComposeLanguageSource;
}

export interface ComposeLanguageControl extends ComposeLanguageState {
	/** The user picked this language. Detection stops for the rest of the message. */
	choose: (tag: string) => void;
}

export interface UseComposeLanguageInput {
	/** The account's configured tags, most-used first. The first is the default. */
	languages: readonly string[];
	/** The body as plain text. The quoted reply block is not part of it. */
	text: string;
	/**
	 * The tag a reopened draft was written under. Treated as a choice already
	 * made: it is the only record of a manual pick a draft carries, and detection
	 * would otherwise overwrite it the moment the draft came back.
	 */
	initialLanguage?: string;
	debounceMs?: number;
}

/**
 * The composer's language while a message is being written: the account default
 * until detection has enough text to say otherwise, and whatever the user
 * picked from the moment they pick one.
 */
export const useComposeLanguage = ({
	languages,
	text,
	initialLanguage,
	debounceMs = 400,
}: UseComposeLanguageInput): ComposeLanguageControl => {
	// A caller building this array inline hands over a new identity on every
	// render, and an effect keyed on it would restart its timer forever.
	const candidateKey = languages.join(",");
	const candidates = useMemo(
		() => candidateKey.split(",").filter((tag) => tag !== ""),
		[candidateKey],
	);
	const accountDefault = candidates[0] ?? "en";

	const [state, setState] = useState<ComposeLanguageState>(() =>
		initialLanguage
			? { language: initialLanguage, source: "manual" }
			: { language: accountDefault, source: "account" },
	);

	const settled = state.source === "manual";

	useEffect(() => {
		if (settled) return;
		const timer = setTimeout(() => {
			const detected = detectComposeLanguage(text, candidates);
			const language = detected ?? accountDefault;
			const source: ComposeLanguageSource = detected ? "detected" : "account";
			setState((current) => {
				if (current.source === "manual") return current;
				if (current.language === language && current.source === source) {
					return current;
				}
				return { language, source };
			});
		}, debounceMs);
		return () => clearTimeout(timer);
	}, [settled, text, candidates, accountDefault, debounceMs]);

	const choose = useCallback((tag: string) => {
		setState({ language: tag, source: "manual" });
	}, []);

	return { ...state, choose };
};
