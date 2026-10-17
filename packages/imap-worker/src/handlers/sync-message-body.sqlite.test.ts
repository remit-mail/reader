import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import type { MailboxItem } from "@remit/data-ports";
import { MailboxCursorState } from "@remit/domain-enums";
import { mockClient } from "aws-sdk-client-mock";
import { resetBodySyncGateCache } from "../body-sync-gate.js";
import type { SyncMessageBodyEvent } from "../events.js";
import {
	openStore,
	type SeededMessage,
	type World,
} from "../test-helpers/test-world.js";
import { syncMessageBody } from "./sync-message-body.js";

const ssm = mockClient(SSMClient);

let store: Awaited<ReturnType<typeof openStore>>;

before(async () => {
	store = await openStore();
});

after(() => store.close());

const bodySync = (enabled: boolean) =>
	ssm
		.on(GetParameterCommand)
		.resolves({ Parameter: { Value: enabled ? "true" : "false" } });

beforeEach(() => {
	ssm.reset();
	resetBodySyncGateCache();
	bodySync(true);
});

afterEach(() => resetBodySyncGateCache());

interface Arranged {
	w: World;
	inbox: MailboxItem;
	message: SeededMessage;
	event: SyncMessageBodyEvent;
}

const arrange = async (): Promise<Arranged> => {
	const w = await store.world();
	const inbox = await w.folder("INBOX");
	const message = await w.message(inbox);
	return {
		w,
		inbox,
		message,
		event: {
			type: "SYNC_MESSAGE_BODY",
			eventId: `evt-${message.messageId}`,
			timestamp: Date.now(),
			accountId: w.account.accountId,
			mailboxId: inbox.mailboxId,
			messageIds: [message.messageId],
			messages: [{ messageId: message.messageId, uid: message.uid }],
		},
	};
};

const run = (a: Arranged, receiveCount = 1) =>
	syncMessageBody(a.event, a.w.log, receiveCount, a.w.scope);

const bodyFetches = (a: Arranged): string[] => a.w.imap.commands("BODY");

describe("a body sync", () => {
	it("fetches the body and stores it against the message", async () => {
		const a = await arrange();

		await run(a);

		assert.equal(bodyFetches(a).length, 1);
		assert.ok((await a.w.row(a.message.messageId))?.bodyStorageKey);
	});

	// Issue #1270: swallowing the failure into a fresh enqueue meant the queue's
	// own redelivery and dead-letter queue never engaged.
	it("throws within the budget when the server cannot return the body, so the queue redelivers", async () => {
		const a = await arrange();
		a.w.imap.failNext.BODY = new Error("Connection reset");

		await assert.rejects(run(a), /Connection reset/);

		assert.equal(
			(await a.w.row(a.message.messageId))?.bodyStorageKey,
			undefined,
		);
	});

	it("fetches nothing while body sync is paused", async () => {
		const a = await arrange();
		ssm.reset();
		bodySync(false);

		await run(a);

		assert.equal(a.w.imap.connections, 0);
	});

	it("acks without connecting when the mailbox was deleted", async () => {
		const a = await arrange();
		await a.w.client.mailbox.delete(a.w.account.accountId, a.inbox.mailboxId);

		await run(a);

		assert.equal(a.w.imap.connections, 0);
	});

	it("fetches nothing while the cursor is rebuilding", async () => {
		const a = await arrange();
		await a.w.client.mailbox.update(a.w.account.accountId, a.inbox.mailboxId, {
			cursorState: MailboxCursorState.rebuilding,
		});

		await run(a);

		assert.equal(a.w.imap.connections, 0);
	});

	it("fetches nothing when the mailbox's UIDVALIDITY changed under it", async () => {
		const a = await arrange();
		a.w.imap.folder("INBOX").uidValidity = 2;

		await run(a);

		assert.deepEqual(bodyFetches(a), []);
		assert.equal(
			(await a.w.row(a.message.messageId))?.bodyStorageKey,
			undefined,
		);
	});
});
