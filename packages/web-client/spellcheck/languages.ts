/**
 * Every dictionary this repo knows how to ship, and everything the image owes
 * for carrying one. Adding a language is a row here, its `dictionary-*` package
 * in `devDependencies`, and its tag in `REMIT_SPELLCHECK_LANGUAGES` — no code.
 *
 * A `.aff` and a `.dic` are data an engine reads at runtime, so carrying one is
 * aggregation and reader's own licence is untouched. What each licence does
 * oblige is that its text travels with the file and that the served bytes are
 * the upstream source; both are build outputs, generated from this table.
 */

export interface DictionarySource {
	/** BCP 47, and the directory name the browser fetches under. */
	readonly tag: string;
	readonly package: string;
	readonly project: string;
	readonly authors: string;
	readonly source: string;
	/** SPDX, with the option taken where upstream offers a choice. */
	readonly licence: string;
}

export const DICTIONARY_SOURCES: readonly DictionarySource[] = [
	{
		tag: "en",
		package: "dictionary-en",
		project: "SCOWL",
		authors: "Kevin Atkinson and contributors",
		source: "https://github.com/wooorm/dictionaries/tree/main/dictionaries/en",
		licence: "MIT AND BSD-3-Clause",
	},
	{
		tag: "en-GB",
		package: "dictionary-en-gb",
		project: "SCOWL",
		authors: "Kevin Atkinson and contributors",
		source:
			"https://github.com/wooorm/dictionaries/tree/main/dictionaries/en-GB",
		licence: "MIT AND BSD-3-Clause",
	},
	{
		tag: "nl",
		package: "dictionary-nl",
		project: "OpenTaal",
		authors: "Stichting OpenTaal",
		source: "https://github.com/wooorm/dictionaries/tree/main/dictionaries/nl",
		licence: "CC-BY-3.0",
	},
];

/**
 * What the published image carries. Everything else in the table above is a
 * language this repo can build and does not; the list is the switch.
 */
export const DEFAULT_SPELLCHECK_LANGUAGES = "en,en-GB,nl";

/**
 * `defaultComposeLanguages` appends `en` to every account's candidate set, so a
 * build without it would leave the one language every account is guaranteed to
 * offer as the one with no dictionary. The switch normalises rather than
 * validates.
 */
export const resolveLanguages = (
	requested: string | undefined,
): readonly DictionarySource[] => {
	const asked = (requested ?? DEFAULT_SPELLCHECK_LANGUAGES)
		.split(",")
		.map((tag) => tag.trim())
		.filter((tag) => tag !== "");
	if (asked.length === 0) return [];

	const known = new Map(
		DICTIONARY_SOURCES.map((source) => [source.tag.toLowerCase(), source]),
	);
	const wanted: DictionarySource[] = [];
	for (const tag of ["en", ...asked]) {
		const source = known.get(tag.toLowerCase());
		if (!source) {
			throw new Error(
				`REMIT_SPELLCHECK_LANGUAGES names "${tag}", which no dictionary in packages/web-client/spellcheck/languages.ts covers. Known tags: ${DICTIONARY_SOURCES.map((entry) => entry.tag).join(", ")}.`,
			);
		}
		if (!wanted.includes(source)) wanted.push(source);
	}
	return wanted;
};
