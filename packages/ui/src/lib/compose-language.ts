/**
 * The composer's language: which BCP 47 tag a message is being written in,
 * what a browser will and will not do with it, and how it travels on the
 * message.
 *
 * A page cannot choose the browser's spellcheck dictionary. Chrome and Safari
 * ignore `lang` outright; Firefox reads it but only picks among dictionaries
 * the user already installed. Nothing here claims otherwise — what the tag buys
 * is a Firefox dictionary when one is present, a screen-reader voice, and a
 * message the recipient's client can read the language off. See issue #686.
 */

import { spellcheckLanguages } from "../components/rich-text-spellcheck-languages.js";

/**
 * A language the composer offers, and the ISO 639-3 code `franc-min` knows it
 * by. The two are separate alphabets: the tag is what goes on the document and
 * on the wire, the code is what the detector's trigram tables are keyed on.
 *
 * The list is bounded by what `franc-min` can detect — a language it has no
 * table for could be picked by hand but never detected, which is a menu entry
 * that behaves differently from its neighbours for no reason a user can see.
 */
export interface ComposeLanguageOption {
	tag: string;
	detectionCode: string;
}

export const COMPOSE_LANGUAGE_OPTIONS: readonly ComposeLanguageOption[] = [
	{ tag: "ar", detectionCode: "arb" },
	{ tag: "az", detectionCode: "azj" },
	{ tag: "be", detectionCode: "bel" },
	{ tag: "bg", detectionCode: "bul" },
	{ tag: "bs", detectionCode: "bos" },
	{ tag: "cs", detectionCode: "ces" },
	{ tag: "de", detectionCode: "deu" },
	{ tag: "en", detectionCode: "eng" },
	{ tag: "es", detectionCode: "spa" },
	{ tag: "fa", detectionCode: "pes" },
	{ tag: "fr", detectionCode: "fra" },
	{ tag: "ha", detectionCode: "hau" },
	{ tag: "hi", detectionCode: "hin" },
	{ tag: "hr", detectionCode: "hrv" },
	{ tag: "hu", detectionCode: "hun" },
	{ tag: "id", detectionCode: "ind" },
	{ tag: "ig", detectionCode: "ibo" },
	{ tag: "it", detectionCode: "ita" },
	{ tag: "jv", detectionCode: "jav" },
	{ tag: "kk", detectionCode: "kaz" },
	{ tag: "mr", detectionCode: "mar" },
	{ tag: "ms", detectionCode: "zlm" },
	{ tag: "ne", detectionCode: "npi" },
	{ tag: "nl", detectionCode: "nld" },
	{ tag: "pl", detectionCode: "pol" },
	{ tag: "ps", detectionCode: "pbu" },
	{ tag: "pt", detectionCode: "por" },
	{ tag: "ro", detectionCode: "ron" },
	{ tag: "ru", detectionCode: "rus" },
	{ tag: "so", detectionCode: "som" },
	{ tag: "sr", detectionCode: "srp" },
	{ tag: "su", detectionCode: "sun" },
	{ tag: "sv", detectionCode: "swe" },
	{ tag: "sw", detectionCode: "swh" },
	{ tag: "tl", detectionCode: "tgl" },
	{ tag: "tr", detectionCode: "tur" },
	{ tag: "uk", detectionCode: "ukr" },
	{ tag: "ur", detectionCode: "urd" },
	{ tag: "vi", detectionCode: "vie" },
	{ tag: "yo", detectionCode: "yor" },
	{ tag: "zu", detectionCode: "zul" },
];

/** The language subtag of a BCP 47 tag: `en` out of `en-GB`, lower-cased. */
export const primaryLanguageSubtag = (tag: string): string =>
	(tag.split("-")[0] ?? "").toLowerCase();

const byPrimarySubtag = new Map(
	COMPOSE_LANGUAGE_OPTIONS.map((option) => [option.tag, option]),
);

/**
 * The detector code for a tag, or null when nothing can detect it. A region
 * resolves through its language — no trigram table separates `en-GB` from
 * `en-US`, and pretending one does would put a tag on the message the text
 * never supported.
 */
export const detectionCodeFor = (tag: string): string | null =>
	byPrimarySubtag.get(primaryLanguageSubtag(tag))?.detectionCode ?? null;

const WELL_FORMED_TAG = /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i;

/** The tag as the chip shows it: two or three letters, upper case. */
export const languageChipLabel = (tag: string): string =>
	primaryLanguageSubtag(tag).toUpperCase();

/**
 * The language's own name for itself — `Nederlands`, not `Dutch`. A menu of
 * languages is read by someone who reads that language, and an endonym is the
 * entry they recognise without translating it first. Falls back to the tag when
 * the platform has no name for it.
 */
export const languageLabel = (tag: string): string => {
	// `Intl.DisplayNames` throws a RangeError on anything that is not a
	// well-formed tag, and a stored setting is text a user can have edited.
	if (!WELL_FORMED_TAG.test(tag)) return tag;
	const names = new Intl.DisplayNames([tag], {
		type: "language",
		fallback: "none",
	});
	const named = names.of(tag);
	if (!named) return tag;
	return named.charAt(0).toLocaleUpperCase(tag) + named.slice(1);
};

/**
 * The languages an account writes in when it has not said: the browser's own
 * ordered answer first, then the dictionaries this build carries, then `en`.
 *
 * The dictionaries are in there because the browser routinely names one
 * language and the writer uses another — Dutch mail written on an English
 * browser is the ordinary case, not the exception. A candidate set of one turns
 * detection off, since there is nothing to choose between, and every message
 * then keeps the default tag and is checked against the wrong dictionary. What
 * the deployment staged is the other statement about which languages are
 * written here, and it is a short list, which is what keeps detection accurate.
 */
export const defaultComposeLanguages = (
	locales: readonly string[],
	built: readonly string[] = spellcheckLanguages(),
): string[] => {
	const known = [...locales, ...built].filter(
		(locale) => detectionCodeFor(locale) !== null,
	);
	const unique = [...new Set(known.map(primaryLanguageSubtag))];
	if (!unique.includes("en")) unique.push("en");
	return unique;
};

/**
 * The one sentence at the foot of the language menu naming where the browser
 * keeps the setting that does fix spelling. A page cannot link to
 * `chrome://settings/languages`, so it is text; and reading the user agent to
 * name where a setting lives is not feature detection, because there is nothing
 * to detect.
 */
export const browserSpellcheckHelp = (userAgent: string): string => {
	if (/iPhone|iPad|iPod/.test(userAgent)) {
		return "On iPhone and iPad the keyboard decides this. Add the language under Settings, then General, then Keyboard.";
	}
	if (/Edg\//.test(userAgent)) {
		return "Edge checks every language you add under Settings, then Languages. Adding one there checks it alongside the others.";
	}
	if (/Firefox\//.test(userAgent)) {
		return "Firefox uses this setting. Right-click the message to add a dictionary for it.";
	}
	if (/Chrome\/|Chromium\//.test(userAgent)) {
		return "Chrome checks every language you add under Settings, then Languages. Adding one there checks it alongside the others.";
	}
	if (/Safari\//.test(userAgent)) {
		return "macOS decides this under Keyboard, then Text Input, then Spelling. Automatic by Language covers every language enabled there.";
	}
	return "Your browser decides which dictionaries it checks. Add this language in its own language settings to have it spellchecked.";
};

const parseHtml = (html: string): Document =>
	new DOMParser().parseFromString(html, "text/html");

const singleRootElement = (body: HTMLElement): Element | null => {
	const elements = [...body.children];
	if (elements.length !== 1) return null;
	const only = elements[0];
	if (!only) return null;
	const hasStrayText = [...body.childNodes].some(
		(node) => node !== only && (node.textContent ?? "").trim() !== "",
	);
	return hasStrayText ? null : only;
};

/**
 * The outgoing HTML under one `<div lang>`, so the recipient's client reads the
 * language off the message rather than guessing it.
 *
 * Re-wrapping is idempotent: a document that already sits under a language
 * wrapper has that wrapper's tag replaced. Autosave runs this on every keystroke
 * batch, and a draft that gained a `<div>` per save would arrive nested forty
 * deep.
 */
export const wrapWithLanguage = (html: string, tag: string): string => {
	if (html === "") return "";
	const document = parseHtml(html);
	const existing = singleRootElement(document.body);
	if (existing?.tagName === "DIV" && existing.hasAttribute("lang")) {
		existing.setAttribute("lang", tag);
		return document.body.innerHTML;
	}
	// Built through the DOM rather than by string concatenation: a stored
	// setting is text a user can have edited, and a tag carrying a quote would
	// otherwise close the attribute and put markup into the message.
	const wrapper = document.createElement("div");
	wrapper.setAttribute("lang", tag);
	while (document.body.firstChild) wrapper.append(document.body.firstChild);
	document.body.append(wrapper);
	return document.body.innerHTML;
};

/** What `wrapWithLanguage` wrote, taken back apart for the editor to reopen on. */
export const unwrapLanguage = (
	html: string,
): { html: string; language: string | null } => {
	if (html === "") return { html, language: null };
	const document = parseHtml(html);
	const root = singleRootElement(document.body);
	if (root?.tagName !== "DIV" || !root.hasAttribute("lang")) {
		return { html, language: null };
	}
	return { html: root.innerHTML, language: root.getAttribute("lang") };
};
