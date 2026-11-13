import { domainToUnicode } from "node:url";

/**
 * Cyrillic and Greek letters drawn identically to a Latin one, from the UTS #39
 * confusables table. A character table, not a list of names: it says nothing
 * about which domains matter.
 */
const CONFUSABLE_LETTERS: Readonly<Record<string, string>> = {
	а: "a",
	с: "c",
	ԁ: "d",
	е: "e",
	һ: "h",
	і: "i",
	ј: "j",
	ӏ: "l",
	о: "o",
	р: "p",
	ԛ: "q",
	ѕ: "s",
	ѵ: "v",
	ԝ: "w",
	х: "x",
	у: "y",
	α: "a",
	η: "n",
	ι: "i",
	ν: "v",
	ο: "o",
	ρ: "p",
	ı: "i",
	"0": "o",
	"1": "l",
	"|": "l",
};

/**
 * The UTS #39 skeleton of a domain, reduced to what a reader can tell apart:
 * accents dropped, lookalike letters folded to Latin, and the multi-letter
 * shapes `rn`/`m` and `vv`/`w` made one. Two domains with one skeleton look
 * the same in a mail client.
 */
export const skeleton = (domain: string): string =>
	[...unicodeDomain(domain).normalize("NFKD").replace(/\p{M}/gu, "")]
		.map((char) => CONFUSABLE_LETTERS[char] ?? char.toLowerCase())
		.join("")
		.replaceAll("rn", "m")
		.replaceAll("vv", "w");

export const unicodeDomain = (domain: string): string =>
	domainToUnicode(domain) || domain;

export const isPunycode = (domain: string): boolean =>
	domain
		.toLowerCase()
		.split(".")
		.some((label) => label.startsWith("xn--"));

const SCRIPTS: readonly [string, RegExp][] = [
	["Latin", /\p{Script=Latin}/u],
	["Cyrillic", /\p{Script=Cyrillic}/u],
	["Greek", /\p{Script=Greek}/u],
	["Armenian", /\p{Script=Armenian}/u],
	["Han", /\p{Script=Han}/u],
	["Arabic", /\p{Script=Arabic}/u],
	["Hebrew", /\p{Script=Hebrew}/u],
];

const scriptOf = (char: string): string | undefined => {
	if (!/\p{L}/u.test(char)) return undefined;
	return SCRIPTS.find(([, pattern]) => pattern.test(char))?.[0] ?? "Other";
};

/** A label whose letters come from more than one script, read in Unicode. */
export const hasMixedScriptLabel = (domain: string): boolean =>
	unicodeDomain(domain)
		.split(".")
		.some((label) => {
			const scripts = new Set(
				[...label].map(scriptOf).filter((script) => script !== undefined),
			);
			return scripts.size > 1;
		});

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
 * Whether a name reads as machine-made: long and with near-uniform characters,
 * or a short run of letters and digits shuffled together.
 */
export const looksGenerated = (name: string): boolean => {
	const value = name.toLowerCase().replace(/[^a-z0-9]/g, "");
	if (value.length < 8) return false;
	const bits = entropy(value);
	if (value.length >= 12 && bits >= 3.5) return true;
	const digits = value.replace(/[^0-9]/g, "").length;
	const switches = value
		.slice(1)
		.split("")
		.filter((char, i) => /\d/.test(char) !== /\d/.test(value[i])).length;
	return digits >= 3 && switches >= 4 && bits >= 3;
};
