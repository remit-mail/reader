import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { MessageStatus, MessageSyncStatus } from "@remit/domain-enums";
import { hasAbandonedDelete } from "./message-settlement.js";

describe("hasAbandonedDelete", () => {
	test("the pair both terminal delete paths write", () => {
		assert.equal(
			hasAbandonedDelete({
				status: MessageStatus.active,
				syncStatus: MessageSyncStatus.failed,
			}),
			true,
		);
	});

	test("a move mid-retry is not a give-up, whatever `failed` suggests", () => {
		assert.equal(
			hasAbandonedDelete({
				status: MessageStatus.moving,
				syncStatus: MessageSyncStatus.failed,
			}),
			false,
		);
	});

	test("a move that gave up is the same pair, so it is refused too", () => {
		assert.equal(
			hasAbandonedDelete({
				status: MessageStatus.moving,
				syncStatus: MessageSyncStatus.failed,
			}),
			false,
		);
	});

	test("a delete mid-retry keeps `deleting`, so it is not a give-up", () => {
		assert.equal(
			hasAbandonedDelete({
				status: MessageStatus.deleting,
				syncStatus: MessageSyncStatus.failed,
			}),
			false,
		);
	});

	test("a copy that gave up hides its row as `deleted` rather than claiming this", () => {
		assert.equal(
			hasAbandonedDelete({
				status: MessageStatus.deleted,
				syncStatus: MessageSyncStatus.failed,
			}),
			false,
		);
	});

	test("a settled move — `updateUid` writes active and synced together", () => {
		assert.equal(
			hasAbandonedDelete({
				status: MessageStatus.active,
				syncStatus: MessageSyncStatus.synced,
			}),
			false,
		);
	});

	test("an ordinary inbound row, `pending` forever, says nothing", () => {
		assert.equal(
			hasAbandonedDelete({
				status: MessageStatus.active,
				syncStatus: MessageSyncStatus.pending,
			}),
			false,
		);
	});
});
