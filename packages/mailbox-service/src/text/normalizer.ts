/**
 * Multilingual text normalizer for email processing.
 *
 * Uses franc for language detection, natural for stemming,
 * and stopword for stopword removal.
 */

/// <reference path="../types/natural-porter-stemmer.d.ts" />
import { franc } from "franc";
// Import each Porter stemmer file directly instead of the `natural` package
// root or its `stemmers` submodule barrel: the root barrel
// (`natural/lib/natural/index.js`) loads WordNet and the Brill POS tagger,
// which pull in `mongoose` and — via its Postgres storage plugin —
// `pg`/`dotenv` (`dotenv.config()` at module scope on every cold start, see
// #1244/#1247); the `stemmers` barrel is CJS and unconditionally requires
// every stemmer it lists, including Japanese (which drags in its own
// tokenizer) and Indonesian, neither used here. This module only needs the
// seven Porter stemmers below — see
// ../types/natural-porter-stemmer.d.ts for their (hand-written, since
// `natural` ships none for individual files) type declarations.
import PorterStemmer from "natural/lib/natural/stemmers/porter_stemmer.js";
import PorterStemmerDe from "natural/lib/natural/stemmers/porter_stemmer_de.js";
import PorterStemmerEs from "natural/lib/natural/stemmers/porter_stemmer_es.js";
import PorterStemmerFr from "natural/lib/natural/stemmers/porter_stemmer_fr.js";
import PorterStemmerIt from "natural/lib/natural/stemmers/porter_stemmer_it.js";
import PorterStemmerNl from "natural/lib/natural/stemmers/porter_stemmer_nl.js";
import PorterStemmerPt from "natural/lib/natural/stemmers/porter_stemmer_pt.js";
import { deu, eng, fra, ita, nld, por, removeStopwords, spa } from "stopword";

export type SupportedLanguage = "en" | "de" | "fr" | "es" | "it" | "nl" | "pt";

export interface NormalizeOptions {
	language?: SupportedLanguage;
	stem?: boolean;
	removeStopwords?: boolean;
}

export interface TextNormalizer {
	detectLanguage(text: string): SupportedLanguage;
	normalize(text: string, options?: NormalizeOptions): string;
	tokenize(text: string): string[];
	stem(word: string, language?: SupportedLanguage): string;
	removeStopwords(words: string[], language?: SupportedLanguage): string[];
}

// ISO 639-3 (franc) → ISO 639-1 (our SupportedLanguage)
const iso3ToIso1: Record<string, SupportedLanguage> = {
	eng: "en",
	deu: "de",
	fra: "fr",
	nld: "nl",
	spa: "es",
	ita: "it",
	por: "pt",
};

// Restrict franc to only detect languages we can stem
const supportedIso3 = Object.keys(iso3ToIso1);

const stemmers: Record<SupportedLanguage, { stem: (word: string) => string }> =
	{
		en: PorterStemmer,
		de: PorterStemmerDe,
		fr: PorterStemmerFr,
		es: PorterStemmerEs,
		it: PorterStemmerIt,
		nl: PorterStemmerNl,
		pt: PorterStemmerPt,
	};

const stopwordLists: Record<SupportedLanguage, string[]> = {
	en: eng,
	de: deu,
	fr: fra,
	es: spa,
	it: ita,
	nl: nld,
	pt: por,
};

export const createTextNormalizer = (): TextNormalizer => ({
	detectLanguage: (text) => {
		// Use franc with trigram analysis, restricted to supported languages
		const detected = franc(text, { only: supportedIso3, minLength: 10 });

		// Map to our language codes, default to English
		return iso3ToIso1[detected] ?? "en";
	},

	normalize: (text, options = {}) => {
		const {
			language = "en",
			stem = true,
			removeStopwords: removeStop = true,
		} = options;

		// Normalize unicode and lowercase
		let normalized = text.normalize("NFKC").toLowerCase();

		// Keep Unicode letters and numbers, remove punctuation
		normalized = normalized.replace(/[^\p{L}\p{N}\s]/gu, " ");

		// Tokenize
		let words = normalized.split(/\s+/).filter((w) => w.length > 0);

		// Remove stopwords
		if (removeStop) {
			const list = stopwordLists[language] ?? eng;
			words = removeStopwords(words, list);
		}

		// Stem
		if (stem) {
			const stemmer = stemmers[language] ?? stemmers.en;
			words = words.map((w) => stemmer.stem(w));
		}

		// Dedupe consecutive words
		return words.filter((w, i, arr) => i === 0 || w !== arr[i - 1]).join(" ");
	},

	tokenize: (text) => {
		return text
			.normalize("NFKC")
			.toLowerCase()
			.replace(/[^\p{L}\p{N}\s]/gu, " ")
			.split(/\s+/)
			.filter((w) => w.length > 0);
	},

	stem: (word, language = "en") => {
		const stemmer = stemmers[language] ?? stemmers.en;
		return stemmer.stem(word.toLowerCase());
	},

	removeStopwords: (words, language = "en") => {
		const list = stopwordLists[language] ?? eng;
		return removeStopwords(words, list);
	},
});
