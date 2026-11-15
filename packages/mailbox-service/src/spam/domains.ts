import { domainToUnicode } from "node:url";
import { CONFUSABLES } from "./confusables-data.js";

let prototypes: ReadonlyMap<string, string> | undefined;

const prototypeOf = (char: string): string => {
	prototypes ??= new Map(
		CONFUSABLES.split("\n").map((line): [string, string] => {
			const [source, prototype] = line.split("\t");
			return [source, prototype];
		}),
	);
	return prototypes.get(char) ?? char;
};

/**
 * The UTS #39 skeleton of a domain, read in Unicode: NFD, every character
 * replaced by its prototype from Unicode's confusables.txt, NFD again. Two
 * domains with one skeleton look the same in a mail client.
 */
export const skeleton = (domain: string): string =>
	[...unicodeDomain(domain).normalize("NFD")]
		.map(prototypeOf)
		.join("")
		.normalize("NFD");

export const unicodeDomain = (domain: string): string =>
	domainToUnicode(domain) || domain;

export const isPunycode = (domain: string): boolean =>
	domain
		.toLowerCase()
		.split(".")
		.some((label) => label.startsWith("xn--"));

export const imitatesAscii = (domain: string): boolean =>
	/^[\x20-\x7e]*$/.test(skeleton(domain).replace(/\p{M}/gu, ""));

const SCRIPTS: readonly [string, RegExp][] = [
	["Latin", /\p{Script=Latin}/u],
	["Cyrillic", /\p{Script=Cyrillic}/u],
	["Greek", /\p{Script=Greek}/u],
	["Armenian", /\p{Script=Armenian}/u],
	["Han", /\p{Script=Han}/u],
	["Hiragana", /\p{Script=Hiragana}/u],
	["Katakana", /\p{Script=Katakana}/u],
	["Hangul", /\p{Script=Hangul}/u],
	["Bopomofo", /\p{Script=Bopomofo}/u],
	["Arabic", /\p{Script=Arabic}/u],
	["Hebrew", /\p{Script=Hebrew}/u],
];

/**
 * Script sets one writing system uses together, after UTS #39's highly
 * restrictive level: Japanese, Korean and Chinese mix Han with their own
 * scripts, and each may carry Latin.
 */
const WRITING_SYSTEMS: readonly ReadonlySet<string>[] = [
	new Set(["Latin", "Han", "Hiragana", "Katakana"]),
	new Set(["Latin", "Han", "Hangul"]),
	new Set(["Latin", "Han", "Bopomofo"]),
];

const scriptOf = (char: string): string | undefined => {
	if (!/\p{L}/u.test(char)) return undefined;
	return SCRIPTS.find(([, pattern]) => pattern.test(char))?.[0] ?? "Other";
};

const isMixed = (scripts: ReadonlySet<string>): boolean =>
	scripts.size > 1 &&
	!WRITING_SYSTEMS.some((system) =>
		[...scripts].every((script) => system.has(script)),
	);

/** A label whose letters come from more than one writing system, read in Unicode. */
export const hasMixedScriptLabel = (domain: string): boolean =>
	unicodeDomain(domain)
		.split(".")
		.some((label) =>
			isMixed(
				new Set(
					[...label].map(scriptOf).filter((script) => script !== undefined),
				),
			),
		);

/** Shannon entropy in bits per character. */
export const entropy = (value: string): number => {
	const counts = new Map<string, number>();
	for (const char of value) counts.set(char, (counts.get(char) ?? 0) + 1);
	let bits = 0;
	for (const count of counts.values()) {
		const p = count / value.length;
		bits -= p * Math.log2(p);
	}
	return bits;
};

/**
 * Whether a name reads as machine-made: long, near-uniform and unpronounceable,
 * or a short run of letters and digits shuffled together.
 */
export const looksGenerated = (name: string): boolean => {
	const value = name.toLowerCase().replace(/[^a-z0-9]/g, "");
	if (value.length < 8) return false;
	const bits = entropy(value);
	const digits = value.replace(/[^0-9]/g, "").length;
	const vowels = value.replace(/[^aeiouy]/g, "").length;
	const unpronounceable = digits >= 2 || vowels / value.length < 0.2;
	if (value.length >= 12 && bits >= 3.5 && unpronounceable) return true;
	const switches = value
		.slice(1)
		.split("")
		.filter((char, i) => /\d/.test(char) !== /\d/.test(value[i])).length;
	return digits >= 3 && switches >= 4 && bits >= 3;
};
