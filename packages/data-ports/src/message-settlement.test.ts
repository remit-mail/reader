import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { MessageStatus, MessageSyncStatus } from "@remit/domain-enums";
import { hasAbandonedDelete } from "./message-settlement.js";

describe("hasAbandonedDelete", () => {
	test("the pair abandonDelete writes, its only writer", () => {
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

	/**
	 * Both a settled move (`updateUid`) and a delete that exhausted its retries
	 * (#1143 repairs the row to where the message actually is) land on this pair.
	 * The second is a give-up this predicate deliberately cannot see — pinned so
	 * the gap is a decision on record, not an oversight.
	 */
	test("`active` + `synced` is never a give-up, however it was reached", () => {
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
