import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { resetMetrics } from "@remit/logger-lambda/metrics";
import { collectQueueDepths, queueRoles } from "./metrics.js";
import { bootstrapQueues, parseQueuesConfig } from "./queues-config.js";
import { createSidecarServer } from "./server.js";
import { QueueStore } from "./store.js";

const tmpRoot = join(
	fileURLToPath(new URL(".", import.meta.url)),
	"..",
	".tmp",
	"metrics",
);

const config = parseQueuesConfig({
	queues: [
		{
			name: "work",
			visibilityTimeoutSeconds: 30,
			deadLetter: { name: "work-dlq", maxReceiveCount: 3 },
		},
		{ name: "work-dlq", visibilityTimeoutSeconds: 30 },
	],
});

const sample = (text: string, labels: string[]): number => {
	const line = text
		.split("\n")
		.find(
			(candidate) =>
				candidate.startsWith("remit_queue_messages{") &&
				labels.every((label) => candidate.includes(label)),
		);
	assert.ok(line, `expected a sample for ${labels.join("")} in:\n${text}`);
	return Number(line.slice(line.lastIndexOf(" ") + 1));
};

describe("queue depth roles", () => {
	it("names a redrive target a dead-letter queue and everything else work", () => {
		const roles = queueRoles([
			{
				name: "work",
				fifo: false,
				visibilityTimeoutSeconds: 30,
				deadLetterTargetName: "work-dlq",
				maxReceiveCount: 3,
				contentBasedDeduplication: false,
			},
			{
				name: "work-dlq",
				fifo: false,
				visibilityTimeoutSeconds: 30,
				deadLetterTargetName: null,
				maxReceiveCount: null,
				contentBasedDeduplication: false,
			},
		]);
		assert.equal(roles.get("work"), "work");
		assert.equal(roles.get("work-dlq"), "dead_letter");
	});
});

describe("the sidecar /metrics endpoint", () => {
	let dir: string;
	let store: QueueStore;
	let server: Server;
	let port: number;

	const get = async (
		path: string,
	): Promise<{ status: number; contentType: string; body: string }> => {
		const response = await fetch(`http://127.0.0.1:${port}${path}`);
		return {
			status: response.status,
			contentType: response.headers.get("content-type") ?? "",
			body: await response.text(),
		};
	};

	before(async () => {
		mkdirSync(tmpRoot, { recursive: true });
		dir = mkdtempSync(join(tmpRoot, "run-"));
		store = new QueueStore(join(dir, "queue.db"));
		bootstrapQueues(store, config);
		server = createSidecarServer({ store });
		port = await new Promise<number>((resolve) => {
			server.listen(0, "127.0.0.1", () =>
				resolve((server.address() as AddressInfo).port),
			);
		});
	});

	after(async () => {
		await new Promise<void>((resolve) => server.close(() => resolve()));
		store.close();
		rmSync(dir, { recursive: true, force: true });
	});

	beforeEach(() => resetMetrics());

	it("reports every queue at zero on an idle stack", async () => {
		const response = await get("/metrics");
		assert.equal(response.status, 200);
		assert.match(response.contentType, /^text\/plain/);
		assert.match(response.body, /^# TYPE remit_queue_messages gauge$/m);
		assert.equal(sample(response.body, ['queue="work"', 'role="work"']), 0);
		assert.equal(
			sample(response.body, ['queue="work-dlq"', 'role="dead_letter"']),
			0,
		);
	});

	it("reports work depth and dead-letter depth separately", async () => {
		store.sendMessage({ queueName: "work", body: "a" });
		store.sendMessage({ queueName: "work", body: "b" });
		store.sendMessage({ queueName: "work-dlq", body: "poison" });
		const { body } = await get("/metrics");
		assert.equal(sample(body, ['queue="work"', 'role="work"']), 2);
		assert.equal(sample(body, ['queue="work-dlq"']), 1);
	});

	it("re-reads depth on every scrape", async () => {
		store.purgeQueue("work");
		store.purgeQueue("work-dlq");
		const { body } = await get("/metrics");
		assert.equal(sample(body, ['queue="work"', 'role="work"']), 0);
	});

	it("keeps the SQS protocol and the health route unchanged", async () => {
		assert.equal((await get("/health")).status, 200);
		const post = await fetch(`http://127.0.0.1:${port}/metrics`, {
			method: "POST",
			body: "Action=ListQueues",
		});
		assert.equal(post.status, 400);
	});

	it("counts only visible messages as depth", () => {
		store.sendMessage({ queueName: "work", body: "c" });
		store.receiveMessages({ queueName: "work", maxMessages: 1 });
		collectQueueDepths(store);
		assert.equal(
			store.getQueueAttributes("work").approximateNumberOfMessages,
			0,
		);
	});
});

describe("a store that cannot answer for any queue", () => {
	// A deployment always holds the queues queues.json declares. An empty table
	// means the sidecar is reading the wrong file, and rendering that as a series
	// with no samples is the same blindness this endpoint exists to remove: a
	// dead-letter alert written on `> 0` would never fire, behind a 200.
	it("throws rather than reporting no queues", () => {
		assert.throws(
			() =>
				collectQueueDepths({
					listQueues: () => [],
					getQueueAttributes: () => {
						throw new Error("never reached");
					},
				}),
			/holds no queues/,
		);
	});

	it("fails the scrape with a non-200 and no depth series", async () => {
		mkdirSync(tmpRoot, { recursive: true });
		const dir = mkdtempSync(join(tmpRoot, "empty-"));
		const store = new QueueStore(join(dir, "queue.db"));
		const server = createSidecarServer({ store });
		const port = await new Promise<number>((resolve) => {
			server.listen(0, "127.0.0.1", () =>
				resolve((server.address() as AddressInfo).port),
			);
		});

		const response = await fetch(`http://127.0.0.1:${port}/metrics`);
		const body = await response.text();
		assert.equal(response.status, 500);
		assert.match(body, /holds no queues/);
		assert.ok(
			!body.includes("remit_queue_messages"),
			"a failed scrape must render no depth series at all",
		);

		await new Promise<void>((resolve) => server.close(() => resolve()));
		store.close();
		rmSync(dir, { recursive: true, force: true });
	});
});
