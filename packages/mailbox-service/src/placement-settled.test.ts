import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { MessageItem } from "@remit/data-ports";
import { MessageStatus, MessageSyncStatus } from "@remit/domain-enums";
import { placementBindingOf } from "./placement-settled.js";

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
