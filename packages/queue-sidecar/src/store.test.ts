import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { bootstrapQueues, parseQueuesConfig } from "./queues-config.js";
import {
	InvalidParameterValueError,
	MissingParameterError,
	QueueStore,
} from "./store.js";

const tmpRoot = join(
	fileURLToPath(new URL(".", import.meta.url)),
	"..",
	".tmp",
	"store",
);

const makeTempDir = (): string => {
	mkdirSync(tmpRoot, { recursive: true });
	return mkdtempSync(join(tmpRoot, "store-"));
};

const config = parseQueuesConfig({
	queues: [
		{
			name: "orders.fifo",
			fifo: true,
			visibilityTimeoutSeconds: 30,
			deadLetter: { name: "orders-dlq.fifo", maxReceiveCount: 3 },
		},
		{ name: "orders-dlq.fifo", fifo: true, visibilityTimeoutSeconds: 30 },
		{
			name: "jobs",
			visibilityTimeoutSeconds: 30,
			deadLetter: { name: "jobs-dlq", maxReceiveCount: 2 },
		},
		{ name: "jobs-dlq", visibilityTimeoutSeconds: 30 },
	],
});

describe("QueueStore", () => {
	let dir: string;
	let store: QueueStore;

	beforeEach(() => {
		dir = makeTempDir();
		store = new QueueStore(join(dir, "queue.db"));
		bootstrapQueues(store, config);
	});

	after(() => {
		rmSync(tmpRoot, { recursive: true, force: true });
	});

	it("round-trips a standard message and computes its md5", () => {
		const sent = store.sendMessage({ queueName: "jobs", body: "hello" });
		assert.equal(sent.md5OfBody, "5d41402abc4b2a76b9719d911017c592");

		const received = store.receiveMessages({
			queueName: "jobs",
			maxMessages: 10,
		});
		assert.equal(received.length, 1);
		assert.equal(received[0].body, "hello");
		assert.equal(received[0].receiveCount, 1);

		store.deleteMessage("jobs", received[0].receiptHandle);
		assert.equal(
			store.receiveMessages({ queueName: "jobs", maxMessages: 10 }).length,
			0,
		);
	});

	it("rejects a FIFO send with no MessageGroupId", () => {
		assert.throws(
			() =>
				store.sendMessage({
					queueName: "orders.fifo",
					body: "x",
					deduplicationId: "d",
				}),
			MissingParameterError,
		);
	});

	it("rejects a FIFO send with neither a dedup id nor content-based dedup", () => {
		assert.throws(
			() =>
				store.sendMessage({
					queueName: "orders.fifo",
					body: "x",
					groupId: "g1",
				}),
			InvalidParameterValueError,
		);
	});

	it("delivers FIFO messages in send order within a group", () => {
		const now = 1_000;
		for (const body of ["a", "b", "c"]) {
			store.sendMessage({
				queueName: "orders.fifo",
				body,
				groupId: "g1",
				deduplicationId: body,
				now,
			});
		}

		const bodies: string[] = [];
		for (let i = 0; i < 3; i += 1) {
			const [message] = store.receiveMessages({
				queueName: "orders.fifo",
				maxMessages: 10,
				visibilityTimeoutSeconds: 30,
				now,
			});
			assert.ok(message, "a message is available");
			bodies.push(message.body);
			store.deleteMessage("orders.fifo", message.receiptHandle);
		}
		assert.deepEqual(bodies, ["a", "b", "c"]);
	});

	it("locks a FIFO group while a message is in flight", () => {
		const now = 1_000;
		store.sendMessage({
			queueName: "orders.fifo",
			body: "a",
			groupId: "g1",
			deduplicationId: "a",
			now,
		});
		store.sendMessage({
			queueName: "orders.fifo",
			body: "b",
			groupId: "g1",
			deduplicationId: "b",
			now,
		});

		const first = store.receiveMessages({
			queueName: "orders.fifo",
			maxMessages: 10,
			visibilityTimeoutSeconds: 30,
			now,
		});
		assert.equal(first.length, 1);
		assert.equal(first[0].body, "a");

		const blocked = store.receiveMessages({
			queueName: "orders.fifo",
			maxMessages: 10,
			visibilityTimeoutSeconds: 30,
			now,
		});
		assert.equal(
			blocked.length,
			0,
			"group is locked until the first is deleted",
		);

		store.deleteMessage("orders.fifo", first[0].receiptHandle);
		const next = store.receiveMessages({
			queueName: "orders.fifo",
			maxMessages: 10,
			visibilityTimeoutSeconds: 30,
			now,
		});
		assert.equal(next[0].body, "b");
	});

	it("parallelises distinct FIFO groups", () => {
		const now = 1_000;
		store.sendMessage({
			queueName: "orders.fifo",
			body: "g1-a",
			groupId: "g1",
			deduplicationId: "g1-a",
			now,
		});
		store.sendMessage({
			queueName: "orders.fifo",
			body: "g2-a",
			groupId: "g2",
			deduplicationId: "g2-a",
			now,
		});
		const received = store.receiveMessages({
			queueName: "orders.fifo",
			maxMessages: 10,
			visibilityTimeoutSeconds: 30,
			now,
		});
		assert.deepEqual(received.map((m) => m.body).sort(), ["g1-a", "g2-a"]);
	});

	it("deduplicates FIFO sends inside the dedup window", () => {
		const now = 1_000;
		const first = store.sendMessage({
			queueName: "orders.fifo",
			body: "a",
			groupId: "g1",
			deduplicationId: "dup",
			now,
		});
		const second = store.sendMessage({
			queueName: "orders.fifo",
			body: "a-again",
			groupId: "g1",
			deduplicationId: "dup",
			now: now + 1000,
		});
		assert.equal(second.deduplicated, true);
		assert.equal(second.messageId, first.messageId);

		const received = store.receiveMessages({
			queueName: "orders.fifo",
			maxMessages: 10,
			now,
		});
		assert.equal(received.length, 1);
		assert.equal(received[0].body, "a");
	});

	it("redelivers a message after its visibility timeout expires", () => {
		const now = 1_000;
		store.sendMessage({ queueName: "jobs", body: "x", now });

		const first = store.receiveMessages({
			queueName: "jobs",
			maxMessages: 10,
			visibilityTimeoutSeconds: 5,
			now,
		});
		assert.equal(first.length, 1);

		const stillHidden = store.receiveMessages({
			queueName: "jobs",
			maxMessages: 10,
			now: now + 4_000,
		});
		assert.equal(stillHidden.length, 0);

		const redelivered = store.receiveMessages({
			queueName: "jobs",
			maxMessages: 10,
			now: now + 6_000,
		});
		assert.equal(redelivered.length, 1);
		assert.equal(redelivered[0].receiveCount, 2);
	});

	it("moves a message to the DLQ after maxReceiveCount deliveries", () => {
		let now = 1_000;
		store.sendMessage({ queueName: "jobs", body: "poison", now });

		for (let attempt = 1; attempt <= 2; attempt += 1) {
			const received = store.receiveMessages({
				queueName: "jobs",
				maxMessages: 10,
				visibilityTimeoutSeconds: 1,
				now,
			});
			assert.equal(received.length, 1, `delivery ${attempt}`);
			assert.equal(received[0].receiveCount, attempt);
			now += 2_000;
		}

		const afterMax = store.receiveMessages({
			queueName: "jobs",
			maxMessages: 10,
			now,
		});
		assert.equal(afterMax.length, 0, "source queue is drained");

		const dlq = store.receiveMessages({
			queueName: "jobs-dlq",
			maxMessages: 10,
			now,
		});
		assert.equal(dlq.length, 1);
		assert.equal(dlq[0].body, "poison");
		assert.equal(dlq[0].receiveCount, 1, "receive count resets in the DLQ");
	});

	it("persists enqueued messages across a store restart", () => {
		const path = join(dir, "durable.db");
		const first = new QueueStore(path);
		bootstrapQueues(first, config);
		first.sendMessage({
			queueName: "orders.fifo",
			body: "durable",
			groupId: "g1",
			deduplicationId: "d1",
		});
		first.close();

		const reopened = new QueueStore(path);
		const received = reopened.receiveMessages({
			queueName: "orders.fifo",
			maxMessages: 10,
		});
		assert.equal(received.length, 1);
		assert.equal(received[0].body, "durable");
		reopened.close();
	});

	it("purges all messages from a queue", () => {
		store.sendMessage({ queueName: "jobs", body: "1" });
		store.sendMessage({ queueName: "jobs", body: "2" });
		store.purgeQueue("jobs");
		assert.equal(
			store.receiveMessages({ queueName: "jobs", maxMessages: 10 }).length,
			0,
		);
	});
});
