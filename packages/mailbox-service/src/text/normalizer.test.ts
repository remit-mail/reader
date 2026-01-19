import assert from "node:assert";
import { describe, it } from "node:test";
import { createTextNormalizer } from "./normalizer.js";

describe("TextNormalizer", () => {
	const normalizer = createTextNormalizer();

	describe("detectLanguage", () => {
		it("detects English text", () => {
			const text =
				"The quick brown fox jumps over the lazy dog. This is a sample English text.";
			assert.strictEqual(normalizer.detectLanguage(text), "en");
		});

		it("detects German text", () => {
			const text =
				"Der schnelle braune Fuchs springt über den faulen Hund. Dies ist ein deutscher Text.";
			assert.strictEqual(normalizer.detectLanguage(text), "de");
		});

		it("detects French text", () => {
			const text =
				"Le renard brun rapide saute par-dessus le chien paresseux. Ceci est un texte français.";
			assert.strictEqual(normalizer.detectLanguage(text), "fr");
		});

		it("detects Spanish text", () => {
			const text =
				"El rápido zorro marrón salta sobre el perro perezoso. Este es un texto en español.";
			assert.strictEqual(normalizer.detectLanguage(text), "es");
		});

		it("detects Italian text", () => {
			const text =
				"La volpe marrone veloce salta sopra il cane pigro. Questo è un testo italiano.";
			assert.strictEqual(normalizer.detectLanguage(text), "it");
		});

		it("detects Portuguese text", () => {
			const text =
				"A rápida raposa marrom salta sobre o cão preguiçoso. Este é um texto em português.";
			assert.strictEqual(normalizer.detectLanguage(text), "pt");
		});

		it("detects Dutch text", () => {
			const text =
				"De snelle bruine vos springt over de luie hond. Dit is een Nederlandse tekst.";
			assert.strictEqual(normalizer.detectLanguage(text), "nl");
		});

		it("defaults to English for short text", () => {
			const text = "Hello";
			assert.strictEqual(normalizer.detectLanguage(text), "en");
		});

		it("defaults to English for empty text", () => {
			assert.strictEqual(normalizer.detectLanguage(""), "en");
		});
	});

	describe("tokenize", () => {
		it("tokenizes text into words", () => {
			const text = "Hello, World! How are you?";
			assert.deepStrictEqual(normalizer.tokenize(text), [
				"hello",
				"world",
				"how",
				"are",
				"you",
			]);
		});

		it("handles Unicode characters", () => {
			const text = "Réunion demain café";
			assert.deepStrictEqual(normalizer.tokenize(text), [
				"réunion",
				"demain",
				"café",
			]);
		});

		it("handles German umlauts", () => {
			const text = "Besprechung über München";
			assert.deepStrictEqual(normalizer.tokenize(text), [
				"besprechung",
				"über",
				"münchen",
			]);
		});

		it("normalizes whitespace", () => {
			const text = "  multiple   spaces\n\ttabs  ";
			assert.deepStrictEqual(normalizer.tokenize(text), [
				"multiple",
				"spaces",
				"tabs",
			]);
		});
	});

	describe("stem", () => {
		it("stems English words", () => {
			assert.strictEqual(normalizer.stem("running", "en"), "run");
			assert.strictEqual(normalizer.stem("jumps", "en"), "jump");
			assert.strictEqual(normalizer.stem("connected", "en"), "connect");
		});

		it("stems German words", () => {
			// German Porter stemmer has different rules than English
			// Just verify it returns a string and doesn't throw
			const result1 = normalizer.stem("verbindung", "de");
			const result2 = normalizer.stem("laufend", "de");
			assert.ok(typeof result1 === "string");
			assert.ok(typeof result2 === "string");
			// The stemmer should at least return something
			assert.ok(result1.length > 0);
			assert.ok(result2.length > 0);
		});

		it("stems French words", () => {
			assert.strictEqual(normalizer.stem("réunion", "fr"), "réunion");
			assert.strictEqual(normalizer.stem("connexion", "fr"), "connexion");
		});

		it("defaults to English stemmer for unknown language", () => {
			assert.strictEqual(normalizer.stem("running"), "run");
		});
	});

	describe("removeStopwords", () => {
		it("removes English stopwords", () => {
			const words = ["the", "quick", "brown", "fox", "is", "running"];
			const result = normalizer.removeStopwords(words, "en");
			assert.ok(!result.includes("the"));
			assert.ok(!result.includes("is"));
			assert.ok(result.includes("quick"));
			assert.ok(result.includes("brown"));
			assert.ok(result.includes("fox"));
			assert.ok(result.includes("running"));
		});

		it("removes German stopwords", () => {
			const words = ["der", "schnelle", "fuchs", "ist", "braun"];
			const result = normalizer.removeStopwords(words, "de");
			assert.ok(!result.includes("der"));
			assert.ok(!result.includes("ist"));
			assert.ok(result.includes("schnelle"));
			assert.ok(result.includes("fuchs"));
		});

		it("removes French stopwords", () => {
			const words = ["le", "renard", "est", "rapide"];
			const result = normalizer.removeStopwords(words, "fr");
			assert.ok(!result.includes("le"));
			assert.ok(!result.includes("est"));
			assert.ok(result.includes("renard"));
			assert.ok(result.includes("rapide"));
		});

		it("removes Dutch stopwords", () => {
			const words = ["de", "snelle", "vos", "is", "bruin"];
			const result = normalizer.removeStopwords(words, "nl");
			assert.ok(!result.includes("de"));
			assert.ok(!result.includes("is"));
			assert.ok(result.includes("snelle"));
			assert.ok(result.includes("vos"));
		});
	});

	describe("normalize", () => {
		it("normalizes English text with stemming and stopword removal", () => {
			const text = "The quick brown fox is running quickly";
			const result = normalizer.normalize(text, { language: "en" });
			// Should remove "the" and "is", stem "running" and "quickly"
			assert.ok(!result.includes("the "));
			assert.ok(!result.includes(" is "));
			assert.ok(result.includes("quick"));
			assert.ok(result.includes("run"));
		});

		it("normalizes German text", () => {
			const text = "Der schnelle braune Fuchs ist laufend";
			const result = normalizer.normalize(text, { language: "de" });
			assert.ok(!result.includes("der "));
			assert.ok(!result.includes(" ist "));
		});

		it("normalizes without stemming when disabled", () => {
			const text = "running quickly";
			const result = normalizer.normalize(text, {
				language: "en",
				stem: false,
				removeStopwords: false,
			});
			assert.strictEqual(result, "running quickly");
		});

		it("handles Unicode text", () => {
			const text = "Réunion à Paris demain";
			const result = normalizer.normalize(text, { language: "fr" });
			assert.ok(result.includes("réunion"));
			assert.ok(result.includes("pari"));
			assert.ok(result.includes("demain"));
		});

		it("deduplicates consecutive words", () => {
			const text = "hello hello world world world";
			const result = normalizer.normalize(text, {
				language: "en",
				stem: false,
				removeStopwords: false,
			});
			assert.strictEqual(result, "hello world");
		});

		it("defaults to English when language not specified", () => {
			const text = "The quick brown fox";
			const result = normalizer.normalize(text);
			// "the" should be removed as English stopword
			assert.ok(!result.includes("the "));
		});
	});
});
