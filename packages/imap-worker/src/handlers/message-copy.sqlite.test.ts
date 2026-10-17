import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
	MailboxCursorState,
	MessageMutation,
	MessageStatus,
	MessageSyncStatus,
} from "@remit/domain-enums";
import type {
	MessageCopyEvent,
	MessageDeleteEvent,
	MessageMoveEvent,
} from "../events.js";
import { mail, openStore, type World } from "../test-helpers/test-world.js";
import { handleMessageCopy } from "./message-copy.js";
import { handleMessageDelete } from "./message-delete.js";
import { handleMessageMove } from "./message-move.js";

let store: Awaited<ReturnType<typeof openStore>>;

before(async () => {
	store = await openStore();
});

after(() => store.close());

interface Arranged {
	w: World;
	copyId: string;
	sourceMessageId: string;
	uid: number;
	messageIdHeader: string;
	inboxId: string;
	projectsId: string;
	event: MessageCopyEvent;
}

/** A message in INBOX, copied to Projects through the service the API calls. */
const arrange = async (
	options: { olderCopyInProjects?: boolean } = {},
): Promise<Arranged> => {
	const w = await store.world();
	const inbox = await w.folder("INBOX");
	const projects = await w.folder("Projects");
	const seeded = await w.message(inbox);
	if (options.olderCopyInProjects) {
		w.imap.deliver("Projects", mail(seeded.messageIdHeader));
	}

	const copyId = await w.client.messageMove.copyMessage(
		w.account.accountConfigId,
		seeded.messageId,
		projects.mailboxId,
		w.account.accountId,
	);
	const event = w
		.queued()
		.find(
			(body) => body.type === "MESSAGE_COPY",
		) as unknown as MessageCopyEvent;
	assert.ok(event, "the copy enqueued a MESSAGE_COPY");

	return {
		w,
		copyId,
		sourceMessageId: seeded.messageId,
		uid: seeded.uid,
		messageIdHeader: seeded.messageIdHeader,
		inboxId: inbox.mailboxId,
		projectsId: projects.mailboxId,
		event,
	};
};

const run = (a: Arranged, receiveCount = 1) =>
	handleMessageCopy(a.event, a.w.log, receiveCount, a.w.scope);

describe("a message copy", () => {
	it("lands at the destination, leaves the source alone and settles the copy row", async () => {
		const a = await arrange();

		await run(a);

		assert.deepEqual(a.w.imap.uids("INBOX"), [a.uid]);
		const [copyUid] = a.w.imap.uids("Projects", a.messageIdHeader);
		const row = await a.w.row(a.copyId);
		assert.equal(row?.mailboxId, a.projectsId);
		assert.equal(row?.uid, copyUid);
		assert.equal(row?.status, MessageStatus.active);
		assert.equal(row?.syncStatus, MessageSyncStatus.synced);
		assert.equal((await a.w.row(a.sourceMessageId))?.mailboxId, a.inboxId);
	});

	it("settles on the copy this event made when the server sends no COPYUID", async () => {
		const a = await arrange({ olderCopyInProjects: true });
		a.w.imap.uidplus = false;

		await run(a);

		const copies = a.w.imap.uids("Projects", a.messageIdHeader);
		assert.equal(copies.length, 2);
		assert.equal((await a.w.row(a.copyId))?.uid, Math.max(...copies));
	});

	it("reconciles the copy row away when the destination does not hold the copy", async () => {
		const a = await arrange();
		a.w.imap.uidplus = false;
		a.w.imap.ignoreNext.add("COPY");

		await run(a);

		assert.equal(await a.w.row(a.copyId), undefined);
		assert.equal(
			a.w.logs.filter(
				(line) => line.fields.metric === "message_copy_not_landed",
			).length,
			1,
		);
	});

	// COPY has no source-side effect, so a second one is a duplicate the user
	// then has to find and delete.
	it("never copies twice when a redelivery finds the copy already landed", async () => {
		const a = await arrange();
		a.w.imap.deliver("Projects", mail(a.messageIdHeader));

		await run(a, 2);

		assert.deepEqual(a.w.imap.commands("COPY"), []);
		assert.equal(a.w.imap.uids("Projects", a.messageIdHeader).length, 1);
		assert.equal((await a.w.row(a.copyId))?.status, MessageStatus.active);
	});

	it("issues nothing when a redelivery finds the copy already settled", async () => {
		const a = await arrange();
		await run(a);
		const commands = a.w.imap.log.length;

		await run(a);

		assert.equal(a.w.imap.log.length, commands);
	});

	it("creates a destination the server does not have and redelivers", async () => {
		const a = await arrange();
		a.w.imap.removeFolder("Projects");

		await assert.rejects(run(a), /TRYCREATE/);

		assert.deepEqual(a.w.imap.commands("CREATE"), ["CREATE Projects"]);
	});

	it("gives the copy up when the source message is gone on the server", async () => {
		const a = await arrange();
		a.w.imap.failNext.COPY = new Error("Message not found (NONEXISTENT)");

		await run(a);

		const row = await a.w.row(a.copyId);
		assert.equal(row?.status, MessageStatus.deleted);
		assert.equal(row?.syncStatus, MessageSyncStatus.abandoned);
		assert.equal(row?.abandonedMutation, MessageMutation.copy);
	});

	it("marks the copy failed and redelivers when the connection drops", async () => {
		const a = await arrange();
		a.w.imap.failNext.COPY = new Error("Connection reset");

		await assert.rejects(run(a), /Connection reset/);

		assert.equal(
			(await a.w.row(a.copyId))?.syncStatus,
			MessageSyncStatus.failed,
		);
	});

	it("settles on the destination's copy at the ceiling instead of dead-lettering", async () => {
		const a = await arrange();
		a.w.imap.deliver("Projects", mail(a.messageIdHeader));
		a.w.imap.failNext.COPY = new Error("Connection reset");

		await run(a, 3);

		const [copyUid] = a.w.imap.uids("Projects", a.messageIdHeader);
		const row = await a.w.row(a.copyId);
		assert.equal(row?.uid, copyUid);
		assert.equal(row?.status, MessageStatus.active);
	});

	it("reconciles the copy row away at the ceiling when nothing reached the destination", async () => {
		const a = await arrange();
		a.w.imap.failNext.COPY = new Error("Connection reset");

		await run(a, 3);

		assert.equal(await a.w.row(a.copyId), undefined);
	});

	it("reconciles the copy row away without connecting when the destination mailbox was deleted", async () => {
		const a = await arrange();
		await a.w.client.mailbox.delete(a.w.account.accountId, a.projectsId);

		await run(a);

		assert.equal(a.w.imap.connections, 0);
		assert.equal(await a.w.row(a.copyId), undefined);
	});

	it("reconciles the copy row away without connecting while the source cursor is rebuilding", async () => {
		const a = await arrange();
		await a.w.client.mailbox.update(a.w.account.accountId, a.inboxId, {
			cursorState: MailboxCursorState.rebuilding,
		});

		await run(a);

		assert.equal(a.w.imap.connections, 0);
		assert.equal(await a.w.row(a.copyId), undefined);
	});

	it("copies nothing when the source's UIDVALIDITY changed under it", async () => {
		const a = await arrange();
		a.w.imap.setUidValidity("INBOX", 2);

		await run(a);

		assert.deepEqual(a.w.imap.commands("COPY"), []);
		assert.equal(await a.w.row(a.copyId), undefined);
	});

	it("acks without connecting when the source mailbox was deleted", async () => {
		const a = await arrange();
		await a.w.client.mailbox.delete(a.w.account.accountId, a.inboxId);

		await run(a);

		assert.equal(a.w.imap.connections, 0);
	});
});

describe("a fresh copy acted on before the server confirms it", () => {
	const isMove = (
		body: Record<string, unknown>,
	): body is Record<string, unknown> & MessageMoveEvent =>
		body.type === "MESSAGE_MOVE";
	const isDelete = (
		body: Record<string, unknown>,
	): body is Record<string, unknown> & MessageDeleteEvent =>
		body.type === "MESSAGE_DELETE";

	it("waits for the copy to settle, then moves the copy and leaves the original", async () => {
		const a = await arrange();

		const moving = a.w.client.messageMove.moveMessage(
			a.w.account.accountConfigId,
			a.copyId,
			a.inboxId,
			a.w.account.accountId,
		);
		await run(a);
		await moving;
		const [copyUid] = a.w.imap.uids("Projects", a.messageIdHeader);
		const event = a.w.queued().find(isMove);
		assert.ok(event, "the move enqueued a MESSAGE_MOVE");
		assert.equal(event.uid, copyUid);

		await handleMessageMove(event, a.w.log, 1, a.w.scope);

		assert.deepEqual(a.w.imap.uids("Projects", a.messageIdHeader), []);
		assert.equal(a.w.imap.uids("INBOX", a.messageIdHeader).length, 2);
		const row = await a.w.row(a.copyId);
		assert.equal(row?.mailboxId, a.inboxId);
		assert.equal(row?.status, MessageStatus.active);
		assert.equal((await a.w.row(a.sourceMessageId))?.uid, a.uid);
	});

	it("waits for the copy to settle, then expunges the copy and leaves the original", async () => {
		const a = await arrange();

		const deleting = a.w.client.messageMove.deleteMessages(
			a.w.account.accountConfigId,
			[a.copyId],
			a.w.account.accountId,
			{ permanent: true },
		);
		await run(a);
		assert.deepEqual((await deleting).refusedMessageIds, []);
		const event = a.w.queued().find(isDelete);
		assert.ok(event, "the delete enqueued a MESSAGE_DELETE");

		await handleMessageDelete(event, a.w.log, 1, a.w.scope);

		assert.deepEqual(a.w.imap.uids("Projects", a.messageIdHeader), []);
		assert.deepEqual(a.w.imap.uids("INBOX"), [a.uid]);
		assert.equal(await a.w.row(a.copyId), undefined);
		assert.equal((await a.w.row(a.sourceMessageId))?.mailboxId, a.inboxId);
	});
});
