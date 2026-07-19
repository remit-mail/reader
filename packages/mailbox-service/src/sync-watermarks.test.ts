import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	advanceModseqWatermark,
	advanceUidWatermarks,
	orderByModseq,
	parseModseq,
	takeModseqBatch,
} from "./sync-watermarks.js";
import type { ImapMessage } from "./types.js";

const message = (uid: number, modseq?: string): ImapMessage => ({
	uid,
	seq: uid,
	flags: [],
	internalDate: new Date(0),
	size: 0,
	...(modseq !== undefined ? { modseq } : {}),
});

/** `count` messages sharing one mod-sequence, as a single STORE produces. */
const tieGroup = (
	count: number,
	modseq: string,
	firstUid: number,
): ImapMessage[] =>
	Array.from({ length: count }, (_, i) => message(firstUid + i, modseq));

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

describe("takeModseqBatch", () => {
	it("takes everything when the changed set fits", () => {
		const ordered = [message(1, "11"), message(2, "12")];

		assert.equal(takeModseqBatch(ordered, 50).length, 2);
	});

	it("stops short of a group that straddles the batch boundary", () => {
		// One STORE marked 60 messages read: all 60 share mod-sequence 900.
		const ordered = [message(1, "800"), ...tieGroup(60, "900", 10)];

		const batch = takeModseqBatch(ordered, 50);

		assert.deepEqual(
			batch.map((m) => m.uid),
			[1],
		);
	});

	it("takes an oversized group whole, since it can only be applied entirely", () => {
		const ordered = tieGroup(60, "900", 10);

		const batch = takeModseqBatch(ordered, 50);

		assert.equal(batch.length, 60);
	});

	it("cuts exactly on a boundary when the batch already ends on one", () => {
		const ordered = [...tieGroup(2, "10", 1), ...tieGroup(2, "20", 3)];

		const batch = takeModseqBatch(ordered, 2);

		assert.deepEqual(
			batch.map((m) => m.uid),
			[1, 2],
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

	it("never leaves the watermark inside a shared mod-sequence", () => {
		// Half the group applied, half left over: the watermark must stay below
		// the shared value or CHANGEDSINCE never returns the other half.
		const ordered = tieGroup(4, "900", 10);

		const result = advanceModseqWatermark({
			storedModseq: 800n,
			serverModseq: 950n,
			ordered,
			batch: ordered.slice(0, 2),
			failedUids: noFailures,
		});

		assert.deepEqual(result, { highestModseq: "800", hasMore: true });
	});

	it("holds back the whole group when one of its members fails", () => {
		const ordered = tieGroup(3, "900", 10);

		const result = advanceModseqWatermark({
			storedModseq: 800n,
			serverModseq: 950n,
			ordered,
			batch: ordered,
			failedUids: new Set([11]),
		});

		// uid 10 succeeded and shares 900 with the failure — advancing to 900
		// would drop uid 11 and 12 permanently.
		assert.equal(result.highestModseq, "800");
	});

	it("advances past earlier groups but stops below a failing one", () => {
		const ordered = [
			...tieGroup(2, "810", 1),
			...tieGroup(2, "900", 10),
			...tieGroup(2, "950", 20),
		];

		const result = advanceModseqWatermark({
			storedModseq: 800n,
			serverModseq: 999n,
			ordered,
			batch: ordered,
			failedUids: new Set([10]),
		});

		assert.equal(result.highestModseq, "810");
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

describe("advanceUidWatermarks", () => {
	const noFailures = new Set<number>();

	it("advances the forward watermark over a clean batch of new mail", () => {
		const result = advanceUidWatermarks({
			batchUids: [21, 22, 23],
			failedUids: noFailures,
			lastSyncUid: 5,
			highWaterMarkUid: 20,
		});

		assert.equal(result.highWaterMarkUid, 23);
		assert.equal(result.lastSyncUid, 5);
	});

	it("stops the forward watermark below a failed UID rather than jumping it", () => {
		const result = advanceUidWatermarks({
			batchUids: [21, 22, 23, 24, 25],
			failedUids: new Set([23]),
			lastSyncUid: 5,
			highWaterMarkUid: 20,
		});

		assert.equal(result.highWaterMarkUid, 22);
	});

	it("keeps a failed backfill UID inside the backfill window", () => {
		const result = advanceUidWatermarks({
			batchUids: [5, 6, 7],
			failedUids: new Set([6]),
			lastSyncUid: 10,
			highWaterMarkUid: 20,
		});

		assert.equal(result.lastSyncUid, 7);
	});

	it("lowers the backfill floor to the lowest UID of a clean batch", () => {
		const result = advanceUidWatermarks({
			batchUids: [5, 6, 7],
			failedUids: noFailures,
			lastSyncUid: 10,
			highWaterMarkUid: 20,
		});

		assert.equal(result.lastSyncUid, 5);
	});

	it("lets a failure constrain only its own region", () => {
		const result = advanceUidWatermarks({
			batchUids: [5, 6, 21, 22],
			failedUids: new Set([6]),
			lastSyncUid: 10,
			highWaterMarkUid: 20,
		});

		assert.equal(result.highWaterMarkUid, 22);
		assert.equal(result.lastSyncUid, 7);
	});

	it("sets both watermarks from a fresh sync", () => {
		const result = advanceUidWatermarks({
			batchUids: [1, 2, 3],
			failedUids: noFailures,
			lastSyncUid: 0,
			highWaterMarkUid: 0,
		});

		assert.deepEqual(result, { lastSyncUid: 1, highWaterMarkUid: 3 });
	});

	it("never moves a watermark backwards", () => {
		const result = advanceUidWatermarks({
			batchUids: [21],
			failedUids: new Set([21]),
			lastSyncUid: 5,
			highWaterMarkUid: 20,
		});

		assert.deepEqual(result, { lastSyncUid: 5, highWaterMarkUid: 20 });
	});
});
