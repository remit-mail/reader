import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	failingQueue,
	type RecordingQueue,
	recordingQueue,
} from "@remit/data-ports/recording-queue";
import { testApiConfig } from "../config/test-config.js";
import { serveApi } from "../serve.js";
import type { RemitClient } from "../service/data-client.js";
import { SyncOperations } from "./sync.js";

const accountId = "8f14e45f-ceea-467a-9c9e-9c9e9e9c9e9c";
const accountConfigId = "config-1";
const api = serveApi<"sync">({ handlers: SyncOperations, publicHandlers: {} });

const postSync = (queue: RecordingQueue) =>
	api.handleFetch(
		new Request(`https://reader.test/accounts/${accountId}/sync`, {
			method: "POST",
		}),
		{
			config: testApiConfig(),
			client: async () =>
				({
					account: { get: async () => ({ accountId, accountConfigId }) },
					queues: { sync: queue.fifo },
				}) as unknown as RemitClient<"sync">,
			identity: async () => ({
				kind: "user",
				accountConfigId,
				sub: "user-1",
				email: "reader@example.test",
			}),
			operator: async () => false,
			peopleDirectory: async () => null,
		},
		"sync-test",
	);

describe("POST /accounts/{accountId}/sync", () => {
	it("enqueues an explicit SYNC_MAILBOXES event", async () => {
		const queue = recordingQueue();

		const response = await postSync(queue);

		assert.equal(response.status, 200);
		assert.equal(queue.sent.length, 1);
		assert.equal(queue.sent[0]?.body.type, "SYNC_MAILBOXES");
		assert.equal(queue.sent[0]?.body.accountId, accountId);
		assert.equal(queue.sent[0]?.body.explicitRequest, true);
	});

	it("answers 500 when the enqueue fails", async () => {
		const queue = failingQueue(new Error("Queue unavailable"));

		const response = await postSync(queue);

		assert.equal(response.status, 500);
		assert.equal(queue.sent.length, 1);
	});
});
