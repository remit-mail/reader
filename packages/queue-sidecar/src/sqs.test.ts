import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
	CreateQueueCommand,
	DeleteMessageCommand,
	GetQueueAttributesCommand,
	PurgeQueueCommand,
	ReceiveMessageCommand,
	SendMessageBatchCommand,
	SendMessageCommand,
	SQSClient,
} from "@aws-sdk/client-sqs";
import { AwsQueryProtocol } from "@aws-sdk/core/protocols";
import { bootstrapQueues, parseQueuesConfig } from "./queues-config.js";
import { createSidecarServer } from "./server.js";
import { QueueStore } from "./store.js";

const tmpRoot = join(
	fileURLToPath(new URL(".", import.meta.url)),
	"..",
	".tmp",
	"sqs",
);

const config = parseQueuesConfig({
	queues: [
		{
			name: "sync.fifo",
			fifo: true,
			visibilityTimeoutSeconds: 30,
			deadLetter: { name: "sync-dlq.fifo", maxReceiveCount: 3 },
		},
		{ name: "sync-dlq.fifo", fifo: true, visibilityTimeoutSeconds: 30 },
		{
			name: "work",
			visibilityTimeoutSeconds: 1,
			deadLetter: { name: "work-dlq", maxReceiveCount: 2 },
		},
		{ name: "work-dlq", visibilityTimeoutSeconds: 30 },
	],
});

interface Harness {
	client: SQSClient;
	baseUrl: string;
	queueUrl: (name: string) => string;
	restart: () => Promise<void>;
	stop: () => Promise<void>;
	dbPath: string;
}

const listen = (server: Server, port = 0): Promise<number> =>
	new Promise((resolve) => {
		server.listen(port, "127.0.0.1", () => {
			resolve((server.address() as AddressInfo).port);
		});
	});

const startHarness = async (): Promise<Harness> => {
	mkdirSync(tmpRoot, { recursive: true });
	const dir = mkdtempSync(join(tmpRoot, "sqs-"));
	const dbPath = join(dir, "queue.db");

	let store = new QueueStore(dbPath);
	bootstrapQueues(store, config);
	let server = createSidecarServer({ store, longPollIntervalMs: 25 });
	let port = await listen(server);

	const baseUrl = () => `http://127.0.0.1:${port}`;
	const client = new SQSClient({
		endpoint: baseUrl(),
		protocol: AwsQueryProtocol,
		region: "local",
		credentials: { accessKeyId: "local", secretAccessKey: "local" },
		maxAttempts: 3,
	});

	const closeServer = (): Promise<void> =>
		new Promise((resolve) => server.close(() => resolve()));

	return {
		client,
		get baseUrl() {
			return baseUrl();
		},
		queueUrl: (name) => `${baseUrl()}/000000000000/${name}`,
		restart: async () => {
			await closeServer();
			store.close();
			store = new QueueStore(dbPath);
			server = createSidecarServer({ store, longPollIntervalMs: 25 });
			port = await listen(server, port);
		},
		stop: async () => {
			await closeServer();
			store.close();
		},
		dbPath,
	};
};

describe("SQS wire protocol via the AWS SDK", () => {
	let h: Harness;

	before(async () => {
		h = await startHarness();
	});

	after(async () => {
		await h.stop();
		rmSync(tmpRoot, { recursive: true, force: true });
	});

	it("creates a queue and returns its URL", async () => {
		const result = await h.client.send(
			new CreateQueueCommand({
				QueueName: "sync.fifo",
				Attributes: { FifoQueue: "true" },
			}),
		);
		assert.equal(result.QueueUrl, h.queueUrl("sync.fifo"));
	});

	it("sends and receives a message through the SDK", async () => {
		const url = h.queueUrl("sync.fifo");
		const sent = await h.client.send(
			new SendMessageCommand({
				QueueUrl: url,
				MessageBody: "hello world",
				MessageGroupId: "g-send",
				MessageDeduplicationId: "d-send",
			}),
		);
		assert.ok(sent.MessageId);
		assert.equal(sent.MD5OfMessageBody, "5eb63bbbe01eeed093cb22bb8f5acdc3");

		const received = await h.client.send(
			new ReceiveMessageCommand({
				QueueUrl: url,
				MaxNumberOfMessages: 10,
				WaitTimeSeconds: 2,
			}),
		);
		assert.equal(received.Messages?.length, 1);
		assert.equal(received.Messages?.[0].Body, "hello world");

		await h.client.send(
			new DeleteMessageCommand({
				QueueUrl: url,
				ReceiptHandle: received.Messages?.[0].ReceiptHandle,
			}),
		);
	});

	it("preserves FIFO order within a message group", async () => {
		const url = h.queueUrl("sync.fifo");
		await h.client.send(new PurgeQueueCommand({ QueueUrl: url }));
		for (const body of ["one", "two", "three"]) {
			await h.client.send(
				new SendMessageCommand({
					QueueUrl: url,
					MessageBody: body,
					MessageGroupId: "ordered",
					MessageDeduplicationId: `order-${body}`,
				}),
			);
		}

		const bodies: string[] = [];
		for (let i = 0; i < 3; i += 1) {
			const received = await h.client.send(
				new ReceiveMessageCommand({
					QueueUrl: url,
					MaxNumberOfMessages: 10,
					WaitTimeSeconds: 2,
				}),
			);
			assert.equal(received.Messages?.length, 1);
			const message = received.Messages?.[0];
			if (!message?.Body || !message.ReceiptHandle)
				throw new Error("no message");
			bodies.push(message.Body);
			await h.client.send(
				new DeleteMessageCommand({
					QueueUrl: url,
					ReceiptHandle: message.ReceiptHandle,
				}),
			);
		}
		assert.deepEqual(bodies, ["one", "two", "three"]);
	});

	it("sends a batch and reports per-entry ids", async () => {
		const url = h.queueUrl("sync.fifo");
		await h.client.send(new PurgeQueueCommand({ QueueUrl: url }));
		const result = await h.client.send(
			new SendMessageBatchCommand({
				QueueUrl: url,
				Entries: [
					{
						Id: "a",
						MessageBody: "batch-a",
						MessageGroupId: "batch",
						MessageDeduplicationId: "batch-a",
					},
					{
						Id: "b",
						MessageBody: "batch-b",
						MessageGroupId: "batch",
						MessageDeduplicationId: "batch-b",
					},
				],
			}),
		);
		assert.equal(result.Successful?.length, 2);
		assert.deepEqual(result.Successful?.map((e) => e.Id).sort(), ["a", "b"]);
	});

	it("redelivers after the visibility timeout and reports the receive count", async () => {
		const url = h.queueUrl("work");
		await h.client.send(new PurgeQueueCommand({ QueueUrl: url }));
		await h.client.send(
			new SendMessageCommand({ QueueUrl: url, MessageBody: "retry-me" }),
		);

		const first = await h.client.send(
			new ReceiveMessageCommand({
				QueueUrl: url,
				MaxNumberOfMessages: 1,
				WaitTimeSeconds: 2,
				MessageSystemAttributeNames: ["ApproximateReceiveCount"],
			}),
		);
		assert.equal(first.Messages?.length, 1);
		assert.equal(first.Messages?.[0].Attributes?.ApproximateReceiveCount, "1");

		await delay(1500);

		const second = await h.client.send(
			new ReceiveMessageCommand({
				QueueUrl: url,
				MaxNumberOfMessages: 1,
				WaitTimeSeconds: 2,
				MessageSystemAttributeNames: ["ApproximateReceiveCount"],
			}),
		);
		assert.equal(second.Messages?.length, 1);
		assert.equal(second.Messages?.[0].Attributes?.ApproximateReceiveCount, "2");
		assert.equal(second.Messages?.[0].Body, "retry-me");
	});

	it("redrives a poison message to the DLQ after maxReceiveCount", async () => {
		const url = h.queueUrl("work");
		const dlqUrl = h.queueUrl("work-dlq");
		await h.client.send(new PurgeQueueCommand({ QueueUrl: url }));
		await h.client.send(new PurgeQueueCommand({ QueueUrl: dlqUrl }));
		await h.client.send(
			new SendMessageCommand({ QueueUrl: url, MessageBody: "poison" }),
		);

		for (let attempt = 1; attempt <= 2; attempt += 1) {
			const received = await h.client.send(
				new ReceiveMessageCommand({
					QueueUrl: url,
					MaxNumberOfMessages: 1,
					WaitTimeSeconds: 2,
				}),
			);
			assert.equal(received.Messages?.length, 1, `delivery ${attempt}`);
			await delay(1200);
		}

		const drained = await h.client.send(
			new ReceiveMessageCommand({
				QueueUrl: url,
				MaxNumberOfMessages: 1,
				WaitTimeSeconds: 1,
			}),
		);
		assert.equal(drained.Messages?.length ?? 0, 0, "source queue is empty");

		const dlq = await h.client.send(
			new ReceiveMessageCommand({
				QueueUrl: dlqUrl,
				MaxNumberOfMessages: 1,
				WaitTimeSeconds: 2,
			}),
		);
		assert.equal(dlq.Messages?.length, 1);
		assert.equal(dlq.Messages?.[0].Body, "poison");
	});

	it("reports queue attributes for DLQ depth monitoring", async () => {
		const url = h.queueUrl("sync.fifo");
		await h.client.send(new PurgeQueueCommand({ QueueUrl: url }));
		await h.client.send(
			new SendMessageCommand({
				QueueUrl: url,
				MessageBody: "depth",
				MessageGroupId: "g",
				MessageDeduplicationId: "depth-1",
			}),
		);
		const attributes = await h.client.send(
			new GetQueueAttributesCommand({
				QueueUrl: url,
				AttributeNames: ["All"],
			}),
		);
		assert.equal(attributes.Attributes?.ApproximateNumberOfMessages, "1");
		assert.equal(attributes.Attributes?.FifoQueue, "true");
	});

	it("keeps enqueued messages across a sidecar restart", async () => {
		const url = h.queueUrl("sync.fifo");
		await h.client.send(new PurgeQueueCommand({ QueueUrl: url }));
		await h.client.send(
			new SendMessageCommand({
				QueueUrl: url,
				MessageBody: "survive-restart",
				MessageGroupId: "durable",
				MessageDeduplicationId: "durable-1",
			}),
		);

		await h.restart();

		const received = await h.client.send(
			new ReceiveMessageCommand({
				QueueUrl: url,
				MaxNumberOfMessages: 10,
				WaitTimeSeconds: 2,
			}),
		);
		assert.equal(received.Messages?.length, 1);
		assert.equal(received.Messages?.[0].Body, "survive-restart");
	});
});

const delay = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms));
