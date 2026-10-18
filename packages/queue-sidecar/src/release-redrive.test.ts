import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { bootstrapQueues, loadQueuesConfig } from "./queues-config.js";
import { redriveOnRelease } from "./release-redrive.js";
import { QueueStore } from "./store.js";

const here = fileURLToPath(new URL(".", import.meta.url));
const tmpRoot = join(here, "..", ".tmp", "release-redrive");
const shippedQueues = loadQueuesConfig(
	join(here, "..", "..", "..", "deploy/vps/queues.json"),
);

const bodies = (store: QueueStore, queueName: string): string[] =>
	store
		.receiveMessages({
			queueName,
			maxMessages: 10,
			visibilityTimeoutSeconds: 0,
		})
		.map((message) => message.body);

const failUntilDeadLettered = (store: QueueStore, queueName: string): void => {
	for (let attempt = 0; attempt <= 3; attempt++) {
		store.receiveMessages({
			queueName,
			maxMessages: 10,
			visibilityTimeoutSeconds: 0,
		});
	}
};

describe("the dead-letter redrive a release runs on start", () => {
	let dbPath: string;

	beforeEach(() => {
		mkdirSync(tmpRoot, { recursive: true });
		dbPath = join(mkdtempSync(join(tmpRoot, "q-")), "q.db");
		const store = new QueueStore(dbPath);
		bootstrapQueues(store, shippedQueues);
		store.close();
	});

	after(() => rmSync(tmpRoot, { recursive: true, force: true }));

	const boot = <T>(run: (store: QueueStore) => T): T => {
		const store = new QueueStore(dbPath);
		try {
			return run(store);
		} finally {
			store.close();
		}
	};

	it("returns a dead-lettered body batch to the body queue once per release", () => {
		boot((store) =>
			store.sendMessage({ queueName: "remit-body-dlq", body: "batch-1" }),
		);

		boot((store) => {
			redriveOnRelease(store, "v1.4.0");
			assert.deepEqual(bodies(store, "remit-body"), ["batch-1"]);
			failUntilDeadLettered(store, "remit-body");
			assert.equal(
				store.getQueueAttributes("remit-body-dlq").approximateNumberOfMessages,
				1,
			);
		});

		boot((store) => {
			const outcomes = redriveOnRelease(store, "v1.4.0");
			assert.ok(outcomes.every((o) => o.kind === "already-redriven"));
			assert.deepEqual(bodies(store, "remit-body"), []);
			assert.equal(
				store.getQueueAttributes("remit-body-dlq").approximateNumberOfMessages,
				1,
			);
		});

		boot((store) => {
			redriveOnRelease(store, "v1.5.0");
			assert.deepEqual(bodies(store, "remit-body"), ["batch-1"]);
		});
	});

	it("redrives flags and filings, and leaves sends and folder syncs where they are", () => {
		boot((store) => {
			store.sendMessage({
				queueName: "remit-flags-dlq.fifo",
				body: "flag",
				groupId: "g",
				deduplicationId: "d1",
			});
			store.sendMessage({ queueName: "remit-message-mgmt-dlq", body: "move" });
			store.sendMessage({ queueName: "remit-smtp-dlq", body: "send" });
			store.sendMessage({
				queueName: "remit-mailboxes-dlq.fifo",
				body: "sync",
				groupId: "g",
				deduplicationId: "d2",
			});
		});

		const outcomes = boot((store) => redriveOnRelease(store, "v1.4.0"));

		assert.deepEqual(outcomes.map((o) => o.deadLetterName).sort(), [
			"remit-body-dlq",
			"remit-flags-dlq.fifo",
			"remit-message-mgmt-dlq",
		]);
		boot((store) => {
			assert.deepEqual(bodies(store, "remit-flags.fifo"), ["flag"]);
			assert.deepEqual(bodies(store, "remit-message-mgmt"), ["move"]);
			assert.deepEqual(bodies(store, "remit-smtp-dlq"), ["send"]);
			assert.deepEqual(bodies(store, "remit-smtp"), []);
			assert.deepEqual(bodies(store, "remit-mailboxes-dlq.fifo"), ["sync"]);
		});
	});
});
