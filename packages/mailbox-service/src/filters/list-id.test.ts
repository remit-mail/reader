import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { simpleParser } from "mailparser";
import { extractListId, normalizeListId } from "./list-id.js";

const parse = async (lines: string[]) =>
	simpleParser(Buffer.from(lines.join("\r\n")));

describe("normalizeListId", () => {
	it("extracts the bracketed identifier and folds case", () => {
		assert.equal(
			normalizeListId("Weekly News <Weekly.News.Example.COM>"),
			"weekly.news.example.com",
		);
	});

	it("keeps a bare value and folds case", () => {
		assert.equal(
			normalizeListId("  Weekly.News.Example.COM  "),
			"weekly.news.example.com",
		);
	});

	it("normalizes an empty value to the empty string", () => {
		assert.equal(normalizeListId("   "), "");
	});
});

describe("extractListId", () => {
	it("reads and normalizes a List-Id header", async () => {
		const parsed = await parse([
			"From: list@example.com",
			"Subject: hi",
			"List-Id: Weekly News <weekly.news.example.com>",
			"",
			"body",
		]);
		assert.equal(extractListId(parsed), "weekly.news.example.com");
	});

	it("returns the empty string when there is no List-Id header", async () => {
		const parsed = await parse([
			"From: alice@example.com",
			"Subject: hi",
			"",
			"body",
		]);
		assert.equal(extractListId(parsed), "");
	});
});
