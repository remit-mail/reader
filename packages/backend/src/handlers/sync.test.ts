import assert from "node:assert/strict";
import { describe, it, type TestContext } from "node:test";
import {
	failingQueue,
	type RecordingQueue,
	recordingQueue,
} from "@remit/data-ports/recording-queue";
import {
	openStore,
	seedAccount,
} from "@remit/mailbox-service/test-helpers/test-store";
import { testApiConfig } from "../config/test-config.js";
import { serveApi } from "../serve.js";
import { createRemitClient } from "../service/create-remit-client.js";
import { buildSharedDeps } from "../service/shared-deps.js";
import { SyncOperations } from "./sync.js";

const api = serveApi<"sync">({ handlers: SyncOperations, publicHandlers: {} });

const setupSync = async (t: TestContext, queue: RecordingQueue) => {
	const store = await openStore();
	t.after(store.close);
	const { accountId, accountConfigId, email } = await seedAccount(store);
	const client = createRemitClient({
		...buildSharedDeps(
			{
				sync: queue.fifo,
				accountFanout: queue,
				smtp: queue,
				messageManagement: queue,
				body: queue,
			},
			{
				get: async () => ({ value: { state: "None" }, source: "Config" }),
				put: async () => {},
				delete: async () => {},
			},
			[{ name: "Inline", thresholds: { state: "Unset" } }],
		),
		repositories: store,
		storage: store.storage(),
	});
	const syncUrl = `https://reader.test/accounts/${accountId}/sync`;
	const request = (request: Request) =>
		api.handleFetch(
			request,
			{
				config: testApiConfig(),
				client: async () => client,
				identity: async () => ({
					kind: "user",
					accountConfigId,
					sub: "user-1",
					email,
				}),
				operator: async () => false,
				peopleDirectory: async () => null,
			},
			"sync-test",
		);
	return {
		accountId,
		store,
		postSync: () => request(new Request(syncUrl, { method: "POST" })),
		getStatus: () => request(new Request(`${syncUrl}/status`)),
	};
};

describe("POST /accounts/{accountId}/sync", () => {
	it("returns the queued event timestamp and reports it once discovery records it", async (t) => {
		const queue = recordingQueue();
		const { accountId, store, postSync, getStatus } = await setupSync(t, queue);

		const response = await postSync();

		assert.equal(response.status, 200);
		assert.equal(queue.sent.length, 1);
		assert.equal(queue.sent[0]?.body.type, "SYNC_MAILBOXES");
		assert.equal(queue.sent[0]?.body.accountId, accountId);
		assert.equal(queue.sent[0]?.body.explicitRequest, true);
		const { requestedAt } = await response.json();
		assert.equal(requestedAt, queue.sent[0].body.timestamp);

		const beforeDiscovery = await getStatus();
		assert.equal(beforeDiscovery.status, 200);
		assert.equal((await beforeDiscovery.json()).syncRequestedAt, undefined);

		await store.account.update(accountId, { syncRequestedAt: requestedAt });
		const status = await getStatus();
		assert.equal(status.status, 200);
		assert.equal((await status.json()).syncRequestedAt, requestedAt);
	});

	it("answers 500 when the enqueue fails", async (t) => {
		const queue = failingQueue(new Error("Queue unavailable"));

		const { postSync } = await setupSync(t, queue);
		const response = await postSync();

		assert.equal(response.status, 500);
		assert.equal(queue.sent.length, 1);
	});
});
