import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import type { MailboxItem } from "@remit/data-ports";
import {
	FilterClauseField,
	FilterScope,
	MailboxCursorState,
	MessageStatus,
} from "@remit/domain-enums";
import { isMessageBodySyncBroken } from "@remit/mailbox-service";
import { mockClient } from "aws-sdk-client-mock";
import { resetBodySyncGateCache } from "../body-sync-gate.js";
import type { SyncMessageBodyEvent } from "../events.js";
import {
	openStore,
	type SeededMessage,
	type World,
} from "../test-helpers/test-world.js";
import {
	BODY_SYNC_MAX_ATTEMPTS,
	syncMessageBody,
} from "./sync-message-body.js";

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
		a.w.imap.setUidValidity("INBOX", 2);

		await run(a);

		assert.deepEqual(bodyFetches(a), []);
		assert.equal(
			(await a.w.row(a.message.messageId))?.bodyStorageKey,
			undefined,
		);
	});
});

const batchOf = (
	w: World,
	inbox: MailboxItem,
	messages: SeededMessage[],
): SyncMessageBodyEvent => ({
	type: "SYNC_MESSAGE_BODY",
	eventId: `evt-${messages.map((m) => m.messageId).join("-")}`,
	timestamp: Date.now(),
	accountId: w.account.accountId,
	mailboxId: inbox.mailboxId,
	messageIds: messages.map((m) => m.messageId),
	messages: messages.map((m) => ({ messageId: m.messageId, uid: m.uid })),
});

const runBatch = (w: World, event: SyncMessageBodyEvent, receiveCount = 1) =>
	syncMessageBody(event, w.log, receiveCount, w.scope);

const arrangeFiling = async () => {
	const w = await store.world();
	const inbox = await w.folder("INBOX");
	const travel = await w.folder("Travel");
	await w.client.filter.create({
		accountConfigId: w.account.accountConfigId,
		name: "From a friend",
		scope: FilterScope.Standing,
		literalClauses: [
			{ field: FilterClauseField.From, value: "friend@example.com" },
		],
		actionMailboxId: travel.mailboxId,
	});
	const first = await w.message(inbox);
	const second = await w.message(inbox);
	return {
		w,
		travel,
		first,
		second,
		event: batchOf(w, inbox, [first, second]),
	};
};

describe("a body batch whose filter files mail while the queue is refusing", () => {
	it("fails at the first filing it cannot enqueue and leaves the rest untouched", async () => {
		const { w, first, second, event } = await arrangeFiling();
		w.refuseSends(new Error("connect ECONNREFUSED 127.0.0.1:9324"));

		await assert.rejects(runBatch(w, event), /ECONNREFUSED/);

		const untouched = await w.row(second.messageId);
		assert.equal(untouched?.status, MessageStatus.active);
		assert.equal(untouched?.bodyStorageKey, undefined);
		assert.equal(await w.client.placementMove.find(second.messageId), null);
		assert.equal(
			(await w.client.placementMove.find(first.messageId))?.state,
			"pending",
		);
	});

	it("files and stores the whole batch on the redelivery once the queue accepts", async () => {
		const { w, travel, first, second, event } = await arrangeFiling();
		w.refuseSends(new Error("connect ECONNREFUSED 127.0.0.1:9324"));
		await assert.rejects(runBatch(w, event), /ECONNREFUSED/);

		w.refuseSends(undefined);
		await runBatch(w, event, 2);

		for (const message of [first, second]) {
			const row = await w.row(message.messageId);
			assert.equal(row?.mailboxId, travel.mailboxId);
			assert.ok(row?.bodyStorageKey, `${message.messageId} body stored`);
			assert.equal(row?.movedByRemit, true);
			assert.equal(row?.filterMove?.sourceMailboxId, event.mailboxId);
			assert.equal(
				(await w.client.placementMove.find(message.messageId))?.state,
				"queued",
			);
		}
	});
});

describe("a body batch on its last attempt while the queue is refusing", () => {
	it("throws, so the batch dead-letters instead of its messages being marked broken", async () => {
		const { w, first: message, event } = await arrangeFiling();
		w.refuseSends(new Error("connect ECONNREFUSED 127.0.0.1:9324"));

		await assert.rejects(
			runBatch(w, event, BODY_SYNC_MAX_ATTEMPTS),
			/ECONNREFUSED/,
		);

		assert.equal(
			await isMessageBodySyncBroken(
				w.client.storage,
				w.account.accountConfigId,
				w.account.accountId,
				message.messageId,
			),
			false,
		);
	});
});

const startMove = (
	w: World,
	message: SeededMessage,
	from: MailboxItem,
	to: MailboxItem,
) =>
	w.client.message.transitionPlacement(
		message.messageId,
		{
			status: MessageStatus.active,
			mailboxId: from.mailboxId,
			uid: message.uid,
		},
		{
			mailboxId: to.mailboxId,
			status: MessageStatus.moving,
			originalMailboxId: from.mailboxId,
			originalUid: message.uid,
		},
	);

describe("a body batch that has gone stale", () => {
	it("does not fetch a message from a folder its confirmed move took it out of", async () => {
		const w = await store.world();
		const inbox = await w.folder("INBOX");
		const travel = await w.folder("Travel");
		const moved = await w.message(inbox);
		const neighbour = await w.message(inbox);
		await startMove(w, moved, inbox, travel);
		await w.client.message.updateUid(
			moved.messageId,
			neighbour.uid,
			travel.mailboxId,
		);

		await runBatch(w, batchOf(w, inbox, [moved]));

		assert.deepEqual(w.imap.commands("BODY"), []);
		assert.equal((await w.row(moved.messageId))?.bodyStorageKey, undefined);
	});

	it("fetches a message whose move has not confirmed from the folder its uid is in", async () => {
		const w = await store.world();
		const inbox = await w.folder("INBOX");
		const travel = await w.folder("Travel");
		const filing = await w.message(inbox);
		await startMove(w, filing, inbox, travel);

		await runBatch(w, batchOf(w, inbox, [filing]));

		assert.equal(w.imap.commands("BODY").length, 1);
		assert.ok((await w.row(filing.messageId))?.bodyStorageKey);
	});

	it("acks a batch whose message row has been deleted since", async () => {
		const w = await store.world();
		const inbox = await w.folder("INBOX");
		const gone = await w.message(inbox);
		await w.client.message.delete(gone.messageId);

		await runBatch(w, batchOf(w, inbox, [gone]));

		assert.equal(w.imap.connections, 0);
	});
});
