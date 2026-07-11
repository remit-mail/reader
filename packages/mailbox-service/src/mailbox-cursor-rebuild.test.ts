import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	type CursorRebuildRow,
	type CursorRebuildSnapshot,
	matchCursorRebuild,
} from "./mailbox-cursor-rebuild.js";

const row = (over: Partial<CursorRebuildRow>): CursorRebuildRow => ({
	messageId: "msg-1",
	messageIdHeader: "<a@example.com>",
	internalDate: 1_700_000_000_000,
	uid: 10,
	...over,
});

const snapshot = (
	over: Partial<CursorRebuildSnapshot>,
): CursorRebuildSnapshot => ({
	uid: 10,
	messageId: "<a@example.com>",
	internalDate: 1_700_000_000_000,
	...over,
});

describe("matchCursorRebuild", () => {
	it("matches by Message-ID and rewrites the UID mapping when the UID changed", () => {
		const existingRows = [row({ messageId: "msg-1", uid: 10 })];
		const serverSnapshots = [snapshot({ uid: 55 })];

		const result = matchCursorRebuild(serverSnapshots, existingRows);

		assert.deepEqual(result.matched, [
			{ messageId: "msg-1", oldUid: 10, newUid: 55 },
		]);
		assert.deepEqual(result.newUids, []);
		assert.deepEqual(result.staleMessageIds, []);
	});

	it("does not emit a rewrite when the matched UID is unchanged (frugal — no-op write)", () => {
		const existingRows = [row({ messageId: "msg-1", uid: 10 })];
		const serverSnapshots = [snapshot({ uid: 10 })];

		const result = matchCursorRebuild(serverSnapshots, existingRows);

		assert.deepEqual(result.matched, []);
		assert.deepEqual(result.staleMessageIds, []);
	});

	it("classifies a server message with no matching row as new — normal new-message sync", () => {
		const existingRows: CursorRebuildRow[] = [];
		const serverSnapshots = [
			snapshot({ uid: 99, messageId: "<never-seen@example.com>" }),
		];

		const result = matchCursorRebuild(serverSnapshots, existingRows);

		assert.deepEqual(result.matched, []);
		assert.deepEqual(result.newUids, [99]);
		assert.deepEqual(result.staleMessageIds, []);
	});

	it("classifies a row with no matching server message as stale — expunged, reconcile", () => {
		const existingRows = [
			row({ messageId: "msg-gone", messageIdHeader: "<gone@example.com>" }),
		];
		const serverSnapshots: CursorRebuildSnapshot[] = [];

		const result = matchCursorRebuild(serverSnapshots, existingRows);

		assert.deepEqual(result.matched, []);
		assert.deepEqual(result.newUids, []);
		assert.deepEqual(result.staleMessageIds, ["msg-gone"]);
	});

	it("handles a mixed batch: one match, one new, one stale", () => {
		const existingRows = [
			row({
				messageId: "msg-keep",
				messageIdHeader: "<keep@example.com>",
				uid: 5,
			}),
			row({
				messageId: "msg-gone",
				messageIdHeader: "<gone@example.com>",
				uid: 6,
			}),
		];
		const serverSnapshots = [
			snapshot({ uid: 105, messageId: "<keep@example.com>" }),
			snapshot({ uid: 200, messageId: "<new@example.com>" }),
		];

		const result = matchCursorRebuild(serverSnapshots, existingRows);

		assert.deepEqual(result.matched, [
			{ messageId: "msg-keep", oldUid: 5, newUid: 105 },
		]);
		assert.deepEqual(result.newUids, [200]);
		assert.deepEqual(result.staleMessageIds, ["msg-gone"]);
	});

	it("falls back to an exact INTERNALDATE match for headerless messages on both sides", () => {
		const existingRows = [
			row({
				messageId: "msg-headerless",
				messageIdHeader: "",
				internalDate: 42,
				uid: 3,
			}),
		];
		const serverSnapshots = [
			snapshot({ uid: 77, messageId: "", internalDate: 42 }),
		];

		const result = matchCursorRebuild(serverSnapshots, existingRows);

		assert.deepEqual(result.matched, [
			{ messageId: "msg-headerless", oldUid: 3, newUid: 77 },
		]);
		assert.deepEqual(result.staleMessageIds, []);
	});

	it("picks the closest INTERNALDATE among multiple rows sharing one Message-ID (legitimate resends)", () => {
		const existingRows = [
			row({ messageId: "msg-early", internalDate: 1000, uid: 1 }),
			row({ messageId: "msg-late", internalDate: 5000, uid: 2 }),
		];
		const serverSnapshots = [snapshot({ uid: 50, internalDate: 4900 })];

		const result = matchCursorRebuild(serverSnapshots, existingRows);

		assert.deepEqual(result.matched, [
			{ messageId: "msg-late", oldUid: 2, newUid: 50 },
		]);
		assert.deepEqual(result.staleMessageIds, ["msg-early"]);
	});

	it("carries the row's threadMessage ref through to the match, so the caller can rewrite ThreadMessage.uid alongside Message.uid", () => {
		const threadMessage = {
			accountConfigId: "acfg-1",
			threadMessageId: "tm-1",
			sentDate: 1_700_000_000_000,
			mailboxId: "mbx-1",
			isRead: true,
			isDeleted: false,
			hasStars: false,
			hasAttachment: false,
		};
		const existingRows = [row({ messageId: "msg-1", uid: 10, threadMessage })];
		const serverSnapshots = [snapshot({ uid: 99 })];

		const result = matchCursorRebuild(serverSnapshots, existingRows);

		assert.deepEqual(result.matched, [
			{ messageId: "msg-1", oldUid: 10, newUid: 99, threadMessage },
		]);
	});

	it("omits threadMessage from the match when the row carries none (test fixtures that don't need it)", () => {
		const existingRows = [row({ messageId: "msg-1", uid: 10 })];
		const serverSnapshots = [snapshot({ uid: 99 })];

		const result = matchCursorRebuild(serverSnapshots, existingRows);

		assert.deepEqual(result.matched, [
			{ messageId: "msg-1", oldUid: 10, newUid: 99 },
		]);
		assert.equal("threadMessage" in result.matched[0], false);
	});
});
