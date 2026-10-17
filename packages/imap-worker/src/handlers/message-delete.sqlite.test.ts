import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { RemitClient } from "@remit/backend/client";
import {
	MailboxCursorState,
	MailboxSpecialUse,
	MessageMutation,
	MessageStatus,
	MessageSyncStatus,
} from "@remit/domain-enums";
import type { MessageDeleteEvent } from "../events.js";
import { openStore, type World } from "../test-helpers/test-world.js";
import { handleMessageDelete } from "./message-delete.js";

// The sync writes the Message-ID onto the listing row only, never the Message
// row these handlers probe with, so on the SQLite store every probe by
// Message-ID has nothing to ask. Pinned here until the sync writes it.
const MESSAGE_ID_NOT_SYNCED =
	"message sync leaves Message.messageIdHeader empty on SQLite";

let store: Awaited<ReturnType<typeof openStore>>;

before(async () => {
	store = await openStore();
});

after(() => store.close());

interface Arranged {
	w: World;
	messageId: string;
	uid: number;
	messageIdHeader: string;
	inboxId: string;
	trashId: string;
	event: MessageDeleteEvent;
}

/**
 * A message in INBOX, deleted through the service the API calls, so the row
 * the handler finds and the event it gets are the ones a person's delete
 * leaves behind.
 */
const arrange = async (
	options: { permanent?: boolean; olderCopyInTrash?: boolean } = {},
): Promise<Arranged> => {
	const w = await store.world();
	const inbox = await w.folder("INBOX");
	const trash = await w.folder("Trash", {
		specialUse: MailboxSpecialUse.Trash,
	});
	const seeded = await w.message(inbox);
	if (options.olderCopyInTrash) w.imap.deliver("Trash", seeded.messageIdHeader);

	await w.client.messageMove.deleteMessage(
		w.account.accountConfigId,
		seeded.messageId,
		w.account.accountId,
		options.permanent ? { permanent: true } : { toTrash: true },
	);
	const event = w
		.queued()
		.find(
			(body) => body.type === "MESSAGE_DELETE",
		) as unknown as MessageDeleteEvent;
	assert.ok(event, "the delete enqueued a MESSAGE_DELETE");

	return {
		w,
		messageId: seeded.messageId,
		uid: seeded.uid,
		messageIdHeader: seeded.messageIdHeader,
		inboxId: inbox.mailboxId,
		trashId: trash.mailboxId,
		event,
	};
};

const run = (a: Arranged, receiveCount = 1, event = a.event) =>
	handleMessageDelete(event, a.w.log, receiveCount, a.w.scope);

const resyncs = (w: World): unknown[] =>
	w
		.queued()
		.filter((body) => body.type === "SYNC_MESSAGES")
		.map((body) => body.mailboxId);

const client = (): RemitClient => store.client;

describe("a move to Trash", () => {
	it("lands in Trash and settles the row on the uid the server gave it", async () => {
		const a = await arrange();

		await run(a);

		assert.deepEqual(a.w.imap.uids("INBOX"), []);
		const [trashUid] = a.w.imap.uids("Trash", a.messageIdHeader);
		const row = await a.w.row(a.messageId);
		assert.equal(row?.mailboxId, a.trashId);
		assert.equal(row?.uid, trashUid);
		assert.equal(row?.status, MessageStatus.active);
		assert.deepEqual(await a.w.threadRows(a.messageId), [
			{ mailboxId: a.trashId, uid: trashUid, isDeleted: true },
		]);
	});

	// Issue #1122. Without UIDPLUS the destination is asked by Message-ID, and
	// Trash already holds an older copy: binding the row to it lets Empty Trash
	// expunge the wrong one and leaves the fresh copy unreachable.
	it("settles on the copy this move delivered when the server sends no COPYUID", {
		todo: MESSAGE_ID_NOT_SYNCED,
	}, async () => {
		const a = await arrange({ olderCopyInTrash: true });
		a.w.imap.uidplus = false;

		await run(a);

		const copies = a.w.imap.uids("Trash", a.messageIdHeader);
		assert.equal(copies.length, 2);
		assert.equal((await a.w.row(a.messageId))?.uid, Math.max(...copies));
	});

	// One Message-ID can have several server copies. A source that still holds
	// the uid proves the MOVE never ran, so the older copy in Trash is not this
	// message and must never settle the row.
	it("never settles on an older copy in Trash while the source still holds the message", async () => {
		const a = await arrange({ olderCopyInTrash: true });
		a.w.imap.uidplus = false;
		a.w.imap.ignoreNext.add("MOVE");

		await assert.rejects(run(a), /unconfirmed/);

		const row = await a.w.row(a.messageId);
		assert.equal(row?.uid, a.uid);
		assert.equal(row?.status, MessageStatus.moving);
		assert.equal(row?.syncStatus, MessageSyncStatus.failed);
	});

	it("issues nothing when a redelivery finds the delete already settled", async () => {
		const a = await arrange();
		await run(a);
		const settled = await a.w.row(a.messageId);
		const commands = a.w.imap.log.length;

		await run(a);

		assert.equal(
			a.w.imap.log.length,
			commands,
			"no IMAP command on redelivery",
		);
		assert.deepEqual(await a.w.row(a.messageId), settled);
	});

	it("marks the row failed and redelivers when the connection drops mid-move", async () => {
		const a = await arrange();
		a.w.imap.failNext.MOVE = new Error("Connection reset");

		await assert.rejects(run(a), /Connection reset/);

		const row = await a.w.row(a.messageId);
		assert.equal(row?.status, MessageStatus.moving);
		assert.equal(row?.syncStatus, MessageSyncStatus.failed);
		assert.deepEqual(a.w.imap.uids("INBOX"), [a.uid]);
	});

	// Issue #980. At the ceiling the server is asked where the message is, and
	// a message that never left INBOX puts the row back there.
	it("puts the row back on its source at the ceiling when the message never left", async () => {
		const a = await arrange();
		a.w.imap.failNext.MOVE = new Error("Connection reset");

		await run(a, 3);

		const row = await a.w.row(a.messageId);
		assert.equal(row?.mailboxId, a.inboxId);
		assert.equal(row?.uid, a.uid);
		assert.notEqual(row?.status, MessageStatus.moving);
		assert.deepEqual(resyncs(a.w), [a.inboxId, a.trashId]);
	});

	it("hands the row back without creating a Trash the server does not have", async () => {
		const a = await arrange();
		a.w.imap.folders.delete("Trash");

		await run(a);

		assert.deepEqual(a.w.imap.commands("CREATE"), []);
		const row = await a.w.row(a.messageId);
		assert.equal(row?.mailboxId, a.inboxId);
		assert.equal(row?.uid, a.uid);
		assert.equal(row?.syncStatus, MessageSyncStatus.abandoned);
		assert.equal(row?.abandonedMutation, MessageMutation.delete);
	});

	it("hands the row back without connecting while the source cursor is rebuilding", async () => {
		const a = await arrange();
		await client().mailbox.update(a.w.account.accountId, a.inboxId, {
			cursorState: MailboxCursorState.rebuilding,
		});

		await run(a);

		assert.equal(a.w.imap.connections, 0);
		const row = await a.w.row(a.messageId);
		assert.equal(row?.mailboxId, a.inboxId);
		assert.equal(row?.status, MessageStatus.active);
		assert.equal(
			a.w.logs.filter(
				(line) => line.fields.metric === "message_delete_dropped_on_pause",
			).length,
			1,
		);
		assert.deepEqual(resyncs(a.w), [a.inboxId, a.trashId]);
	});

	// The folder was deleted and recreated on the server: uid 1 now names
	// whatever the server put there. Nothing may be moved by it.
	it("moves nothing when the source's UIDVALIDITY changed under it", async () => {
		const a = await arrange();
		a.w.imap.folder("INBOX").uidValidity = 2;

		await run(a);

		assert.deepEqual(a.w.imap.commands("MOVE"), []);
		assert.equal((await a.w.row(a.messageId))?.mailboxId, a.inboxId);
		const inbox = await client().mailbox.get(a.w.account.accountId, a.inboxId);
		assert.notEqual(inbox.cursorState, MailboxCursorState.normal);
	});

	it("moves from the folder's current path when it was renamed after enqueue", async () => {
		const a = await arrange();
		const folder = a.w.imap.folder("INBOX");
		a.w.imap.folders.delete("INBOX");
		a.w.imap.folders.set("Old/Inbox", folder);
		await client().mailbox.update(a.w.account.accountId, a.inboxId, {
			fullPath: "Old/Inbox",
		});

		await run(a);

		assert.deepEqual(a.w.imap.uids("Old/Inbox"), []);
		assert.equal(a.w.imap.uids("Trash", a.messageIdHeader).length, 1);
	});

	it("acks without connecting when the source mailbox was deleted", async () => {
		const a = await arrange();
		await client().mailbox.delete(a.w.account.accountId, a.inboxId);

		await run(a);

		assert.equal(a.w.imap.connections, 0);
	});

	it("refuses an event minted under an unknown contract and hands the row back", async () => {
		const a = await arrange();

		await run(a, 1, {
			...a.event,
			schemaVersion: 99,
		} as unknown as MessageDeleteEvent);

		assert.equal(a.w.imap.connections, 0);
		const row = await a.w.row(a.messageId);
		assert.equal(row?.mailboxId, a.inboxId);
		assert.equal(row?.syncStatus, MessageSyncStatus.abandoned);
	});
});

describe("a permanent delete", () => {
	it("expunges the message and removes every local row", async () => {
		const a = await arrange({ permanent: true });

		await run(a);

		assert.deepEqual(a.w.imap.uids("INBOX"), []);
		assert.equal(await a.w.row(a.messageId), undefined);
		assert.deepEqual(await a.w.threadRows(a.messageId), []);
	});

	it("cleans up locally when another client already expunged it", async () => {
		const a = await arrange({ permanent: true });
		a.w.imap.folder("INBOX").messages = [];
		a.w.imap.failNext.EXPUNGE = new Error("Message not found (NONEXISTENT)");

		await run(a);

		assert.equal(await a.w.row(a.messageId), undefined);
	});

	it("keeps the row when the server still holds the message after a failed expunge", async () => {
		const a = await arrange({ permanent: true });
		a.w.imap.failNext.EXPUNGE = new Error("Message not found (NONEXISTENT)");

		await assert.rejects(run(a), /NONEXISTENT/);

		assert.equal((await a.w.row(a.messageId))?.status, MessageStatus.deleting);
		assert.deepEqual(a.w.imap.uids("INBOX"), [a.uid]);
	});
});
