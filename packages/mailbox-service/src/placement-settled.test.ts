import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { MessageItem } from "@remit/data-ports";
import { MessageStatus, MessageSyncStatus } from "@remit/domain-enums";
import { carriesForeignUid, placementBindingOf } from "./placement-settled.js";

/**
 * Pins `placementBindingOf` directly. It is the guard #1098/#1143 depend on and
 * only end-to-end specs covered it, so a change made for the client's benefit
 * could have moved it without anything going red.
 *
 * Note what these cases say about `syncStatus: failed`: it answers `abandoned`
 * here for a row that may well be mid-retry. That is correct for a guard whose
 * consequence is a temporary refusal, and it is exactly why no user-facing
 * statement may be derived from that field alone.
 */
const row = (over: Partial<MessageItem>): MessageItem =>
	({
		messageId: "m-1",
		mailboxId: "mbx-dest",
		uid: 7,
		status: MessageStatus.moving,
		syncStatus: MessageSyncStatus.pending,
		originalMailboxId: "mbx-src",
		originalUid: 7,
		...over,
	}) as unknown as MessageItem;

describe("placementBindingOf", () => {
	test("a settled row binds consistently", () => {
		assert.equal(
			placementBindingOf(row({ status: MessageStatus.active })),
			"consistent",
		);
	});

	test("a row whose uid still names the source is in flight", () => {
		assert.equal(placementBindingOf(row({})), "in_flight");
	});

	test("`failed` on a foreign-uid row is refused as abandoned", () => {
		assert.equal(
			placementBindingOf(row({ syncStatus: MessageSyncStatus.failed })),
			"abandoned",
		);
	});

	test("a moving row that was never moved binds consistently", () => {
		assert.equal(
			placementBindingOf(
				row({ originalUid: undefined, originalMailboxId: undefined }),
			),
			"consistent",
		);
	});

	test("a moving row whose uid has been repointed binds consistently", () => {
		assert.equal(placementBindingOf(row({ uid: 42 })), "consistent");
	});

	test("`failed` alone, with no foreign uid, is still consistent", () => {
		assert.equal(
			placementBindingOf(
				row({
					status: MessageStatus.active,
					syncStatus: MessageSyncStatus.failed,
				}),
			),
			"consistent",
		);
	});
});

/**
 * The same question with the `status` gate off, for callers that resolve a uid
 * off a row some other operation may have re-marked on its way past (#1217).
 */
describe("carriesForeignUid", () => {
	test("holds whatever an operation has since written to `status`", () => {
		for (const status of [
			MessageStatus.moving,
			MessageStatus.deleting,
			MessageStatus.active,
		]) {
			assert.equal(carriesForeignUid(row({ status })), true, status);
		}
	});

	test("is false once `updateUid` settles the move", () => {
		// The settle writes the destination's own uid and drops `originalUid` in
		// the same statement, so a destination counter that hands back the
		// source's number cannot leave the row reading foreign forever.
		assert.equal(
			carriesForeignUid(
				row({
					status: MessageStatus.active,
					syncStatus: MessageSyncStatus.synced,
					originalUid: undefined,
				}),
			),
			false,
		);
	});

	test("is false for a row that was never moved", () => {
		assert.equal(
			carriesForeignUid(
				row({ originalUid: undefined, originalMailboxId: undefined }),
			),
			false,
		);
	});

	test("is false once a restore points the row back at that folder", () => {
		assert.equal(carriesForeignUid(row({ mailboxId: "mbx-src" })), false);
	});
});
