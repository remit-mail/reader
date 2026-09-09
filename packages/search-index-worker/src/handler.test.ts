import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Logger } from "@remit/logger-lambda";
import type { SQSRecord } from "aws-lambda";
import { MemoryStallTimeoutError } from "./adaptive-embedder.js";
import { processBatch } from "./handler.js";
import type { Services } from "./services.js";

const MESSAGE_ID = "11111111-1111-4111-8111-111111111111";
const ACCOUNT_ID = "22222222-2222-4222-8222-222222222222";

const record = (): SQSRecord =>
	({
		messageId: "sqs-1",
		eventSourceARN: "http://queue:9324/000000000000/remit-search-index",
		body: JSON.stringify({
			eventName: "INSERT",
			entity: "Message",
			eventID: "e1",
			eventTimestamp: 0,
			accountId: ACCOUNT_ID,
			keys: { pk: "pk", sk: "sk" },
			messageId: MESSAGE_ID,
		}),
	}) as unknown as SQSRecord;

const silent = {
	info: () => {},
	error: () => {},
} as unknown as Logger;

const servicesThatFail = (error: Error): Services =>
	({
		accountService: {
			get: async () => ({
				accountConfigId: "config-1",
				deletedAt: undefined,
			}),
		},
		threadMessageService: {
			findByMessageId: async () => ({
				accountConfigId: "config-1",
				threadId: "thread-1",
				mailboxId: "mailbox-1",
				sentDate: 0,
				isRead: false,
				hasAttachment: false,
				hasStars: false,
				category: "primary",
			}),
		},
		storageService: {
			retrieveParsedBody: async () => ({ text: "hello", html: "" }),
		},
		searchService: {
			prepareVectors: async () => {
				throw error;
			},
		},
	}) as unknown as Services;

describe("a message the worker cannot index right now", () => {
	// The governor stops rather than pushing the box into swap, and gives up
	// before the queue's visibility timeout redelivers the record underneath it
	// (#585). Reporting the item as failed is what makes that redelivery clean:
	// the record goes back, its siblings still index, and the retry count is the
	// queue's rather than something this process tracks.
	it("goes back on the queue when indexing stalls out of memory", async () => {
		const response = await processBatch(
			[record()],
			servicesThatFail(new MemoryStallTimeoutError(240_000, 2_000)),
			silent,
		);

		assert.deepEqual(response.batchItemFailures, [{ itemIdentifier: "sqs-1" }]);
	});

	it("reports a model failure the same way, rather than dropping the message", async () => {
		const response = await processBatch(
			[record()],
			servicesThatFail(new Error("model could not be loaded")),
			silent,
		);

		assert.deepEqual(response.batchItemFailures, [{ itemIdentifier: "sqs-1" }]);
	});
});
