import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import type { MailboxItem } from "@remit/data-ports";
import {
	MailboxCursorState,
	MailboxSpecialUse,
	MessageStatus,
} from "@remit/domain-enums";
import type { EmptyTrashEvent } from "../events.js";
import {
	openStore,
	type SeededMessage,
	type World,
} from "../test-helpers/test-world.js";
import { handleEmptyTrash } from "./empty-trash.js";

let store: Awaited<ReturnType<typeof openStore>>;

before(async () => {
	store = await openStore();
});

interface Arranged {
	w: World;
	inbox: MailboxItem;
	trash: MailboxItem;
	trashed: SeededMessage[];
}

const arrange = async (count = 2): Promise<Arranged> => {
	const w = await store.world();
	const inbox = await w.folder("INBOX");
	const trash = await w.folder("Trash", {
		specialUse: MailboxSpecialUse.Trash,
	});
	const trashed: SeededMessage[] = [];
	for (let i = 0; i < count; i += 1) trashed.push(await w.message(trash));
	return { w, inbox, trash, trashed };
};

/** Empty Trash through the service the API calls, and hand back its event. */
const emptyTrash = async (a: Arranged): Promise<EmptyTrashEvent> => {
	await a.w.client.messageMove.emptyTrash(
		a.w.account.accountConfigId,
		a.w.account.accountId,
	);
	const event = a.w
		.queued()
		.find((body) => body.type === "EMPTY_TRASH") as unknown as EmptyTrashEvent;
	assert.ok(event, "Empty Trash enqueued an EMPTY_TRASH");
	return event;
};

const run = (a: Arranged, event: EmptyTrashEvent) =>
	handleEmptyTrash(event, a.w.log, a.w.deps() as never);

const visible = async (a: Arranged): Promise<boolean[]> =>
	Promise.all(
		a.trashed.map(async (message) => {
			const row = await a.w.row(message.messageId);
			const listing = await a.w.threadRows(message.messageId);
			return (
				row?.status === MessageStatus.active &&
				listing.length > 0 &&
				listing.every((tm) => !tm.isDeleted)
			);
		}),
	);

describe("Empty Trash", () => {
	it("expunges every message on the server and removes both local rows", async () => {
		const a = await arrange();
		const event = await emptyTrash(a);

		await run(a, event);

		assert.deepEqual(a.w.imap.uids("Trash"), []);
		for (const message of a.trashed) {
			assert.equal(await a.w.row(message.messageId), undefined);
			assert.deepEqual(await a.w.threadRows(message.messageId), []);
		}
	});

	it("hands every row back when another client emptied the Trash first", async () => {
		const a = await arrange();
		const event = await emptyTrash(a);
		a.w.imap.folder("Trash").messages = [];

		await run(a, event);

		assert.deepEqual(await visible(a), [true, true]);
	});

	it("keeps the row of a message the expunge never reached", async () => {
		const a = await arrange();
		const event = await emptyTrash(a);
		const [kept, gone] = a.trashed;
		a.w.imap.folder("Trash").messages = a.w.imap
			.folder("Trash")
			.messages.filter((message) => message.uid !== kept?.uid);

		await run(a, event);

		assert.equal(await a.w.row(gone?.messageId ?? ""), undefined);
		assert.equal(
			(await a.w.row(kept?.messageId ?? ""))?.status,
			MessageStatus.active,
		);
	});

	// A move into Trash that has not settled names Trash while still carrying
	// INBOX's uid. Matching it against the expunge would delete whatever Trash
	// holds at that number.
	it("leaves a message whose move into Trash has not settled", async () => {
		const a = await arrange(1);
		const moving = await a.w.message(a.inbox);
		await a.w.client.messageMove.deleteMessage(
			a.w.account.accountConfigId,
			moving.messageId,
			a.w.account.accountId,
		);
		const event = await emptyTrash(a);

		await run(a, event);

		const row = await a.w.row(moving.messageId);
		assert.equal(row?.status, MessageStatus.moving);
		assert.deepEqual(a.w.imap.uids("INBOX"), [moving.uid]);
		assert.equal(await a.w.row(a.trashed[0]?.messageId ?? ""), undefined);
	});

	it("expunges nothing and hands the rows back when the folder at the path is not the one emptied", async () => {
		const a = await arrange();
		const event = await emptyTrash(a);
		a.w.imap.folder("Trash").uidValidity = 99;

		await run(a, event);

		assert.deepEqual(a.w.imap.commands("EXPUNGE"), []);
		assert.deepEqual(await visible(a), [true, true]);
	});

	it("expunges nothing when the Trash role no longer rests on confirmed evidence", async () => {
		const a = await arrange();
		const event = await emptyTrash(a);
		await a.w.client.mailboxSpecialUse.deleteByMailboxId(a.trash.mailboxId);

		await run(a, event);

		assert.equal(a.w.imap.connections, 0);
		assert.deepEqual(await visible(a), [true, true]);
	});

	it("hands the rows back without connecting while the cursor is rebuilding", async () => {
		const a = await arrange();
		const event = await emptyTrash(a);
		await a.w.client.mailbox.update(a.w.account.accountId, a.trash.mailboxId, {
			cursorState: MailboxCursorState.rebuilding,
		});

		await run(a, event);

		assert.equal(a.w.imap.connections, 0);
		assert.deepEqual(await visible(a), [true, true]);
	});

	it("refuses an event minted under an unknown contract and hands the rows back", async () => {
		const a = await arrange();
		const event = await emptyTrash(a);

		await run(a, { ...event, schemaVersion: 99 } as unknown as EmptyTrashEvent);

		assert.equal(a.w.imap.connections, 0);
		assert.deepEqual(await visible(a), [true, true]);
	});

	it("acks without connecting when the Trash mailbox was deleted", async () => {
		const a = await arrange();
		const event = await emptyTrash(a);
		await a.w.client.mailbox.delete(a.w.account.accountId, a.trash.mailboxId);

		await run(a, event);

		assert.equal(a.w.imap.connections, 0);
	});

	it("empties Trash under its current path when the folder was renamed after enqueue", async () => {
		const a = await arrange();
		const event = await emptyTrash(a);
		const folder = a.w.imap.folder("Trash");
		a.w.imap.folders.delete("Trash");
		a.w.imap.folders.set("Deleted Items", folder);
		await a.w.client.mailbox.update(a.w.account.accountId, a.trash.mailboxId, {
			fullPath: "Deleted Items",
		});

		await run(a, event);

		assert.deepEqual(a.w.imap.uids("Deleted Items"), []);
	});

	it("rethrows a failed expunge so the event is retried", async () => {
		const a = await arrange();
		const event = await emptyTrash(a);
		a.w.imap.failNext.EXPUNGE = new Error("Connection reset");

		await assert.rejects(run(a, event), /Connection reset/);

		assert.equal(a.w.imap.uids("Trash").length, 2);
	});
});
