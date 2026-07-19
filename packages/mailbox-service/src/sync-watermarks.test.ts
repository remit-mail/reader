import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	advanceChangeCursor,
	advanceUidWatermarks,
	type ChangeCursor,
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
		assert.deepEqual(parseChangeCursor("900"), {
			modseq: 900n,
			group: 0n,
			uid: 0,
		});
	});

	it("round-trips a clean boundary as plain digits", () => {
		assert.equal(
			formatChangeCursor({ modseq: 900n, group: 0n, uid: 0 }),
			"900",
		);
	});

	it("round-trips a position inside a group, implying the fetch point", () => {
		assert.equal(
			formatChangeCursor({ modseq: 199n, group: 200n, uid: 500 }),
			"200:500",
		);
		assert.deepEqual(parseChangeCursor("200:500"), {
			modseq: 199n,
			group: 200n,
			uid: 500,
		});
	});

	it("stays inside the field's 32 characters at full 64-bit width", () => {
		const widest = formatChangeCursor({
			modseq: 18446744073709551614n,
			group: 18446744073709551615n,
			uid: 4294967295,
		});

		assert.equal(widest, "18446744073709551615:4294967295");
		assert.ok(widest.length <= 32);
		assert.deepEqual(parseChangeCursor(widest), {
			modseq: 18446744073709551614n,
			group: 18446744073709551615n,
			uid: 4294967295,
		});
	});

	it("treats an absent cursor as no cursor", () => {
		assert.deepEqual(parseChangeCursor(undefined), {
			modseq: 0n,
			group: 0n,
			uid: 0,
		});
		assert.deepEqual(parseChangeCursor("0"), {
			modseq: 0n,
			group: 0n,
			uid: 0,
		});
	});

	it("degrades a malformed cursor to enumeration instead of throwing", () => {
		// A throw here would take the mailbox out of sync permanently, with no
		// path left to read the value and repair it.
		for (const raw of ["abc", "500:abc", "abc:1", "", ":", "1:2:3"]) {
			assert.doesNotThrow(() => parseChangeCursor(raw));
		}
		assert.equal(parseChangeCursor("abc").modseq, 0n);
		assert.equal(parseChangeCursor("500:abc").modseq, 500n);
	});

	it("survives a numeric column value", () => {
		// SQLite hands back a number whatever the declared column type.
		assert.deepEqual(parseChangeCursor(900 as unknown as string), {
			modseq: 900n,
			group: 0n,
			uid: 0,
		});
	});
});

describe("dropAppliedPrefix", () => {
	it("passes everything through on a clean boundary", () => {
		const ordered = tieGroup(3, "900", 10);

		assert.equal(
			dropAppliedPrefix(ordered, { modseq: 800n, group: 0n, uid: 0 }).length,
			3,
		);
	});

	it("drops the members of the recorded group already applied", () => {
		const ordered = [...tieGroup(4, "200", 500), message(50, "300")];

		const remaining = dropAppliedPrefix(ordered, {
			modseq: 199n,
			group: 200n,
			uid: 500,
		});

		assert.deepEqual(
			remaining.map((m) => m.uid),
			[501, 502, 503, 50],
		);
	});

	it("skips nothing when the recorded group has vanished from the result", () => {
		// The group's remainder was expunged, or re-modified onto a higher
		// mod-sequence. Inferring the in-progress group from the lowest one
		// returned would drop the two leading messages of an unrelated group.
		const ordered = [
			message(10, "300"),
			message(20, "300"),
			message(600, "300"),
		];

		const remaining = dropAppliedPrefix(ordered, {
			modseq: 199n,
			group: 200n,
			uid: 500,
		});

		assert.deepEqual(
			remaining.map((m) => m.uid),
			[10, 20, 600],
		);
	});
});

describe("advanceChangeCursor", () => {
	const noFailures = new Set<number>();
	const boundary = (modseq: bigint): ChangeCursor => ({
		modseq,
		group: 0n,
		uid: 0,
	});

	it("jumps to the server HIGHESTMODSEQ when the whole set was applied", () => {
		const ordered = [message(1, "11"), message(2, "12")];

		const result = advanceChangeCursor({
			cursor: boundary(10n),
			serverModseq: 20n,
			ordered,
			batch: ordered,
			failedUids: noFailures,
		});

		assert.deepEqual(result, { cursor: boundary(20n), hasMore: false });
	});

	it("records which group it stopped inside, and where", () => {
		// 60 messages marked read by one STORE; the round applies 50.
		const ordered = tieGroup(60, "900", 10);

		const result = advanceChangeCursor({
			cursor: boundary(800n),
			serverModseq: 900n,
			ordered,
			batch: ordered.slice(0, 50),
			failedUids: noFailures,
		});

		assert.deepEqual(result, {
			cursor: { modseq: 899n, group: 900n, uid: 59 },
			hasMore: true,
		});
	});

	it("resumes a part-applied group and closes it on the boundary", () => {
		const ordered = tieGroup(10, "900", 60);

		const result = advanceChangeCursor({
			cursor: { modseq: 899n, group: 900n, uid: 59 },
			serverModseq: 900n,
			ordered,
			batch: ordered,
			failedUids: noFailures,
		});

		assert.deepEqual(result, { cursor: boundary(900n), hasMore: false });
	});

	it("stops on the boundary when the next change starts a new group", () => {
		const ordered = [...tieGroup(2, "900", 10), ...tieGroup(2, "950", 20)];

		const result = advanceChangeCursor({
			cursor: boundary(800n),
			serverModseq: 999n,
			ordered,
			batch: ordered.slice(0, 2),
			failedUids: noFailures,
		});

		assert.deepEqual(result, { cursor: boundary(900n), hasMore: true });
	});

	it("stops below a failure inside a group", () => {
		const ordered = tieGroup(4, "900", 10);

		const result = advanceChangeCursor({
			cursor: boundary(800n),
			serverModseq: 900n,
			ordered,
			batch: ordered,
			failedUids: new Set([12]),
		});

		assert.deepEqual(result.cursor, { modseq: 899n, group: 900n, uid: 11 });
	});

	it("does not move when the very first change fails", () => {
		const ordered = tieGroup(2, "900", 10);

		const result = advanceChangeCursor({
			cursor: boundary(800n),
			serverModseq: 900n,
			ordered,
			batch: ordered,
			failedUids: new Set([10]),
		});

		assert.deepEqual(result.cursor, boundary(800n));
	});

	it("keeps every completed group when a later one fails part-way", () => {
		const ordered = [...tieGroup(2, "810", 1), ...tieGroup(3, "900", 10)];

		const result = advanceChangeCursor({
			cursor: boundary(800n),
			serverModseq: 999n,
			ordered,
			batch: ordered,
			failedUids: new Set([11]),
		});

		// 810 is complete and 900 is part-applied, so the fetch point sits just
		// below 900 and the group is named.
		assert.deepEqual(result.cursor, { modseq: 899n, group: 900n, uid: 10 });
	});

	it("never moves backwards when the server reports a lower value", () => {
		const result = advanceChangeCursor({
			cursor: boundary(50n),
			serverModseq: 20n,
			ordered: [],
			batch: [],
			failedUids: noFailures,
		});

		assert.deepEqual(result.cursor, boundary(50n));
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
