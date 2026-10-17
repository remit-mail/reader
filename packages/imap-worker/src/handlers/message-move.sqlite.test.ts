import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
	MailboxCursorState,
	MailboxSpecialUse,
	MessageMutation,
	MessageStatus,
	MessageSyncStatus,
} from "@remit/domain-enums";
import type { MessageMoveEvent } from "../events.js";
import { mail, openStore, type World } from "../test-helpers/test-world.js";
import { handleMessageMove } from "./message-move.js";

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
	archiveId: string;
	event: MessageMoveEvent;
}

/** A message in INBOX, moved to Archive through the service the API calls. */
const arrange = async (
	options: { olderCopyInArchive?: boolean } = {},
): Promise<Arranged> => {
	const w = await store.world();
	const inbox = await w.folder("INBOX");
	const archive = await w.folder("Archive", {
		specialUse: MailboxSpecialUse.Archive,
	});
	const seeded = await w.message(inbox);
	if (options.olderCopyInArchive) {
		w.imap.deliver("Archive", mail(seeded.messageIdHeader));
	}

	await w.client.messageMove.moveMessage(
		w.account.accountConfigId,
		seeded.messageId,
		archive.mailboxId,
		w.account.accountId,
	);
	const event = w
		.queued()
		.find(
			(body) => body.type === "MESSAGE_MOVE",
		) as unknown as MessageMoveEvent;
	assert.ok(event, "the move enqueued a MESSAGE_MOVE");

	return {
		w,
		messageId: seeded.messageId,
		uid: seeded.uid,
		messageIdHeader: seeded.messageIdHeader,
		inboxId: inbox.mailboxId,
		archiveId: archive.mailboxId,
		event,
	};
};

const run = (a: Arranged, receiveCount = 1) =>
	handleMessageMove(a.event, a.w.log, receiveCount, a.w.scope);

const resyncs = (w: World): unknown[] =>
	w
		.queued()
		.filter((body) => body.type === "SYNC_MESSAGES")
		.map((body) => body.mailboxId);

const logged = (w: World, key: string, value: string): number =>
	w.logs.filter((line) => line.fields[key] === value).length;

describe("a message move", () => {
	it("lands at the destination and settles the row on the uid the server gave it", async () => {
		const a = await arrange();

		await run(a);

		assert.deepEqual(a.w.imap.uids("INBOX"), []);
		const [archiveUid] = a.w.imap.uids("Archive", a.messageIdHeader);
		const row = await a.w.row(a.messageId);
		assert.equal(row?.mailboxId, a.archiveId);
		assert.equal(row?.uid, archiveUid);
		assert.equal(row?.status, MessageStatus.active);
		assert.deepEqual(await a.w.threadRows(a.messageId), [
			{ mailboxId: a.archiveId, uid: archiveUid, isDeleted: false },
		]);
		assert.deepEqual(resyncs(a.w), [a.inboxId, a.archiveId]);
	});

	// Issue #1122: without COPYUID the destination is asked by Message-ID, and
	// an older copy already there must not take the row.
	it("binds to the copy this move delivered when the server sends no COPYUID", async () => {
		const a = await arrange({ olderCopyInArchive: true });
		a.w.imap.uidplus = false;

		await run(a);

		const copies = a.w.imap.uids("Archive", a.messageIdHeader);
		assert.equal(copies.length, 2);
		assert.equal((await a.w.row(a.messageId))?.uid, Math.max(...copies));
	});

	it("issues nothing when a redelivery finds the move already settled", async () => {
		const a = await arrange();
		await run(a);
		const commands = a.w.imap.log.length;

		await run(a);

		assert.equal(a.w.imap.log.length, commands);
	});

	it("marks the row failed and redelivers when the connection drops mid-move", async () => {
		const a = await arrange();
		a.w.imap.failNext.MOVE = new Error("Connection reset");

		await assert.rejects(run(a), /Connection reset/);

		const row = await a.w.row(a.messageId);
		assert.equal(row?.status, MessageStatus.moving);
		assert.equal(row?.syncStatus, MessageSyncStatus.failed);
	});

	// Issue #655, BROKEN: the message never left, so the row goes back on the
	// pair the server confirmed and says a move gave up.
	it("puts the row back on its source at the ceiling when the message never left", async () => {
		const a = await arrange();
		a.w.imap.failNext.MOVE = new Error("Connection reset");

		await run(a, 3);

		const row = await a.w.row(a.messageId);
		assert.equal(row?.mailboxId, a.inboxId);
		assert.equal(row?.uid, a.uid);
		assert.notEqual(row?.status, MessageStatus.moving);
		assert.equal(row?.abandonedMutation, MessageMutation.move);
		assert.deepEqual(resyncs(a.w), [a.inboxId, a.archiveId]);
	});

	// Issue #655, RECONCILED: the message is gone from the source, so the stale
	// row goes and the resync re-projects it wherever it actually is.
	it("reconciles the row away at the ceiling when the source no longer holds it", async () => {
		const a = await arrange();
		a.w.imap.empty("INBOX");
		a.w.imap.failNext.MOVE = new Error("Connection reset");

		await run(a, 3);

		assert.equal(await a.w.row(a.messageId), undefined);
		assert.deepEqual(resyncs(a.w), [a.inboxId, a.archiveId]);
	});

	it("creates a destination the server does not have and redelivers", async () => {
		const a = await arrange();
		a.w.imap.removeFolder("Archive");

		await assert.rejects(run(a), /TRYCREATE/);

		assert.deepEqual(a.w.imap.commands("CREATE"), ["CREATE Archive"]);
		assert.deepEqual(a.w.imap.uids("INBOX"), [a.uid]);
	});

	it("hands the row back without connecting when the destination mailbox was deleted", async () => {
		const a = await arrange();
		await a.w.client.mailbox.delete(a.w.account.accountId, a.archiveId);

		await run(a);

		assert.equal(a.w.imap.connections, 0);
		const row = await a.w.row(a.messageId);
		assert.equal(row?.mailboxId, a.inboxId);
		assert.equal(row?.uid, a.uid);
		assert.equal(row?.status, MessageStatus.active);
		assert.equal(logged(a.w, "metric", "message_move_destination_gone"), 1);
		assert.deepEqual(resyncs(a.w), [a.inboxId]);
	});

	it("acks without connecting when the source mailbox was deleted", async () => {
		const a = await arrange();
		await a.w.client.mailbox.delete(a.w.account.accountId, a.inboxId);

		await run(a);

		assert.equal(a.w.imap.connections, 0);
	});

	// Issue #1203: a paused cursor that acked left the row naming the
	// destination with the source's uid, unmovable and undeletable for good.
	it("hands the row back to its source without connecting while the cursor is rebuilding", async () => {
		const a = await arrange();
		await a.w.client.mailbox.update(a.w.account.accountId, a.inboxId, {
			cursorState: MailboxCursorState.rebuilding,
		});

		await run(a);

		assert.equal(a.w.imap.connections, 0);
		const row = await a.w.row(a.messageId);
		assert.equal(row?.mailboxId, a.inboxId);
		assert.equal(row?.uid, a.uid);
		assert.equal(row?.status, MessageStatus.active);
		assert.equal(logged(a.w, "metric", "message_move_dropped_on_pause"), 1);
		assert.deepEqual(resyncs(a.w), [a.inboxId, a.archiveId]);
	});

	// The redelivery half of #1203: the source answers "no" because it was
	// recreated, and Archive holds an older copy. Settling on it would bind the
	// row to mail this move never touched.
	it("never settles a redelivered paused move off a sighting at the destination", async () => {
		const a = await arrange({ olderCopyInArchive: true });
		a.w.imap.empty("INBOX");
		await a.w.client.mailbox.update(a.w.account.accountId, a.inboxId, {
			cursorState: MailboxCursorState.rebuilding,
		});

		await run(a, 2);

		assert.deepEqual(a.w.imap.commands("MOVE"), []);
		const row = await a.w.row(a.messageId);
		assert.equal(row?.mailboxId, a.inboxId);
		assert.equal(row?.uid, a.uid);
		assert.equal(row?.syncStatus, MessageSyncStatus.abandoned);
		assert.equal(row?.abandonedMutation, MessageMutation.move);
		assert.equal(
			logged(a.w, "alert", "message_move_paused_placement_unproven"),
			1,
		);
	});

	it("moves nothing when the source's UIDVALIDITY changed under it", async () => {
		const a = await arrange();
		a.w.imap.setUidValidity("INBOX", 2);

		await run(a);

		assert.deepEqual(a.w.imap.commands("MOVE"), []);
		assert.equal((await a.w.row(a.messageId))?.mailboxId, a.inboxId);
	});

	it("moves under the destination's current path when it was renamed after enqueue", async () => {
		const a = await arrange();
		a.w.imap.renameFolder("Archive", "Records");
		await a.w.client.mailbox.update(a.w.account.accountId, a.archiveId, {
			fullPath: "Records",
		});

		await run(a);

		assert.equal(a.w.imap.uids("Records", a.messageIdHeader).length, 1);
		assert.equal((await a.w.row(a.messageId))?.mailboxId, a.archiveId);
	});

	it("acks without connecting when the message row is already gone", async () => {
		const a = await arrange();
		await a.w.client.message.delete(a.messageId);

		await run(a);

		assert.equal(a.w.imap.connections, 0);
	});
});
