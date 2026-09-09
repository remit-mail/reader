import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RemitClient } from "@remit/backend/client";
import { NotFoundError } from "@remit/data-ports/errors";
import { noopLogger } from "@remit/logger-lambda/noop-logger";
import type { SenderCategoryBackApplyEvent } from "../events.js";
import { processSenderCategoryBackApply } from "./sender-category-backapply.js";

const SET_AT = 1_700;

const event: SenderCategoryBackApplyEvent = {
	type: "SenderCategoryBackApply",
	accountConfigId: "cfg-1",
	addressId: "addr-1",
	normalizedEmail: "post@ns.nl",
	category: "newsletter",
	categorySetAt: SET_AT,
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

interface ClientShape {
	relabelled: Array<{ messageId: string; category: unknown }>;
	storedFlag?: { value: string; setAt: number } | "cleared" | "address-gone";
	listByFieldTerms?: () => Promise<unknown>;
	updateMessage?: (messageId: string) => Promise<void>;
}

const clientOver = ({
	relabelled,
	storedFlag = { value: "newsletter", setAt: SET_AT },
	listByFieldTerms = async () => ({
		items: [row],
		continuationToken: undefined,
	}),
	updateMessage,
}: ClientShape): RemitClient =>
	({
		address: {
			getAddress: async () => {
				if (storedFlag === "address-gone") {
					throw new NotFoundError("Address addr-1 not found");
				}
				if (storedFlag === "cleared") {
					return { addressId: "addr-1", flags: {} };
				}
				return { addressId: "addr-1", flags: { category: storedFlag } };
			},
		},
		message: {
			update: async (messageId: string, input: { category: unknown }) => {
				if (updateMessage) await updateMessage(messageId);
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
			client: clientOver({ relabelled }),
		});

		assert.deepEqual(relabelled, [
			{ messageId: "msg-1", category: "newsletter" },
		]);
	});

	it("applies nothing when the user has since corrected the category", async () => {
		const relabelled: Array<{ messageId: string; category: unknown }> = [];

		await processSenderCategoryBackApply(event, noopLogger, {
			client: clientOver({
				relabelled,
				storedFlag: { value: "promotions", setAt: SET_AT + 60 },
			}),
		});

		assert.deepEqual(
			relabelled,
			[],
			"a redelivery after a correction must not put the superseded category back",
		);
	});

	it("applies nothing when the same category was cleared and set again", async () => {
		const relabelled: Array<{ messageId: string; category: unknown }> = [];

		await processSenderCategoryBackApply(event, noopLogger, {
			client: clientOver({
				relabelled,
				storedFlag: { value: "newsletter", setAt: SET_AT + 60 },
			}),
		});

		assert.deepEqual(relabelled, []);
	});

	it("applies nothing when the override was cleared outright", async () => {
		const relabelled: Array<{ messageId: string; category: unknown }> = [];

		await processSenderCategoryBackApply(event, noopLogger, {
			client: clientOver({ relabelled, storedFlag: "cleared" }),
		});

		assert.deepEqual(relabelled, []);
	});

	it("declines quietly when the address is gone", async () => {
		const relabelled: Array<{ messageId: string; category: unknown }> = [];

		await processSenderCategoryBackApply(event, noopLogger, {
			client: clientOver({ relabelled, storedFlag: "address-gone" }),
		});

		assert.deepEqual(relabelled, []);
	});

	it("leaves a pass with a failed message unacknowledged so it redelivers", async () => {
		await assert.rejects(
			processSenderCategoryBackApply(event, noopLogger, {
				client: clientOver({
					relabelled: [],
					updateMessage: async () => {
						throw new Error("SQLITE_BUSY");
					},
				}),
			}),
			/1 of 1/,
			"acknowledging would strand the thread rows re-labelled and the Message row not",
		);
	});

	it("propagates a store failure so partial batch failure redelivers the record", async () => {
		await assert.rejects(
			processSenderCategoryBackApply(event, noopLogger, {
				client: clientOver({
					relabelled: [],
					listByFieldTerms: async () => {
						throw new Error("SQLITE_BUSY");
					},
				}),
			}),
			/SQLITE_BUSY/,
			"the pass writes only idempotent local rows, so a retry is safe and must happen",
		);
	});
});
