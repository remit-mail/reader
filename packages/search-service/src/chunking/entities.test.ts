import assert from "node:assert";
import { describe, it } from "node:test";
import { buildEntityChunks, extractEntities } from "./entities.js";

const idFor = (suffix: string): string => `msg-1::${suffix}`;

describe("extractEntities", () => {
	it("extracts email addresses", () => {
		const text = "Contact alice@example.com or bob@example.com for details.";
		const ents = extractEntities(text);
		assert.deepStrictEqual(ents.emails.sort(), [
			"alice@example.com",
			"bob@example.com",
		]);
	});

	it("dedupes repeated email addresses", () => {
		const text = "alice@example.com is alice@example.com everywhere";
		const ents = extractEntities(text);
		assert.deepStrictEqual(ents.emails, ["alice@example.com"]);
	});

	it("extracts URLs", () => {
		const text =
			"Open https://docs.example.com/report and https://example.com/x";
		const ents = extractEntities(text);
		assert.ok(ents.urls.includes("https://docs.example.com/report"));
		assert.ok(ents.urls.includes("https://example.com/x"));
	});

	it("extracts ISO and long-form dates", () => {
		const text =
			"The deadline is 2026-03-15 or March 15, 2026 — Q1 2026 cutoff.";
		const ents = extractEntities(text);
		assert.ok(ents.dates.includes("2026-03-15"));
		assert.ok(ents.dates.some((d) => /March 15/.test(d)));
		assert.ok(ents.dates.includes("Q1 2026"));
	});

	it("extracts currency amounts and percentages", () => {
		const text = "The deal is worth €14,500 and the team beat target by 14%.";
		const ents = extractEntities(text);
		assert.ok(ents.amounts.some((a) => a.includes("14,500")));
		assert.ok(ents.amounts.includes("14%"));
	});
});

describe("buildEntityChunks", () => {
	it("emits a single entities chunk when entities are found", () => {
		const text = "Email alice@example.com about Q1 2026 invoice for €14,500.";
		const chunks = buildEntityChunks(text, idFor);
		assert.strictEqual(chunks.length, 1);
		assert.strictEqual(chunks[0].chunkType, "entities");
		assert.strictEqual(chunks[0].chunkId, "msg-1::entities");
		assert.match(chunks[0].text, /alice@example\.com/);
		assert.match(chunks[0].text, /Q1 2026/);
	});

	it("emits no chunk when no entities are found", () => {
		const text = "just plain prose with no specific entities at all";
		const chunks = buildEntityChunks(text, idFor);
		assert.strictEqual(chunks.length, 0);
	});

	it("splits a huge Links list into multiple capped chunks", () => {
		const links = Array.from(
			{ length: 4000 },
			(_, i) =>
				`Visit https://news.example.com/articles/${i}/read-the-full-story`,
		).join(" ");
		const chunks = buildEntityChunks(links, idFor);

		assert.ok(chunks.length > 1, "expected the oversized list to split");
		for (const chunk of chunks) {
			assert.strictEqual(chunk.chunkType, "entities");
			assert.ok(
				chunk.text.length <= 6000,
				`chunk ${chunk.chunkId} length ${chunk.text.length} exceeds budget`,
			);
		}
	});
});
