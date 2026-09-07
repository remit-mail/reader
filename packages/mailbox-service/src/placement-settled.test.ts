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
 * Note what these cases say about `syncStatus`: `failed` is a transient attempt
 * with a redelivery behind it, so a foreign-uid row carrying it is `in_flight`
 * and gets the settle ceiling. Only `abandoned` — the give-up value of the
 * placement state model (imap-mutations R3) — refuses outright.
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

	/**
	 * A give-up cannot reach this pair. `abandoned` is written only alongside
	 * `active` or `deleted`, on a row already put back on a placement the server
	 * confirmed, so the binding it produces is `consistent` — there is no
	 * give-up member here to return, and no dependent mutation is refused on
	 * account of one.
	 */
	test("a give-up never presents as a foreign-uid row at all", () => {
		assert.equal(
			placementBindingOf(
				row({
					status: MessageStatus.active,
					syncStatus: MessageSyncStatus.abandoned,
					mailboxId: "mbx-src",
				}),
			),
			"consistent",
		);
	});

	test("`failed` on a foreign-uid row is mid-retry, so it waits rather than refusing", () => {
		assert.equal(
			placementBindingOf(row({ syncStatus: MessageSyncStatus.failed })),
			"in_flight",
		);
	});

	// R3's state table calls `deleting` in flight exactly as `moving` is: a
	// delete points the row at Trash with the source's uid, so a dependent
	// mutation reading it resolves the same mismatched pair.
	test("a delete in flight is unsettled, not settled", () => {
		assert.equal(
			placementBindingOf(row({ status: MessageStatus.deleting })),
			"in_flight",
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
