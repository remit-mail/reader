import assert from "node:assert";
import { describe, test } from "node:test";
import { enqueueSearchIndexEvents } from "./enqueue.js";
import type { IndexEvent } from "./events.js";

const createMockSQSClient = () => {
	const calls: { QueueUrl: string; Entries: unknown[] }[] = [];

	const send = async (command: { input: Record<string, unknown> }) => {
		calls.push(command.input as { QueueUrl: string; Entries: unknown[] });
	};

	return { send, calls };
};

describe("enqueueSearchIndexEvents", () => {
	test("sends events in batches of 10", async () => {
		const client = createMockSQSClient();
		const events: IndexEvent[] = Array.from({ length: 25 }, (_, i) => ({
			type: "upsert" as const,
			messageId: `msg-${i}`,
			accountId: "acc-1",
			accountConfigId: "acc-config-1",
			mailboxIds: ["inbox"],
		}));

		await enqueueSearchIndexEvents(
			client as unknown as Parameters<typeof enqueueSearchIndexEvents>[0],
			"https://sqs.us-east-1.amazonaws.com/000000000000/test",
			events,
		);

		assert.equal(client.calls.length, 3);
		assert.equal((client.calls[0].Entries as unknown[]).length, 10);
		assert.equal((client.calls[1].Entries as unknown[]).length, 10);
		assert.equal((client.calls[2].Entries as unknown[]).length, 5);
	});

	test("does nothing for empty events", async () => {
		const client = createMockSQSClient();

		await enqueueSearchIndexEvents(
			client as unknown as Parameters<typeof enqueueSearchIndexEvents>[0],
			"https://sqs.us-east-1.amazonaws.com/000000000000/test",
			[],
		);

		assert.equal(client.calls.length, 0);
	});

	test("sends single event", async () => {
		const client = createMockSQSClient();
		const event: IndexEvent = {
			type: "delete",
			messageId: "msg-1",
		};

		await enqueueSearchIndexEvents(
			client as unknown as Parameters<typeof enqueueSearchIndexEvents>[0],
			"https://sqs.us-east-1.amazonaws.com/000000000000/test",
			[event],
		);

		assert.equal(client.calls.length, 1);
		assert.equal((client.calls[0].Entries as unknown[]).length, 1);
	});

	test("serializes events as JSON in message body", async () => {
		const client = createMockSQSClient();
		const event: IndexEvent = {
			type: "upsert",
			messageId: "msg-1",
			accountId: "acc-1",
			accountConfigId: "acc-config-1",
			mailboxIds: ["inbox"],
		};

		await enqueueSearchIndexEvents(
			client as unknown as Parameters<typeof enqueueSearchIndexEvents>[0],
			"https://sqs.us-east-1.amazonaws.com/000000000000/test",
			[event],
		);

		const entries = client.calls[0].Entries as {
			Id: string;
			MessageBody: string;
		}[];
		const parsed = JSON.parse(entries[0].MessageBody);
		assert.equal(parsed.type, "upsert");
		assert.equal(parsed.messageId, "msg-1");
	});
});
