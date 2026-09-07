import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RemitImapThreadMessageResponse } from "@remit/api-http-client/types.gen.ts";
import { toImapDraftRowData } from "@/lib/drafts";
import { threadToRowData } from "./MessageListItem";
import { swipeableRowData } from "./SwipeableMessageRow";

const baseThread = (
	overrides: Partial<RemitImapThreadMessageResponse> = {},
): RemitImapThreadMessageResponse =>
	({
		threadMessageId: "tm-1",
		threadId: "th-1",
		messageId: "msg-1",
		accountConfigId: "acc-1",
		mailboxId: "mbx-1",
		sentDate: 0,
		isRead: true,
		hasAttachment: false,
		hasStars: false,
		star: "None",
		isDeleted: false,
		senderTrust: "unknown",
		abandonedMutation: "none",
		createdAt: 0,
		updatedAt: 0,
		...overrides,
	}) as RemitImapThreadMessageResponse;

describe("threadToRowData — labels", () => {
	it("carries the message's applied labels through to the row (issue #26)", () => {
		const row = threadToRowData(
			baseThread({
				labels: [{ labelId: "l1", name: "Receipts", color: "Blue" }],
			}),
		);
		assert.deepEqual(row.labels, [
			{ labelId: "l1", name: "Receipts", color: "Blue" },
		]);
	});

	it("carries no labels when the message has none", () => {
		const row = threadToRowData(baseThread());
		assert.equal(row.labels, undefined);
	});
});

describe("threadToRowData — settlement (issue #1002)", () => {
	it("marks a row whose delete gave up and came back", () => {
		const row = threadToRowData(
			baseThread({
				status: "active",
				syncStatus: "abandoned",
				abandonedMutation: "delete",
			}),
		);
		assert.equal(row.settlement, "delete_failed");
	});

	// Issue #1229. Both give-ups hand the row back the same way, so before the
	// row named the mutation this rendered "Not deleted" over a move.
	it("marks a row whose move gave up as a move, not a delete", () => {
		const row = threadToRowData(
			baseThread({
				status: "active",
				syncStatus: "abandoned",
				abandonedMutation: "move",
			}),
		);
		assert.equal(row.settlement, "move_failed");
	});

	it("says nothing about a copy that gave up, whose row no listing carries", () => {
		const row = threadToRowData(
			baseThread({
				status: "deleted",
				syncStatus: "abandoned",
				abandonedMutation: "copy",
			}),
		);
		assert.equal(row.settlement, undefined);
	});

	// `syncStatus` is the gate: a marker a later settle left behind says nothing.
	it("says nothing about a settled row still carrying a stale marker", () => {
		const row = threadToRowData(
			baseThread({
				status: "active",
				syncStatus: "synced",
				abandonedMutation: "delete",
			}),
		);
		assert.equal(row.settlement, undefined);
	});

	it("says nothing about a transient attempt on an active row", () => {
		const row = threadToRowData(
			baseThread({ status: "active", syncStatus: "failed" }),
		);
		assert.equal(row.settlement, undefined);
	});

	it("says nothing about a move mid-retry, which writes the same failed flag", () => {
		const row = threadToRowData(
			baseThread({ status: "moving", syncStatus: "failed" }),
		);
		assert.equal(row.settlement, undefined);
	});

	it("says nothing about a delete still being pushed", () => {
		const row = threadToRowData(
			baseThread({ status: "deleting", syncStatus: "pending" }),
		);
		assert.equal(row.settlement, undefined);
	});

	it("leaves an ordinary inbound row unmarked, pending and all", () => {
		const row = threadToRowData(
			baseThread({ status: "active", syncStatus: "pending" }),
		);
		assert.equal(row.settlement, undefined);
	});
});

describe("the mobile and drafts rows carry the same mark", () => {
	it("marks the swipeable mobile row", () => {
		const row = swipeableRowData(
			baseThread({
				status: "active",
				syncStatus: "abandoned",
				abandonedMutation: "delete",
			}),
		);
		assert.equal(row.settlement, "delete_failed");
	});

	it("marks the drafts row", () => {
		const row = toImapDraftRowData(
			baseThread({
				status: "active",
				syncStatus: "abandoned",
				abandonedMutation: "delete",
			}),
		);
		assert.equal(row.settlement, "delete_failed");
	});

	it("leaves a move mid-retry unmarked on both", () => {
		const thread = baseThread({ status: "moving", syncStatus: "failed" });
		assert.equal(swipeableRowData(thread).settlement, undefined);
		assert.equal(toImapDraftRowData(thread).settlement, undefined);
	});
});
