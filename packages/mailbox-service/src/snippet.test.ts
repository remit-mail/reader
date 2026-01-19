import assert from "node:assert";
import { describe, it } from "node:test";
import {
	extractSnippetFromEmail,
	generateSnippet,
	normalizeSubject,
	removeQuotedContent,
} from "./snippet.js";

describe("removeQuotedContent", () => {
	it("removes content after > quote marker", () => {
		const text = "Hello\nWorld\n> quoted line\nmore quoted";
		assert.strictEqual(removeQuotedContent(text), "Hello\nWorld");
	});

	it("removes content after 'On ... wrote:' pattern", () => {
		const text = "Hello\nOn Monday, John wrote:\nQuoted content";
		assert.strictEqual(removeQuotedContent(text), "Hello");
	});

	it("removes content after original message separator", () => {
		const text = "Hello\n--- Original Message ---\nQuoted content";
		assert.strictEqual(removeQuotedContent(text), "Hello");
	});

	it("removes content after Outlook underline separator", () => {
		const text = "Hello\n___\nQuoted content";
		assert.strictEqual(removeQuotedContent(text), "Hello");
	});

	it("removes content after Outlook forward header", () => {
		const text = "Hello\nFrom: John Sent: Today To: Jane\nQuoted content";
		assert.strictEqual(removeQuotedContent(text), "Hello");
	});

	it("returns full text when no quote markers", () => {
		const text = "Hello\nWorld\nNo quotes here";
		assert.strictEqual(removeQuotedContent(text), text);
	});
});

describe("normalizeSubject", () => {
	describe("prefix removal", () => {
		it("removes Re: prefix", () => {
			const result = normalizeSubject("Re: Meeting tomorrow");
			assert.ok(!result.includes("re"));
			assert.ok(result.includes("meet"));
		});

		it("removes Fwd: prefix", () => {
			const result = normalizeSubject("Fwd: Important document");
			assert.ok(!result.includes("fwd"));
		});

		it("removes numbered Re: prefix", () => {
			const result = normalizeSubject("Re[3]: Meeting tomorrow");
			assert.ok(!result.includes("re"));
		});

		it("removes multiple prefixes", () => {
			const result = normalizeSubject("Re: Fwd: Re: Original subject");
			assert.ok(!result.includes("re"));
			assert.ok(!result.includes("fwd"));
		});

		it("removes German Aw: prefix", () => {
			const result = normalizeSubject("Aw: Besprechung morgen");
			assert.ok(!result.includes("aw"));
		});

		it("removes Portuguese Res: prefix", () => {
			const result = normalizeSubject("Res: Reunião amanhã");
			assert.ok(!result.includes("res"));
		});
	});

	describe("language detection", () => {
		it("auto-detects English and uses English stemming", () => {
			const result = normalizeSubject(
				"Meeting tomorrow about running the project quickly",
			);
			// Should stem "running" to "run", "quickly" to "quick"
			assert.ok(result.includes("run") || result.includes("quick"));
		});

		it("auto-detects German and uses German processing", () => {
			const result = normalizeSubject(
				"Besprechung über die Verbindung und den Projektstand morgen",
			);
			// Should process with German stemmer
			assert.ok(result.length > 0);
		});

		it("auto-detects French and uses French processing", () => {
			const result = normalizeSubject(
				"Réunion demain matin pour discuter du projet",
			);
			// Should preserve French accented characters and process
			assert.ok(result.includes("réunion") || result.includes("reunion"));
		});

		it("uses provided language override", () => {
			const result = normalizeSubject("Meeting tomorrow", "en");
			assert.ok(result.includes("meet"));
		});
	});

	describe("normalization", () => {
		it("removes stopwords", () => {
			const result = normalizeSubject("The meeting is about the project");
			// "the" and "is" should be removed
			assert.ok(!result.split(" ").includes("the"));
		});

		it("handles Unicode characters", () => {
			const result = normalizeSubject("Réunion à Paris");
			// Should not strip accented characters
			assert.ok(result.includes("réunion") || result.includes("reunion"));
			assert.ok(result.includes("pari"));
		});

		it("deduplicates consecutive words", () => {
			const result = normalizeSubject("Meeting meeting meeting update");
			// After stemming, should dedupe
			const words = result.split(" ");
			for (let i = 1; i < words.length; i++) {
				assert.notStrictEqual(
					words[i],
					words[i - 1],
					"Should not have consecutive duplicates",
				);
			}
		});
	});
});

describe("generateSnippet", () => {
	it("generates snippet from text", () => {
		const text = "Hello, this is a test message.";
		assert.strictEqual(generateSnippet(text), text);
	});

	it("removes quoted content", () => {
		const text = "Hello\n> quoted line";
		assert.strictEqual(generateSnippet(text), "Hello");
	});

	it("normalizes whitespace", () => {
		const text = "Hello   world\n\nmultiple  spaces";
		assert.strictEqual(generateSnippet(text), "Hello world multiple spaces");
	});

	it("truncates long text at word boundary", () => {
		const text = "The quick brown fox jumps over the lazy dog repeatedly";
		const result = generateSnippet(text, 30);
		assert.ok(result.length <= 30);
		assert.ok(result.endsWith("..."));
	});

	it("truncates single long word", () => {
		const text = "supercalifragilisticexpialidocious";
		const result = generateSnippet(text, 20);
		assert.ok(result.endsWith("..."));
		// When no word boundary found, truncates at maxLength-1 + "..."
		// so result is at most maxLength + 2 (for the extra chars in "...")
		assert.ok(result.length <= 22);
	});
});

describe("extractSnippetFromEmail", () => {
	it("prefers plain text over HTML", () => {
		const result = extractSnippetFromEmail("Plain text", "<p>HTML</p>");
		assert.strictEqual(result, "Plain text");
	});

	it("falls back to HTML when no plain text", () => {
		const result = extractSnippetFromEmail(undefined, "<p>HTML content</p>");
		assert.ok(result.includes("HTML content"));
	});

	it("strips HTML tags", () => {
		const result = extractSnippetFromEmail(
			undefined,
			"<p><strong>Bold</strong> text</p>",
		);
		assert.ok(!result.includes("<"));
		assert.ok(!result.includes(">"));
		assert.ok(result.includes("Bold"));
		assert.ok(result.includes("text"));
	});

	it("removes script and style tags", () => {
		const html = "<style>body{}</style><script>alert(1)</script><p>Content</p>";
		const result = extractSnippetFromEmail(undefined, html);
		assert.ok(!result.includes("body"));
		assert.ok(!result.includes("alert"));
		assert.ok(result.includes("Content"));
	});

	it("decodes HTML entities", () => {
		const html = "<p>&amp; &lt; &gt; &quot; &nbsp;</p>";
		const result = extractSnippetFromEmail(undefined, html);
		assert.ok(result.includes("&"));
		assert.ok(result.includes("<"));
		assert.ok(result.includes(">"));
		assert.ok(result.includes('"'));
	});

	it("returns empty string when no content", () => {
		const result = extractSnippetFromEmail(undefined, undefined);
		assert.strictEqual(result, "");
	});
});
