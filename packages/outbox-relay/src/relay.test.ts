import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { SendMessageCommand } from "@aws-sdk/client-sqs";
import { searchIndexMessageSchema } from "@remit/search-service";
import type { PendingIndexEvent } from "./events.js";
import { OutboxRelay, type OutboxStore } from "./relay.js";

// The shared drain (RFC 036 D2): capture the pending row ids, send to SQS, then
// mark exactly those ids drained. A store stub stands in for either backend's
// row access; only ordering and the SQS payload are under test here.

interface SentBody {
	messageId: string;
	eventName: string;
	force?: boolean;
}

class FakeStore implements OutboxStore {
	marked: string[] = [];
	private readonly captured: string[] = [];
	constructor(private readonly pending: PendingIndexEvent[]) {}

	async listUnprocessedEvents(): Promise<PendingIndexEvent[]> {
		return this.pending;
	}
	async listPendingRowIds(messageId: string, event: string): Promise<string[]> {
		const id = `${messageId}:${event}`;
		this.captured.push(id);
		return [id];
	}
	async markRowsProcessed(ids: string[]): Promise<void> {
		this.marked.push(...ids);
	}
}

const fakeSqs = (sent: SentBody[]) =>
	({
		send: async (cmd: SendMessageCommand) => {
			const body = JSON.parse(
				(cmd as SendMessageCommand).input.MessageBody ?? "{}",
			);
			const parsed = searchIndexMessageSchema.parse(body);
			sent.push({
				messageId: parsed.messageId,
				eventName: parsed.eventName,
				force: parsed.force,
			});
			return {};
		},
	}) as unknown as ConstructorParameters<typeof OutboxRelay>[0]["sqs"];

describe("OutboxRelay", () => {
	test("relays a body-synced event and drains its row", async () => {
		const store = new FakeStore([]);
		const sent: SentBody[] = [];
		const relay = new OutboxRelay({
			store,
			sqs: fakeSqs(sent),
			queueUrl: "q",
		});

		await relay.enqueue("m1", { force: false, remove: false });

		assert.deepEqual(sent, [
			{ messageId: "m1", eventName: "INSERT", force: undefined },
		]);
		assert.deepEqual(store.marked, ["m1:message.body_synced"]);
	});

	test("a move carries force; a removal relays REMOVE", async () => {
		const store = new FakeStore([]);
		const sent: SentBody[] = [];
		const relay = new OutboxRelay({ store, sqs: fakeSqs(sent), queueUrl: "q" });

		await relay.enqueue("m2", { force: true, remove: false });
		await relay.enqueue("m3", { force: false, remove: true });

		assert.equal(sent[0]?.force, true);
		assert.equal(sent[1]?.eventName, "REMOVE");
		assert.deepEqual(store.marked, ["m2:message.moved", "m3:message.removed"]);
	});

	test("drainPending relays every undrained event", async () => {
		const store = new FakeStore([
			{
				messageId: "a",
				event: "message.body_synced",
				force: false,
				remove: false,
			},
			{ messageId: "b", event: "message.moved", force: true, remove: false },
		]);
		const sent: SentBody[] = [];
		const relay = new OutboxRelay({ store, sqs: fakeSqs(sent), queueUrl: "q" });

		const count = await relay.drainPending();

		assert.equal(count, 2);
		assert.deepEqual(
			sent.map((s) => s.messageId),
			["a", "b"],
		);
		assert.equal(store.marked.length, 2);
	});
});
