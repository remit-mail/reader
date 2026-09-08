import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	formatIndexProvenance,
	type IndexedChunkProvenance,
	summarizeIndexProvenance,
} from "./index-report.js";

const CURRENT = "local:multilingual-MiniLM:q8@384";
const OLDER = "local:MiniLM@384";

const chunk = (
	messageId: string,
	embeddingId: string | undefined,
): IndexedChunkProvenance => ({ messageId, embeddingId });

describe("summarizeIndexProvenance", () => {
	it("counts vectors and the messages they belong to per embedder", () => {
		const report = summarizeIndexProvenance(CURRENT, [
			chunk("m1", CURRENT),
			chunk("m1", CURRENT),
			chunk("m2", OLDER),
		]);
		assert.equal(report.chunks, 3);
		assert.equal(report.messages, 2);
		assert.deepEqual(report.groups, [
			{ embeddingId: CURRENT, chunks: 2, messages: 1, current: true },
			{ embeddingId: OLDER, chunks: 1, messages: 1, current: false },
		]);
	});

	// The state the report exists to make visible: a switched embedder leaves the
	// index holding two vector spaces, and every query compares them as one.
	it("separates the configured embedder from every other one", () => {
		const report = summarizeIndexProvenance(CURRENT, [
			chunk("m1", OLDER),
			chunk("m2", OLDER),
			chunk("m3", CURRENT),
		]);
		assert.deepEqual(
			report.groups.map((group) => [group.embeddingId, group.current]),
			[
				[OLDER, false],
				[CURRENT, true],
			],
		);
	});

	// Vectors written before metadata carried an embeddingId are a third state,
	// not "the current model": nothing recorded what wrote them.
	it("buckets vectors with no recorded embedder as unknown", () => {
		const report = summarizeIndexProvenance(CURRENT, [
			chunk("m1", undefined),
			chunk("m2", CURRENT),
		]);
		const unknown = report.groups.find(
			(group) => group.embeddingId === "unknown",
		);
		assert.deepEqual(unknown, {
			embeddingId: "unknown",
			chunks: 1,
			messages: 1,
			current: false,
		});
	});

	// Two runs over an unchanged index have to print the same report, or a diff
	// between them is noise rather than a change.
	it("orders groups by size and then by id", () => {
		const report = summarizeIndexProvenance(CURRENT, [
			chunk("m1", "b"),
			chunk("m2", "a"),
			chunk("m3", "c"),
			chunk("m4", "c"),
		]);
		assert.deepEqual(
			report.groups.map((group) => group.embeddingId),
			["c", "a", "b"],
		);
	});

	it("reports an empty index as empty rather than as unknown", () => {
		const report = summarizeIndexProvenance(CURRENT, []);
		assert.equal(report.chunks, 0);
		assert.equal(report.messages, 0);
		assert.deepEqual(report.groups, []);
	});
});

describe("formatIndexProvenance", () => {
	it("names the configured embedder and every one in the index", () => {
		const text = formatIndexProvenance(
			summarizeIndexProvenance(CURRENT, [
				chunk("m1", CURRENT),
				chunk("m2", OLDER),
			]),
		);
		assert.match(text, new RegExp(`Configured embedder: ${CURRENT}`));
		assert.match(text, /2 vectors over 2 messages/);
		assert.match(text, /\(current\)/);
		assert.match(text, /\(older model\)/);
	});

	// An empty index and an index on a stale model both answer every query with
	// nothing, so the report has to say which one this is.
	it("says an empty index is empty", () => {
		const text = formatIndexProvenance(summarizeIndexProvenance(CURRENT, []));
		assert.match(text, /Nothing is indexed/);
	});

	it("counts the messages a switched embedder left behind", () => {
		const text = formatIndexProvenance(
			summarizeIndexProvenance(CURRENT, [
				chunk("m1", OLDER),
				chunk("m2", OLDER),
				chunk("m3", CURRENT),
			]),
		);
		assert.match(text, /2 messages carry vectors from an embedder/);
	});

	it("says nothing about older models when every vector is current", () => {
		const text = formatIndexProvenance(
			summarizeIndexProvenance(CURRENT, [chunk("m1", CURRENT)]),
		);
		assert.ok(!text.includes("older model"), text);
		assert.ok(!text.includes("no longer configured"), text);
	});
});
