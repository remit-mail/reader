import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	MessageMutation,
	MessageStatus,
	MessageSyncStatus,
} from "@remit/domain-enums";
import {
	abandonedMutationOf,
	hasAbandonedDelete,
	hasAbandonedMove,
	type MessageSettlementFields,
} from "./message-settlement.js";

const row = (over: Partial<MessageSettlementFields>): MessageSettlementFields =>
	({
		status: MessageStatus.active,
		syncStatus: MessageSyncStatus.synced,
		abandonedMutation: MessageMutation.none,
		...over,
	}) as MessageSettlementFields;

describe("abandonedMutationOf", () => {
	test("names the delete `abandonDelete` gave up on", () => {
		assert.equal(
			abandonedMutationOf(
				row({
					syncStatus: MessageSyncStatus.abandoned,
					abandonedMutation: MessageMutation.delete,
				}),
			),
			MessageMutation.delete,
		);
	});

	/**
	 * Issue #1229: the two used to be one state on the wire, so a move that
	 * handed back rendered the delete copy under a button that deleted the
	 * message. The row has to say which, because the hand-back is what erased
	 * the `status` that said it.
	 */
	test("names the move a hand-back gave up on, distinctly", () => {
		assert.equal(
			abandonedMutationOf(
				row({
					syncStatus: MessageSyncStatus.abandoned,
					abandonedMutation: MessageMutation.move,
				}),
			),
			MessageMutation.move,
		);
	});

	test("`syncStatus` is the gate: a settled row's stale marker says nothing", () => {
		assert.equal(
			abandonedMutationOf(
				row({
					syncStatus: MessageSyncStatus.synced,
					abandonedMutation: MessageMutation.delete,
				}),
			),
			MessageMutation.none,
		);
	});

	/**
	 * `failed` is the transient attempt marker — every handler writes it and
	 * re-throws for redelivery (imap-mutations R3) — so it can never mean a
	 * give-up, whatever `status` sits beside it. This is issue #1153: before the
	 * give-up had a value of its own, these three were the same row.
	 */
	for (const status of [
		MessageStatus.active,
		MessageStatus.moving,
		MessageStatus.deleting,
	]) {
		test(`a ${status} row mid-retry is not a give-up`, () => {
			assert.equal(
				abandonedMutationOf(
					row({ status, syncStatus: MessageSyncStatus.failed }),
				),
				MessageMutation.none,
			);
		});
	}

	test("an ordinary inbound row, `pending` forever, says nothing", () => {
		assert.equal(
			abandonedMutationOf(row({ syncStatus: MessageSyncStatus.pending })),
			MessageMutation.none,
		);
	});

	/**
	 * A move or delete that exhausted its retries is repaired against IMAP and
	 * now carries the give-up (#1098, #1005). What still lands on `synced` is a
	 * hand-back that refused nothing — the server never heard the command — and
	 * that is settled, not abandoned.
	 */
	test("`synced` is never a give-up, however it was reached", () => {
		assert.equal(
			abandonedMutationOf(row({ syncStatus: MessageSyncStatus.synced })),
			MessageMutation.none,
		);
	});
});

describe("the per-operation predicates", () => {
	const abandoned = (
		mutation: MessageSettlementFields["abandonedMutation"],
	): MessageSettlementFields =>
		row({
			syncStatus: MessageSyncStatus.abandoned,
			abandonedMutation: mutation,
		});

	test("a delete that gave up is a delete and not a move", () => {
		assert.equal(hasAbandonedDelete(abandoned(MessageMutation.delete)), true);
		assert.equal(hasAbandonedMove(abandoned(MessageMutation.delete)), false);
	});

	test("a move that gave up is a move and not a delete", () => {
		assert.equal(hasAbandonedMove(abandoned(MessageMutation.move)), true);
		assert.equal(hasAbandonedDelete(abandoned(MessageMutation.move)), false);
	});

	test("a copy that gave up claims neither", () => {
		const copy = abandoned(MessageMutation.copy);
		assert.equal(hasAbandonedDelete(copy), false);
		assert.equal(hasAbandonedMove(copy), false);
	});
});
