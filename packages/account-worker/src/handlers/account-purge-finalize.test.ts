import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RemitClient } from "@remit/backend/client";
import { recordingQueue } from "@remit/data-ports/recording-queue";
import type { CascadeEntity } from "../cascade.js";
import type { DeletionCapabilities } from "../deletion-port.js";
import { processAccountPurgeEvent } from "../process.js";

const notFound = (): Error =>
	Object.assign(new Error("gone"), { name: "NotFoundError" });

const messageDescription = {
	messageFlag: [{ messageFlagId: "flag-1" }],
	envelope: [{ envelopeId: "env-1" }],
	messageReference: [],
	envelopeAddress: [],
	bodyPart: [],
	bodyPartParameter: [],
	rawMessageStorage: [],
	bodyPartStorage: [],
};

const fakeClient = (accountGone = false): RemitClient =>
	({
		account: {
			describe: async () => {
				if (accountGone) throw notFound();
				return { mailbox: [{ mailboxId: "mbx-1" }] };
			},
		},
		message: {
			describe: async (messageId: string) => {
				if (messageId === "msg-gone") throw notFound();
				return messageDescription;
			},
		},
		outboxMessage: {
			listByAccount: async () => ({ items: [{ outboxMessageId: "out-1" }] }),
		},
		mailboxLock: {
			listByAccount: async () => [
				{ mailboxId: "mbx-1", eventName: "SYNC_MESSAGES" },
			],
		},
	}) as unknown as RemitClient;

interface Recorded {
	readonly capabilities: DeletionCapabilities;
	readonly deleted: CascadeEntity[];
	readonly prefixes: string[];
	readonly invalidated: string[];
}

const recordingCapabilities = (): Recorded => {
	const deleted: CascadeEntity[] = [];
	const prefixes: string[] = [];
	const invalidated: string[] = [];
	return {
		deleted,
		prefixes,
		invalidated,
		capabilities: {
			assertReady: async () => {},
			signOut: async () => {},
			invalidateContent: async (prefix) => {
				invalidated.push(prefix);
			},
			deleteStoragePrefix: async (prefix) => {
				prefixes.push(prefix);
			},
			cascadeDelete: async (entities) => {
				deleted.push(...entities);
			},
		},
	};
};

const typesOf = (entities: CascadeEntity[]): string[] =>
	entities.map((entity) => entity.entityType);

describe("processAccountPurgeEvent", () => {
	it("deletes each message subtree and the manifest row of a message already gone", async () => {
		const recorded = recordingCapabilities();
		await processAccountPurgeEvent(
			{
				type: "FinalizeAccountDataPurge",
				kind: "subtrees",
				accountId: "acc-1",
				accountConfigId: "cfg-1",
				items: [
					{ threadMessageId: "tm-1", messageId: "msg-1" },
					{ threadMessageId: "tm-2", messageId: "msg-gone" },
				],
			},
			{
				client: fakeClient(),
				purgeQueue: recordingQueue().grouped,
				capabilities: recorded.capabilities,
			},
		);

		assert.deepEqual(typesOf(recorded.deleted), [
			"ThreadMessage",
			"Message",
			"MessageFlag",
			"Envelope",
			"ThreadMessage",
		]);
	});

	it("deletes the account's mailboxes, outbox and locks, then its stored objects", async () => {
		const recorded = recordingCapabilities();
		await processAccountPurgeEvent(
			{
				type: "FinalizeAccountDataPurge",
				kind: "container",
				accountId: "acc-1",
				accountConfigId: "cfg-1",
			},
			{
				client: fakeClient(),
				purgeQueue: recordingQueue().grouped,
				capabilities: recorded.capabilities,
			},
		);

		assert.deepEqual(typesOf(recorded.deleted), [
			"Mailbox",
			"OutboxMessage",
			"MailboxLock",
		]);
		assert.deepEqual(recorded.invalidated, ["cfg-1/acc-1"]);
		assert.deepEqual(recorded.prefixes, ["accounts/cfg-1/acc-1/"]);
	});

	it("does nothing for a container whose account row is gone", async () => {
		const recorded = recordingCapabilities();
		await processAccountPurgeEvent(
			{
				type: "FinalizeAccountDataPurge",
				kind: "container",
				accountId: "acc-1",
				accountConfigId: "cfg-1",
			},
			{
				client: fakeClient(true),
				purgeQueue: recordingQueue().grouped,
				capabilities: recorded.capabilities,
			},
		);

		assert.deepEqual(recorded.deleted, []);
		assert.deepEqual(recorded.prefixes, []);
	});
});
