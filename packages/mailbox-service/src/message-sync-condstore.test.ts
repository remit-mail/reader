import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	advanceModseqWatermark,
	orderByModseq,
	parseModseq,
} from "./message-sync-condstore.js";
import type { ImapMessage } from "./types.js";

const message = (uid: number, modseq?: string): ImapMessage => ({
	uid,
	seq: uid,
	flags: [],
	internalDate: new Date(0),
	size: 0,
	...(modseq !== undefined ? { modseq } : {}),
});

describe("parseModseq", () => {
	it("parses a value beyond 2^53 losslessly", () => {
		assert.equal(parseModseq("18446744073709551615"), 18446744073709551615n);
	});

	it("treats an absent or zero watermark as no watermark", () => {
		assert.equal(parseModseq(undefined), 0n);
		assert.equal(parseModseq(""), 0n);
		assert.equal(parseModseq("0"), 0n);
	});
});

describe("orderByModseq", () => {
	it("orders oldest change first so a partial round is resumable", () => {
		const ordered = orderByModseq([
			message(3, "30"),
			message(1, "10"),
			message(2, "20"),
		]);

		assert.deepEqual(
			ordered.map((m) => m.uid),
			[1, 2, 3],
		);
	});

	it("breaks ties on UID and compares beyond 2^53", () => {
		const ordered = orderByModseq([
			message(9, "9007199254740993"),
			message(4, "9007199254740992"),
			message(2, "9007199254740992"),
		]);

		assert.deepEqual(
			ordered.map((m) => m.uid),
			[2, 4, 9],
		);
	});
});

describe("advanceModseqWatermark", () => {
	const noFailures = new Set<number>();

	it("jumps to the server HIGHESTMODSEQ when the whole changed set was applied", () => {
		const ordered = [message(1, "11"), message(2, "12")];

		const result = advanceModseqWatermark({
			storedModseq: 10n,
			serverModseq: 20n,
			ordered,
			batch: ordered,
			failedUids: noFailures,
		});

		assert.deepEqual(result, { highestModseq: "20", hasMore: false });
	});

	it("advances to the server watermark when nothing changed at all", () => {
		const result = advanceModseqWatermark({
			storedModseq: 10n,
			serverModseq: 42n,
			ordered: [],
			batch: [],
			failedUids: noFailures,
		});

		assert.deepEqual(result, { highestModseq: "42", hasMore: false });
	});

	it("stops at the first failure so the interrupted window is re-fetched", () => {
		const ordered = [message(1, "11"), message(2, "12"), message(3, "13")];

		const result = advanceModseqWatermark({
			storedModseq: 10n,
			serverModseq: 20n,
			ordered,
			batch: ordered,
			failedUids: new Set([2]),
		});

		assert.deepEqual(result, { highestModseq: "11", hasMore: false });
	});

	it("holds the watermark when the very first change fails", () => {
		const ordered = [message(1, "11")];

		const result = advanceModseqWatermark({
			storedModseq: 10n,
			serverModseq: 20n,
			ordered,
			batch: ordered,
			failedUids: new Set([1]),
		});

		assert.equal(result.highestModseq, "10");
	});

	it("advances only over the processed prefix and reports the rest as remaining", () => {
		const ordered = [message(1, "11"), message(2, "12"), message(3, "13")];

		const result = advanceModseqWatermark({
			storedModseq: 10n,
			serverModseq: 99n,
			ordered,
			batch: ordered.slice(0, 2),
			failedUids: noFailures,
		});

		assert.deepEqual(result, { highestModseq: "12", hasMore: true });
	});

	it("never moves backwards when the server reports a lower watermark", () => {
		const result = advanceModseqWatermark({
			storedModseq: 50n,
			serverModseq: 20n,
			ordered: [],
			batch: [],
			failedUids: noFailures,
		});

		assert.equal(result.highestModseq, "50");
	});
});
