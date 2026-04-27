import assert from "node:assert";
import { describe, it } from "node:test";
import {
	buildBodyChunks,
	shannonEntropy,
	stripBoilerplate,
} from "./entropy.js";

const idFor = (suffix: string): string => `msg-1::${suffix}`;

describe("shannonEntropy", () => {
	it("returns zero for an empty string", () => {
		assert.strictEqual(shannonEntropy(""), 0);
	});

	it("returns zero for a single repeating character", () => {
		assert.strictEqual(shannonEntropy("aaaa"), 0);
	});

	it("returns higher entropy for varied text", () => {
		const lo = shannonEntropy("aaaaaaaaa");
		const hi = shannonEntropy("the quick brown fox jumps over the lazy dog");
		assert.ok(hi > lo);
	});
});

describe("stripBoilerplate", () => {
	it("removes content after a > quoted reply", () => {
		const input = "Hello bob,\nThis is the new content.\n> quoted reply line";
		const out = stripBoilerplate(input);
		assert.ok(!out.includes("quoted reply"));
		assert.ok(out.includes("new content"));
	});

	it("removes a 'Best regards alice' signature", () => {
		const input = "Real body text here.\n\nBest regards,\nAlice";
		const out = stripBoilerplate(input);
		assert.ok(!out.includes("Alice"));
		assert.ok(out.includes("Real body text"));
	});

	it("removes 'Sent from my iPhone' boilerplate", () => {
		const input = "Body content.\nSent from my iPhone";
		const out = stripBoilerplate(input);
		assert.ok(!out.includes("Sent from my iPhone"));
	});
});

describe("buildBodyChunks", () => {
	it("returns no chunks when the body is just a greeting and signature", () => {
		const text = "Hi alice,\n\nBest regards,\nBob";
		const chunks = buildBodyChunks(text, idFor);
		assert.strictEqual(chunks.length, 0);
	});

	it("produces chunks from substantive prose", () => {
		const body = `Hi alice,

I have reviewed the Q1 numbers and the team exceeded the target by fourteen percent.
The next milestone needs more attention from engineering and the renewal cycle is
approaching faster than the planning team anticipated. Please confirm by Friday so we
can schedule the follow-up working session for next week.

Best regards,
Bob`;
		const chunks = buildBodyChunks(body, idFor);
		assert.ok(chunks.length >= 1);
		assert.ok(chunks[0].chunkId.startsWith("msg-1::body-"));
		assert.strictEqual(chunks[0].chunkType, "body");
		assert.ok(!chunks[0].text.includes("Hi alice"));
		assert.ok(!chunks[0].text.includes("Best regards"));
		assert.ok(chunks[0].text.includes("Q1 numbers"));
	});

	it("strips quoted content before chunking", () => {
		const body = `Substantive answer text covering the renewal discussion in
some depth so it passes the entropy threshold and minimum length check.

> On Mon, alice wrote:
> Could you please send the report?`;
		const chunks = buildBodyChunks(body, idFor);
		assert.ok(chunks.length >= 1);
		assert.ok(!chunks[0].text.includes("alice wrote"));
		assert.ok(!chunks[0].text.includes("send the report"));
	});

	it("caps individual chunks below the size limit", () => {
		const repeated = `This paragraph contains enough varied language to clear
the entropy threshold every time it is repeated, with several distinct words
and clauses appearing in each iteration to keep entropy high.`;
		const body = Array.from({ length: 20 }, () => repeated).join("\n\n");
		const chunks = buildBodyChunks(body, idFor);
		assert.ok(chunks.length >= 2);
		for (const chunk of chunks) {
			assert.ok(chunk.text.length <= 2000);
		}
	});
});
