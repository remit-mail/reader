import { ApiClient } from "../src/api.js";
import { expect, test } from "../src/fixtures.js";
import { type IsolatedRun, provisionIsolatedRun } from "../src/provision.js";
import {
	MAILBOXES_QUEUE,
	MESSAGES_QUEUE,
	waitForQueueDrained,
	waitingMessages,
} from "../src/queue.js";

const BURST = 60;
const SAMPLE_INTERVAL_MS = 50;

test.describe("A burst of refreshes (#1366)", () => {
	let run: IsolatedRun;
	let api: ApiClient;

	test.beforeAll(async () => {
		test.setTimeout(180_000);
		run = await provisionIsolatedRun("E2E Sync Burst", [
			{
				subject: `Sync burst ${Date.now()}`,
				body: "Seeded so the account syncs.",
			},
		]);
		api = new ApiClient(run);
		await waitForQueueDrained(MAILBOXES_QUEUE);
		await waitForQueueDrained(MESSAGES_QUEUE);
	});

	test("keeps at most one waiting sync per folder on the messages queue", async () => {
		test.setTimeout(180_000);

		const folders = (await api.listMailboxes(run.accountId)).length;
		expect(folders).toBeGreaterThan(1);

		const depths: number[] = [];
		let sampling = true;
		const sampler = (async () => {
			while (sampling) {
				depths.push(await waitingMessages(MESSAGES_QUEUE));
				await new Promise((resolve) => setTimeout(resolve, SAMPLE_INTERVAL_MS));
			}
		})();

		await Promise.all(
			Array.from({ length: BURST }, () => api.triggerSync(run.accountId)),
		);
		await waitForQueueDrained(MAILBOXES_QUEUE);
		await waitForQueueDrained(MESSAGES_QUEUE);
		sampling = false;
		await sampler;

		expect(depths.length).toBeGreaterThan(0);
		expect(Math.max(...depths)).toBeLessThanOrEqual(folders);
	});
});
