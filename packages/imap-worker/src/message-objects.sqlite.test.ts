import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { MailboxSpecialUse } from "@remit/domain-enums";
import type { WorkerEvent } from "./events.js";
import { filesystemAccountObjects } from "./filesystem-account-objects.js";
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

const queuedEvent = (w: World, type: WorkerEvent["type"]): WorkerEvent => {
	const event = w
		.queued()
		.filter((body) => body.type === type)
		.at(-1) as unknown as WorkerEvent | undefined;
	assert.ok(event, `a ${type} was enqueued`);
	return event;
};

const run = (w: World, event: WorkerEvent) =>
	processEvent(
		event,
		w.ctx({
			accountObjects: filesystemAccountObjects(
				process.env.STORAGE_LOCAL_PATH ?? "",
			),
		}),
		1,
	);

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
});
