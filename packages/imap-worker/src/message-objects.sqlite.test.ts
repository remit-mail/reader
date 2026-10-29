import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { MailboxSpecialUse } from "@remit/domain-enums";
import type { WorkerEvent } from "./events.js";
import { processEvent } from "./processor.js";
import {
	openStore,
	type SeededMessage,
	type World,
} from "./test-helpers/test-world.js";

let store: Awaited<ReturnType<typeof openStore>>;

before(async () => {
	store = await openStore();
});

after(() => store.close());

const storeBody = async (w: World, message: SeededMessage): Promise<void> => {
	const { accountConfigId, accountId } = w.account;
	const { messageId } = message;
	const body = await w.client.storage.storeMessageBody({
		accountConfigId,
		accountId,
		messageId,
		content: Buffer.from(`Message-ID: ${message.messageIdHeader}\r\n\r\nhi`),
	});
	await w.client.storage.storeParsedBody({
		accountConfigId,
		accountId,
		messageId,
		parsed: { text: "hi", html: null, attachments: [] },
	});
	await w.client.storage.storeBodyPart({
		accountConfigId,
		accountId,
		messageId,
		partPath: "1",
		content: Buffer.from("hi"),
	});
	await w.client.message.update(messageId, { bodyStorageKey: body.uri });
};

const stored = async (w: World, message: SeededMessage) => {
	const { accountConfigId, accountId } = w.account;
	const { messageId } = message;
	const { storage } = w.client;
	return {
		body: await storage.retrieveMessageBody(
			accountConfigId,
			accountId,
			messageId,
		),
		parsed: await storage.retrieveParsedBody(
			accountConfigId,
			accountId,
			messageId,
		),
		part: await storage.retrieveBodyPart(
			accountConfigId,
			accountId,
			messageId,
			"1",
		),
	};
};

const assertGone = async (w: World, message: SeededMessage): Promise<void> => {
	assert.equal(await w.row(message.messageId), undefined);
	assert.deepEqual(await stored(w, message), {
		body: null,
		parsed: null,
		part: null,
	});
};

const assertKept = async (w: World, message: SeededMessage): Promise<void> => {
	const objects = await stored(w, message);
	assert.ok(objects.body);
	assert.ok(objects.parsed);
	assert.ok(objects.part);
};

const isEventOf =
	<T extends WorkerEvent["type"]>(type: T) =>
	(body: unknown): body is Extract<WorkerEvent, { type: T }> =>
		typeof body === "object" &&
		body !== null &&
		"type" in body &&
		body.type === type;

const queuedEvent = <T extends WorkerEvent["type"]>(
	w: World,
	type: T,
): Extract<WorkerEvent, { type: T }> => {
	const bodies: unknown[] = w.queued();
	const event = bodies.filter(isEventOf(type)).at(-1);
	assert.ok(event, `a ${type} was enqueued`);
	return event;
};

const run = (w: World, event: WorkerEvent) => processEvent(event, w.ctx(), 1);

describe("removing a message's last row removes its stored objects", () => {
	it("a permanent delete removes the body, parsed body and parts", async () => {
		const w = await store.world();
		const inbox = await w.folder("INBOX");
		const deleted = await w.message(inbox);
		const kept = await w.message(inbox);
		await storeBody(w, deleted);
		await storeBody(w, kept);
		await w.client.messageMove.deleteMessage(
			w.account.accountConfigId,
			deleted.messageId,
			w.account.accountId,
			{ permanent: true },
		);
		const event = queuedEvent(w, "MESSAGE_DELETE");

		await run(w, event);
		await run(w, event);

		await assertGone(w, deleted);
		await assertKept(w, kept);
	});

	it("Empty Trash removes the objects of every expunged message", async () => {
		const w = await store.world();
		const inbox = await w.folder("INBOX");
		const trash = await w.folder("Trash", {
			specialUse: MailboxSpecialUse.Trash,
		});
		const trashed = [await w.message(trash), await w.message(trash)];
		const kept = await w.message(inbox);
		for (const message of [...trashed, kept]) await storeBody(w, message);
		await w.client.messageMove.emptyTrash(
			w.account.accountConfigId,
			w.account.accountId,
		);

		await run(w, queuedEvent(w, "EMPTY_TRASH"));

		for (const message of trashed) await assertGone(w, message);
		await assertKept(w, kept);
	});

	it("deleting a folder removes the objects of the mail in it", async () => {
		const w = await store.world();
		const inbox = await w.folder("INBOX");
		const old = await w.folder("Old");
		const filed = await w.message(old);
		const kept = await w.message(inbox);
		await storeBody(w, filed);
		await storeBody(w, kept);
		await w.client.mailboxQueue.deleteMailbox(
			old.mailboxId,
			w.account.accountId,
		);
		const event = queuedEvent(w, "MAILBOX_DELETE");

		await run(w, event);
		await run(w, event);

		await assertGone(w, filed);
		await assertKept(w, kept);
	});

	it("a message another client expunged is dropped by sync with its objects", async () => {
		const w = await store.world();
		const inbox = await w.folder("INBOX");
		const expunged = await w.message(inbox);
		const kept = await w.message(inbox);
		await storeBody(w, expunged);
		await storeBody(w, kept);
		w.imap.expunge("INBOX", expunged.uid);
		w.imap.renumber("INBOX", 2);

		const sync = (): Promise<void> =>
			run(w, {
				type: "SYNC_MESSAGES",
				eventId: randomUUID(),
				timestamp: Date.now(),
				accountId: w.account.accountId,
				mailboxId: inbox.mailboxId,
			});

		await sync();
		await sync();

		await assertGone(w, expunged);
		await assertKept(w, kept);
	});

	it("a permanent delete handed back when its event cannot be queued removes the objects", async () => {
		const w = await store.world();
		const inbox = await w.folder("INBOX");
		const deleted = await w.message(inbox);
		const kept = await w.message(inbox);
		await storeBody(w, deleted);
		await storeBody(w, kept);
		w.refuseSends(new Error("connect ECONNREFUSED 127.0.0.1:9324"));

		await assert.rejects(
			w.client.messageMove.deleteMessage(
				w.account.accountConfigId,
				deleted.messageId,
				w.account.accountId,
				{ permanent: true },
			),
			/ECONNREFUSED/,
		);

		await assertGone(w, deleted);
		await assertKept(w, kept);
	});
});
