import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RemitImapThreadMessageResponse } from "@remit/api-http-client/types.gen.ts";
import { threadToRowData } from "./MessageListItem";

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
