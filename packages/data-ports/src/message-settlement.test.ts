import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { MessageStatus, MessageSyncStatus } from "@remit/domain-enums";
import { messageSettlementOf } from "./message-settlement.js";

describe("messageSettlementOf", () => {
	test("an ordinary inbound row is settled, `pending` and all", () => {
		assert.equal(
			messageSettlementOf({
				status: MessageStatus.active,
				syncStatus: MessageSyncStatus.pending,
			}),
			"settled",
		);
	});

	test("a move still being pushed is in flight", () => {
		assert.equal(
			messageSettlementOf({
				status: MessageStatus.moving,
				syncStatus: MessageSyncStatus.pending,
			}),
			"in_flight",
		);
	});

	test("a delete still being pushed is in flight", () => {
		assert.equal(
			messageSettlementOf({
				status: MessageStatus.deleting,
				syncStatus: MessageSyncStatus.synced,
			}),
			"in_flight",
		);
	});

	test("a broken move — the pair message-move leaves — is abandoned", () => {
		assert.equal(
			messageSettlementOf({
				status: MessageStatus.moving,
				syncStatus: MessageSyncStatus.failed,
			}),
			"abandoned",
		);
	});

	test("a broken delete settles `status` back to active and stays abandoned", () => {
		assert.equal(
			messageSettlementOf({
				status: MessageStatus.active,
				syncStatus: MessageSyncStatus.failed,
			}),
			"abandoned",
		);
	});
});
