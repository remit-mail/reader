import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RemitClient } from "@remit/backend/client";
import { noopLogger } from "@remit/logger-lambda/noop-logger";
import type { SenderCategoryBackApplyEvent } from "../events.js";
import { processSenderCategoryBackApply } from "./sender-category-backapply.js";

const event: SenderCategoryBackApplyEvent = {
	type: "SenderCategoryBackApply",
	accountConfigId: "cfg-1",
	addressId: "addr-1",
	normalizedEmail: "post@ns.nl",
	category: "newsletter",
};

const row = {
	threadMessageId: "tm-1",
	messageId: "msg-1",
	mailboxId: "mbx-inbox",
	fromEmail: "post@ns.nl",
	category: "personal",
	sentDate: 1_000,
	isRead: false,
	isDeleted: false,
	hasStars: false,
	hasAttachment: false,
};

const clientOver = (
	relabelled: Array<{ messageId: string; category: unknown }>,
	listByFieldTerms: () => Promise<unknown>,
): RemitClient =>
	({
		message: {
			update: async (messageId: string, input: { category: unknown }) => {
				relabelled.push({ messageId, category: input.category });
			},
		},
		threadMessage: {
			listByFieldTerms,
			findAllByMessageId: async () => [row],
			update: async () => {},
		},
	}) as unknown as RemitClient;

describe("processSenderCategoryBackApply (#415)", () => {
	it("re-labels the sender's stored mail to the category the event carries", async () => {
		const relabelled: Array<{ messageId: string; category: unknown }> = [];

		await processSenderCategoryBackApply(event, noopLogger, {
			client: clientOver(relabelled, async () => ({
				items: [row],
				continuationToken: undefined,
			})),
		});

		assert.deepEqual(relabelled, [
			{ messageId: "msg-1", category: "newsletter" },
		]);
	});

	it("propagates a store failure so partial batch failure redelivers the record", async () => {
		await assert.rejects(
			processSenderCategoryBackApply(event, noopLogger, {
				client: clientOver([], async () => {
					throw new Error("SQLITE_BUSY");
				}),
			}),
			/SQLITE_BUSY/,
			"the pass writes only idempotent local rows, so a retry is safe and must happen",
		);
	});
});
