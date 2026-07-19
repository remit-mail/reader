import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	advanceChangeCursor,
	advanceUidWatermarks,
	dropAppliedPrefix,
	formatChangeCursor,
	orderByModseq,
	parseChangeCursor,
	parseModseq,
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

describe("parseChangeCursor / formatChangeCursor", () => {
	it("reads a plain value written before the sub-position existed", () => {
		assert.deepEqual(parseChangeCursor("900"), { modseq: 900n, uid: 0 });
	});

	it("round-trips a group boundary as plain digits", () => {
		assert.equal(formatChangeCursor({ modseq: 900n, uid: 0 }), "900");
	});

	it("round-trips a position inside a group", () => {
		assert.equal(formatChangeCursor({ modseq: 800n, uid: 1234 }), "800:1234");
		assert.deepEqual(parseChangeCursor("800:1234"), {
			modseq: 800n,
			uid: 1234,
		});
	});

	it("treats an absent cursor as no cursor", () => {
		assert.deepEqual(parseChangeCursor(undefined), { modseq: 0n, uid: 0 });
		assert.deepEqual(parseChangeCursor("0"), { modseq: 0n, uid: 0 });
	});

	it("keeps a value beyond 2^53 lossless through the round trip", () => {
		const raw = "18446744073709551615:7";
		assert.equal(formatChangeCursor(parseChangeCursor(raw)), raw);
	});
});

describe("dropAppliedPrefix", () => {
	it("passes everything through at a group boundary", () => {
		const ordered = tieGroup(3, "900", 10);

		assert.equal(
			dropAppliedPrefix(ordered, { modseq: 800n, uid: 0 }).length,
			3,
		);
	});

	it("drops the members of the in-progress group already applied", () => {
		const ordered = [...tieGroup(4, "900", 10), message(50, "950")];

		const remaining = dropAppliedPrefix(ordered, { modseq: 800n, uid: 11 });

		assert.deepEqual(
			remaining.map((m) => m.uid),
			[12, 13, 50],
		);
	});

	it("keeps a later change to a low UID, which is a different group", () => {
		const ordered = [...tieGroup(2, "900", 10), message(10, "950")];

		const remaining = dropAppliedPrefix(ordered, { modseq: 800n, uid: 11 });

		assert.deepEqual(
			remaining.map((m) => `${m.uid}@${m.modseq}`),
			["10@950"],
		);
	});
});

describe("advanceChangeCursor", () => {
	const noFailures = new Set<number>();

	it("jumps to the server HIGHESTMODSEQ when the whole set was applied", () => {
		const ordered = [message(1, "11"), message(2, "12")];

		const result = advanceChangeCursor({
			cursor: { modseq: 10n, uid: 0 },
			serverModseq: 20n,
			ordered,
			batch: ordered,
			failedUids: noFailures,
		});

		assert.deepEqual(result, {
			cursor: { modseq: 20n, uid: 0 },
			hasMore: false,
		});
	});

	it("records a position inside a group it only partly applied", () => {
		// 60 messages marked read by one STORE; the round applies 50.
		const ordered = tieGroup(60, "900", 10);

		const result = advanceChangeCursor({
			cursor: { modseq: 800n, uid: 0 },
			serverModseq: 900n,
			ordered,
			batch: ordered.slice(0, 50),
			failedUids: noFailures,
		});

		// Last complete mod-sequence unchanged, position recorded — so the next
		// fetch returns the whole group again and the applied half is skipped.
		assert.deepEqual(result, {
			cursor: { modseq: 800n, uid: 59 },
			hasMore: true,
		});
	});

	it("resumes a part-applied group and closes it on the boundary", () => {
		const ordered = tieGroup(10, "900", 60);

		const result = advanceChangeCursor({
			cursor: { modseq: 800n, uid: 59 },
			serverModseq: 900n,
			ordered,
			batch: ordered,
			failedUids: noFailures,
		});

		assert.deepEqual(result, {
			cursor: { modseq: 900n, uid: 0 },
			hasMore: false,
		});
	});

	it("stops on the group boundary when the next change starts a new group", () => {
		const ordered = [...tieGroup(2, "900", 10), ...tieGroup(2, "950", 20)];

		const result = advanceChangeCursor({
			cursor: { modseq: 800n, uid: 0 },
			serverModseq: 999n,
			ordered,
			batch: ordered.slice(0, 2),
			failedUids: noFailures,
		});

		assert.deepEqual(result, {
			cursor: { modseq: 900n, uid: 0 },
			hasMore: true,
		});
	});

	it("stops below a failure inside a group", () => {
		const ordered = tieGroup(4, "900", 10);

		const result = advanceChangeCursor({
			cursor: { modseq: 800n, uid: 0 },
			serverModseq: 900n,
			ordered,
			batch: ordered,
			failedUids: new Set([12]),
		});

		// uids 10 and 11 applied; 12 failed, so the cursor sits at 11 and the
		// next round re-fetches the group from 12 on.
		assert.deepEqual(result.cursor, { modseq: 800n, uid: 11 });
	});

	it("does not move when the very first change fails", () => {
		const ordered = tieGroup(2, "900", 10);

		const result = advanceChangeCursor({
			cursor: { modseq: 800n, uid: 0 },
			serverModseq: 900n,
			ordered,
			batch: ordered,
			failedUids: new Set([10]),
		});

		assert.deepEqual(result.cursor, { modseq: 800n, uid: 0 });
	});

	it("keeps the last complete group when a later one fails part-way", () => {
		const ordered = [...tieGroup(2, "810", 1), ...tieGroup(3, "900", 10)];

		const result = advanceChangeCursor({
			cursor: { modseq: 800n, uid: 0 },
			serverModseq: 999n,
			ordered,
			batch: ordered,
			failedUids: new Set([11]),
		});

		assert.deepEqual(result.cursor, { modseq: 810n, uid: 10 });
	});

	it("never moves backwards when the server reports a lower value", () => {
		const result = advanceChangeCursor({
			cursor: { modseq: 50n, uid: 0 },
			serverModseq: 20n,
			ordered: [],
			batch: [],
			failedUids: noFailures,
		});

		assert.deepEqual(result.cursor, { modseq: 50n, uid: 0 });
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
