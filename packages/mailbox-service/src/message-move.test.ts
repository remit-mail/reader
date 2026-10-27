import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import type {
	AccountItem,
	CreateMessageInput,
	MailboxItem,
} from "@remit/data-ports";
import { MessagePlacementUnsettledError } from "@remit/data-ports/errors";
import { composeFolderRoleAppointmentName } from "@remit/data-ports/folder-role";
import { deriveAddressId, deriveCopyMessageId } from "@remit/data-ports/id";
import {
	CanonicalMailboxRole,
	MessageClassificationState,
} from "@remit/domain-enums";
import { BodySyncService } from "./body-sync.js";
import {
	MessageMoveService,
	NoTrashMailboxError,
	StaleTrashAppointmentError,
	UnconfirmedTrashMailboxError,
} from "./message-move.js";
import { restoreSourcePlacement } from "./restore-source-placement.js";
import { SyncWarningService } from "./sync-warning.js";
import { eml, FakeImapServer } from "./test-helpers/fake-imap.js";
import {
	arriveAt,
	openStore,
	type RecordedMessage,
	type RecordingQueue,
	recordingQueue,
	type Store,
	seedAccount,
	seedMailbox,
	seedMessage,
	silentLog,
	syncFolder,
} from "./test-helpers/test-store.js";

type TrashSetup = "flagged" | "named" | "none" | "appointed" | "stale";

let store: Store;
let capture: RecordingQueue;
let queue: RecordedMessage[];
let imap: FakeImapServer;
let account: AccountItem;
let inbox: MailboxItem;
let archive: MailboxItem;
let junk: MailboxItem;
let trash: MailboxItem | undefined;

beforeEach(async () => {
	capture = recordingQueue();
	queue = capture.sent;
	store = await openStore();
	imap = new FakeImapServer();
});

afterEach(async () => {
	await store.close();
});

const appoint = (mailboxId: string) =>
	store.accountSetting.upsert({
		accountConfigId: account.accountConfigId,
		name: composeFolderRoleAppointmentName(
			account.accountId,
			CanonicalMailboxRole.Trash,
		),
		value: { kind: "String", value: mailboxId },
	});

const world = async (setup: TrashSetup = "flagged") => {
	account = await seedAccount(store);
	inbox = await seedMailbox(store, account, "INBOX");
	archive = await seedMailbox(store, account, "Archive");
	junk = await seedMailbox(store, account, "Junk", { specialUse: "Junk" });
	trash = undefined;
	if (setup === "flagged" || setup === "stale") {
		trash = await seedMailbox(store, account, "INBOX/Trash", {
			specialUse: "Trash",
		});
	}
	if (setup === "named") {
		trash = await seedMailbox(store, account, "Trash");
	}
	if (setup === "appointed") {
		await seedMailbox(store, account, "Deleted");
		trash = await seedMailbox(store, account, "Bin");
		await appoint(trash.mailboxId);
	}
	if (setup === "stale") {
		await appoint("mbx-appointed-and-gone");
	}
	for (const mailbox of await store.mailbox.listAllByAccount(
		account.accountId,
	)) {
		imap.addFolder(mailbox.fullPath);
	}
};

const service = () =>
	new MessageMoveService({
		messageService: store.message,
		mailboxService: store.mailbox,
		mailboxSpecialUseService: store.mailboxSpecialUse,
		threadMessageService: store.threadMessage,
		addressService: store.address,
		queue: capture.fifo,
		moveSettleTimeoutMs: 200,
		moveSettlePollMs: 10,
	});

const rowIn = async (
	mailbox: MailboxItem,
	uid: number,
	message: Partial<CreateMessageInput> = {},
) =>
	(await seedMessage(store, account, mailbox, uid, { message })).message
		.messageId;

const midMove = async (uid = 42) => {
	const messageId = await rowIn(inbox, uid);
	await service().moveMessage(
		account.accountConfigId,
		messageId,
		archive.mailboxId,
		account.accountId,
	);
	queue.length = 0;
	return messageId;
};

const midDelete = async (uid = 42) => {
	const messageId = await rowIn(inbox, uid);
	await service().deleteMessages(
		account.accountConfigId,
		[messageId],
		account.accountId,
	);
	queue.length = 0;
	return messageId;
};

const settleLater = (messageId: string, uid = 907) =>
	setTimeout(() => {
		void store.message.updateUid(messageId, uid, archive.mailboxId);
	}, 30);

const row = (messageId: string) => store.message.get(messageId);

describe("moving a message", () => {
	it("moves locally first and enqueues the IMAP move from the folder it is in", async () => {
		await world();
		const messageId = await rowIn(inbox, 337);

		await service().moveMessages(
			account.accountConfigId,
			[messageId],
			archive.mailboxId,
			account.accountId,
		);

		const moved = await row(messageId);
		assert.equal(moved.mailboxId, archive.mailboxId);
		assert.equal(moved.syncStatus, "pending");
		assert.deepEqual(
			queue.map((event) => [
				event.body.type,
				event.body.sourceMailboxPath,
				event.body.uid,
			]),
			[["MESSAGE_MOVE", "INBOX", 337]],
		);
	});

	it("does nothing for a move into the folder the message is already in", async () => {
		await world();
		const messageId = await rowIn(inbox, 337);
		const before = await row(messageId);

		await service().moveMessages(
			account.accountConfigId,
			[messageId],
			inbox.mailboxId,
			account.accountId,
		);

		assert.equal(queue.length, 0);
		assert.deepEqual(await row(messageId), before);
	});

	it("binds the confirmed folder and uid once an in-flight move settles", async () => {
		await world();
		const messageId = await midMove();

		settleLater(messageId);
		await service().moveMessage(
			account.accountConfigId,
			messageId,
			inbox.mailboxId,
			account.accountId,
		);

		assert.deepEqual(
			queue.map((event) => [event.body.sourceMailboxPath, event.body.uid]),
			[["Archive", 907]],
		);
	});

	it("refuses and writes nothing while the earlier move never settles", async () => {
		await world();
		const messageId = await midMove();
		const before = await row(messageId);

		await assert.rejects(
			service().moveMessage(
				account.accountConfigId,
				messageId,
				inbox.mailboxId,
				account.accountId,
			),
			(error: unknown) =>
				error instanceof MessagePlacementUnsettledError &&
				error.statusCode === 409 &&
				error.publicApiError?.details?.reason === "in_flight",
		);

		assert.equal(queue.length, 0);
		assert.deepEqual(await row(messageId), before);
	});

	it("never answers the same-folder skip from a folder the message has not reached", async () => {
		await world();
		const messageId = await midMove();

		await assert.rejects(
			service().moveMessage(
				account.accountConfigId,
				messageId,
				archive.mailboxId,
				account.accountId,
			),
			MessagePlacementUnsettledError,
		);
		assert.equal(queue.length, 0);
	});

	it("moves no part of a batch while one row is in flight", async () => {
		await world();
		const settled = await rowIn(inbox, 11);
		const moving = await midMove();

		await assert.rejects(
			service().moveMessages(
				account.accountConfigId,
				[settled, moving],
				archive.mailboxId,
				account.accountId,
			),
			MessagePlacementUnsettledError,
		);

		assert.equal(queue.length, 0);
		assert.equal((await row(settled)).mailboxId, inbox.mailboxId);
	});

	it("waits out a delete into Trash in flight rather than binding its borrowed uid", async () => {
		await world();
		const messageId = await midDelete();
		assert.equal((await row(messageId)).mailboxId, trash?.mailboxId);

		await assert.rejects(
			service().moveMessage(
				account.accountConfigId,
				messageId,
				inbox.mailboxId,
				account.accountId,
			),
			MessagePlacementUnsettledError,
		);
		assert.equal(queue.length, 0);
	});

	it("moves a row a move gave up on without waiting", async () => {
		await world();
		const stranded = await midMove();
		await restoreSourcePlacement(
			{
				messageService: store.message,
				threadMessageService: store.threadMessage,
			},
			{
				accountConfigId: account.accountConfigId,
				messageId: stranded,
				sourceMailboxId: inbox.mailboxId,
				uid: 42,
				syncStatus: "abandoned",
				abandonedMutation: "move",
			},
		);
		assert.equal((await row(stranded)).syncStatus, "abandoned");

		const startedAt = Date.now();
		await service().moveMessage(
			account.accountConfigId,
			stranded,
			archive.mailboxId,
			account.accountId,
		);

		assert.ok(Date.now() - startedAt < 150);
		assert.equal((await row(stranded)).mailboxId, archive.mailboxId);
	});

	for (const action of ["move", "delete", "copy"] as const) {
		it(`refuses to ${action} a copy the server never confirms, writing nothing`, async () => {
			await world();
			const original = await rowIn(inbox, 5);
			await service().copyMessage(
				account.accountConfigId,
				original,
				archive.mailboxId,
				account.accountId,
			);
			queue.length = 0;
			const copy = deriveCopyMessageId(original, archive.mailboxId);
			const before = await row(copy);

			await assert.rejects(
				action === "delete"
					? service().deleteMessages(
							account.accountConfigId,
							[copy],
							account.accountId,
							{ permanent: true },
						)
					: service()[`${action}Message`](
							account.accountConfigId,
							copy,
							inbox.mailboxId,
							account.accountId,
						),
				(error: unknown) =>
					error instanceof MessagePlacementUnsettledError &&
					error.statusCode === 409 &&
					error.publicApiError?.details?.reason === "in_flight",
			);

			assert.equal(queue.length, 0);
			assert.deepEqual(await row(copy), before);
		});
	}
});

describe("deleting a message", () => {
	const remove = (messageIds: string[], permanent = false) =>
		service().deleteMessages(
			account.accountConfigId,
			messageIds,
			account.accountId,
			permanent ? { permanent } : undefined,
		);

	it("moves it into a Trash the server flagged under a nested path", async () => {
		await world("flagged");
		const messageId = await rowIn(inbox, 5);

		await remove([messageId]);

		assert.equal((await row(messageId)).mailboxId, trash?.mailboxId);
		assert.deepEqual(
			queue.map((event) => [
				event.body.operation,
				event.body.destinationMailboxPath,
			]),
			[["move_to_trash", "INBOX/Trash"]],
		);
	});

	it("files into a Trash that resolves by name alone", async () => {
		await world("named");
		const messageId = await rowIn(inbox, 5);

		await remove([messageId]);

		assert.equal((await row(messageId)).mailboxId, trash?.mailboxId);
	});

	for (const [setup, error, reason] of [
		["none", NoTrashMailboxError, "none"],
		["stale", StaleTrashAppointmentError, "stale"],
	] as const) {
		it(`refuses and touches nothing when the Trash is ${reason}`, async () => {
			await world(setup);
			const messageId = await rowIn(inbox, 5);
			const before = await row(messageId);

			await assert.rejects(
				remove([messageId]),
				(thrown: unknown) =>
					thrown instanceof error &&
					thrown.statusCode === 409 &&
					thrown.publicApiError?.details?.reason === reason,
			);

			assert.equal(queue.length, 0);
			assert.deepEqual(await row(messageId), before);
		});
	}

	it("expunges only when asked for a permanent delete", async () => {
		await world("none");
		const messageId = await rowIn(inbox, 5);

		await remove([messageId], true);

		assert.deepEqual(
			queue.map((event) => event.body.operation),
			["permanent_delete"],
		);
	});

	it("expunges a message already in a confirmed Trash", async () => {
		await world("flagged");
		const messageId = await rowIn(trash as MailboxItem, 5);

		await remove([messageId]);

		assert.deepEqual(
			queue.map((event) => event.body.operation),
			["permanent_delete"],
		);
	});

	it("refuses to expunge from a Trash that only resolves by name", async () => {
		await world("named");
		const messageId = await rowIn(trash as MailboxItem, 5);

		await assert.rejects(
			remove([messageId]),
			(thrown: unknown) =>
				thrown instanceof UnconfirmedTrashMailboxError &&
				thrown.publicApiError?.details?.reason === "unconfirmed",
		);
		assert.equal(queue.length, 0);
	});

	it("withholds a sender whose only other mail is in Junk once this one is in Trash", async () => {
		await world("flagged");
		const raw = eml({ From: "Spam <spam@example.com>" });
		await arriveAt(store, imap, account, junk, raw);
		const kept = await arriveAt(
			store,
			imap,
			account,
			inbox,
			eml({ From: "Spam <spam@example.com>", "Message-ID": "<b@x>" }),
		);
		const sender = () =>
			store.address.getAddress(
				account.accountConfigId,
				deriveAddressId(account.accountConfigId, "spam@example.com"),
			);
		assert.equal((await sender()).flags.junkOnly, undefined);

		await remove([kept]);

		assert.equal((await sender()).flags.junkOnly?.value, true);
	});

	it("binds the confirmed pair once an in-flight move settles", async () => {
		await world("flagged");
		const messageId = await midMove();

		settleLater(messageId);
		await remove([messageId]);

		assert.deepEqual(
			queue.map((event) => [event.body.mailboxPath, event.body.uid]),
			[["Archive", 907]],
		);
	});

	it("expunges no part of a batch while one row is in flight, and all of it once it settles", async () => {
		await world("flagged");
		const settled = await rowIn(inbox, 11);
		const moving = await midMove();

		await assert.rejects(
			remove([settled, moving], true),
			MessagePlacementUnsettledError,
		);
		assert.equal(queue.length, 0);

		settleLater(moving);
		await remove([settled, moving], true);

		assert.deepEqual(
			queue.map((event) => [event.body.messageId, event.body.uid]).sort(),
			[
				[moving, 907],
				[settled, 11],
			].sort(),
		);
	});
});

describe("copying a message", () => {
	const copy = (messageIds: string[], destination: MailboxItem) =>
		service().copyMessages(
			account.accountConfigId,
			messageIds,
			destination.mailboxId,
			account.accountId,
		);

	const COPIED = eml({
		"Message-ID": "<copied@example.com>",
		"List-Id": "LinkedIn Invitations <invitations.linkedin.com>",
	});

	const source = async () => {
		const messageId = await arriveAt(store, imap, account, inbox, COPIED);
		await new BodySyncService(
			store.message,
			store.storage(),
			store.threadMessage,
			store.address,
			store.envelope,
			new SyncWarningService(store.syncWarning),
			silentLog,
		).syncBodies(
			[messageId],
			account.accountId,
			account.accountConfigId,
			{
				mailboxId: inbox.mailboxId,
				fullPath: inbox.fullPath,
				placement: "inbox",
				uidValidity: inbox.uidValidity,
			},
			async () => imap.connection(),
			{ force: false, concurrency: 1 },
		);
		return messageId;
	};

	const threads = async (messageId: string) =>
		store.threadMessage.findAllByMessageId(account.accountConfigId, messageId);

	it("derives the copy's id from source and destination and carries its derived fields", async () => {
		await world();
		const original = await source();

		await copy([original], archive);

		const copyId = deriveCopyMessageId(original, archive.mailboxId);
		const copied = await row(copyId);
		assert.equal(copied.mailboxId, archive.mailboxId);
		assert.equal(
			copied.classificationState,
			MessageClassificationState.Examined,
		);
		assert.equal((await threads(copyId))[0].listId, "invitations.linkedin.com");
		assert.deepEqual(
			queue.map((event) => event.body.type),
			["MESSAGE_COPY"],
		);
	});

	it("converges a replayed copy on one row", async () => {
		await world();
		const original = await source();

		await copy([original], archive);
		await copy([original], archive);

		const copyId = deriveCopyMessageId(original, archive.mailboxId);
		assert.equal((await threads(copyId)).length, 1);
		assert.equal(
			(await store.message.listAllByMailbox(archive.mailboxId)).length,
			1,
		);
	});

	it("adds no third row when the destination folder syncs the copy", async () => {
		await world();
		const original = await source();
		await copy([original], archive);
		const copyId = deriveCopyMessageId(original, archive.mailboxId);
		const uid = imap.deliver("Archive", COPIED);
		await store.message.updateUid(copyId, uid, archive.mailboxId);

		await syncFolder(store, account, archive, imap);

		assert.equal(
			(await store.message.listAllByMailbox(archive.mailboxId)).length,
			1,
		);
		assert.equal((await row(original)).mailboxId, inbox.mailboxId);
		assert.equal((await threads(copyId)).length, 1);
	});

	it("deletes the copy or the original without touching the other", async () => {
		await world();
		const original = await source();
		await copy([original], archive);
		const copyId = deriveCopyMessageId(original, archive.mailboxId);
		await store.message.updateUid(copyId, 77, archive.mailboxId);

		await service().deleteMessages(
			account.accountConfigId,
			[copyId],
			account.accountId,
			{ permanent: true },
		);

		assert.deepEqual(await threads(copyId), []);
		assert.equal((await threads(original)).length, 1);
	});

	it("binds the confirmed pair once an in-flight move settles, and refuses a batch until then", async () => {
		await world();
		const settled = await rowIn(inbox, 11);
		const moving = await midMove();

		await assert.rejects(
			copy([settled, moving], junk),
			MessagePlacementUnsettledError,
		);
		assert.equal(queue.length, 0);

		settleLater(moving);
		await service().copyMessage(
			account.accountConfigId,
			moving,
			inbox.mailboxId,
			account.accountId,
		);

		assert.deepEqual(
			queue.map((event) => [event.body.sourceMailboxPath, event.body.uid]),
			[["Archive", 907]],
		);
	});
});

describe("a copied message's body", () => {
	it("stays findable by a word in it in the destination", async () => {
		await world();
		const original = await rowIn(inbox, 5);
		await store.message.setSearchText(original, "the zygomorphic flower");

		await service().copyMessage(
			account.accountConfigId,
			original,
			archive.mailboxId,
			account.accountId,
		);

		const found = await store.threadMessage.searchByDate(
			account.accountConfigId,
			{ query: "zygomorphic" },
			{ mailboxIds: new Set([archive.mailboxId]) },
		);
		assert.deepEqual(
			found.items.map((item) => item.messageId),
			[deriveCopyMessageId(original, archive.mailboxId)],
		);
	});
});

describe("emptying the Trash", () => {
	const empty = () =>
		service().emptyTrash(account.accountConfigId, account.accountId);

	it("empties the appointed Trash, never the folder called Deleted", async () => {
		await world("appointed");
		const binned = await rowIn(trash as MailboxItem, 1);

		const { deletedCount } = await empty();

		assert.equal(deletedCount, 1);
		assert.equal((await row(binned)).status, "deleting");
		assert.deepEqual(
			queue.map((event) => [
				event.body.type,
				event.body.trashMailboxId,
				event.body.trashUidValidity,
			]),
			[["EMPTY_TRASH", trash?.mailboxId, trash?.uidValidity]],
		);
	});

	for (const [setup, error, reason] of [
		["none", NoTrashMailboxError, "none"],
		["named", UnconfirmedTrashMailboxError, "unconfirmed"],
		["stale", StaleTrashAppointmentError, "stale"],
	] as const) {
		it(`refuses when the Trash is ${reason}`, async () => {
			await world(setup);
			const kept = trash ? await rowIn(trash, 1) : undefined;

			await assert.rejects(
				empty(),
				(thrown: unknown) =>
					thrown instanceof error &&
					thrown.publicApiError?.details?.reason === reason,
			);

			assert.equal(queue.length, 0);
			if (kept) assert.equal((await row(kept)).status, "active");
		});
	}

	it("marks settled and sync-pending rows but leaves a move into Trash alone", async () => {
		await world("flagged");
		const bin = trash as MailboxItem;
		const settled = await rowIn(bin, 1);
		const pending = await arriveAt(store, imap, account, bin, eml({}));
		const arriving = await rowIn(inbox, 10);
		await service().moveMessage(
			account.accountConfigId,
			arriving,
			bin.mailboxId,
			account.accountId,
		);
		queue.length = 0;

		const { deletedCount } = await empty();

		assert.equal(deletedCount, 2);
		assert.equal((await row(settled)).status, "deleting");
		assert.equal((await row(pending)).status, "deleting");
		assert.equal((await row(arriving)).status, "moving");
	});

	it("reports the same count when pressed twice before the worker runs", async () => {
		await world("flagged");
		const bin = trash as MailboxItem;
		await rowIn(bin, 1);
		await rowIn(bin, 2);

		const first = await empty();
		const second = await empty();

		assert.equal(first.deletedCount, 2);
		assert.equal(second.deletedCount, 2);
		assert.equal(queue.length, 2);
	});
});
