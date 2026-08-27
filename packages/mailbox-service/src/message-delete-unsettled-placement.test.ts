/**
 * Issue #845 item 3. While a placement move is in flight the Message row names
 * the destination folder but still carries the SOURCE folder's uid, so a delete
 * that binds the pair as it stands sends the worker to expunge the destination
 * folder's own message at that uid — an unrelated message, destroyed for good.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
	IAddressRepository,
	IMailboxRepository,
	IMailboxSpecialUseRepository,
	IMessageRepository,
	IThreadMessageRepository,
} from "@remit/data-ports";
import { MessagePlacementUnsettledError } from "@remit/data-ports/errors";
import type { RoleResolution } from "@remit/data-ports/folder-role";
import { MessageMoveService } from "./message-move.js";

const ACCOUNT = "acc-1";
const ACCOUNT_CONFIG = "cfg-1";
const INBOX = "mbx-inbox";
const ARCHIVE = "mbx-archive";
const TRASH = "mbx-trash";
const MESSAGE_ID = "msg-1";
const INBOX_UID = 42;
const ARCHIVE_UID = 907;

type TrashMailbox = { mailboxId: string; fullPath: string };

const flaggedTrash: RoleResolution<TrashMailbox> = {
	kind: "flagged",
	mailbox: { mailboxId: TRASH, fullPath: "INBOX/Trash" },
};

interface CapturedEvent {
	type: string;
	operation?: string;
	mailboxId?: string;
	mailboxPath?: string;
	uid?: number;
	sourceMailboxPath?: string;
}

const mailboxes = [
	{ mailboxId: INBOX, fullPath: "INBOX", accountId: ACCOUNT },
	{ mailboxId: ARCHIVE, fullPath: "Archive", accountId: ACCOUNT },
	{ mailboxId: TRASH, fullPath: "INBOX/Trash", accountId: ACCOUNT },
];

const buildWorld = () => {
	const patches: Array<Record<string, unknown>> = [];
	const events: CapturedEvent[] = [];

	// The row mid-move: Archive is already written, the uid is still INBOX's.
	const message = {
		messageId: MESSAGE_ID,
		mailboxId: ARCHIVE,
		uid: INBOX_UID,
		status: "moving",
		syncStatus: "pending",
		rfc822Size: 10,
		internalDate: 1,
		messageIdHeader: "<a@b>",
		envelopeId: "env-1",
		rootBodyPartId: "bp-1",
		bodyStorageKey: "key-1",
		category: "primary",
		hasListUnsubscribe: false,
	};

	// What the reconciler writes when the IMAP move lands: Archive's own
	// COPYUID, and the status back to active.
	const settle = () => {
		Object.assign(message, { uid: ARCHIVE_UID, status: "active" });
	};

	const messageService = {
		get: async (ids: string | string[]) =>
			Array.isArray(ids) ? [message] : message,
		update: async (_id: string, patch: Record<string, unknown>) => {
			patches.push(patch);
			return Object.assign(message, patch);
		},
		updateForMove: async (_id: string, patch: Record<string, unknown>) => {
			patches.push(patch);
			return Object.assign(message, patch);
		},
		upsert: async (row: Record<string, unknown>) => row,
	} as unknown as IMessageRepository;

	const threadMessageService = {
		findAllByMessageId: async () => [],
		getByMessageId: async () => ({
			accountConfigId: ACCOUNT_CONFIG,
			threadMessageId: "tm-1",
			messageId: MESSAGE_ID,
			threadId: "thr-1",
			mailboxId: message.mailboxId,
			sentDate: 1,
			isRead: false,
			isDeleted: false,
			hasStars: false,
			hasAttachment: false,
		}),
		create: async () => {},
		update: async () => {},
		delete: async () => {},
	} as unknown as IThreadMessageRepository;

	const mailboxService = {
		get: async (_accountId: string, ids: string | string[]) =>
			Array.isArray(ids)
				? mailboxes.filter((mailbox) => ids.includes(mailbox.mailboxId))
				: mailboxes.find((mailbox) => mailbox.mailboxId === ids),
	} as unknown as IMailboxRepository;

	const mailboxSpecialUseService = {
		resolveTrashRole: async () => flaggedTrash,
		findTrashMailbox: async () => flaggedTrash.mailbox,
	} as unknown as IMailboxSpecialUseRepository;

	const addressService = {
		reconcileJunkOnlyForMessage: async () => {},
	} as unknown as IAddressRepository;

	const service = new MessageMoveService({
		messageService,
		mailboxService,
		mailboxSpecialUseService,
		threadMessageService,
		addressService,
		sqsQueueUrl: "http://localhost:9324/000000000000/remit-messages.fifo",
		moveSettleTimeoutMs: 200,
		moveSettlePollMs: 10,
	});

	const stubs = service as unknown as {
		enqueueEventsBatch: (batch: CapturedEvent[]) => Promise<void>;
		enqueueEvent: (event: CapturedEvent) => Promise<void>;
	};
	stubs.enqueueEventsBatch = async (batch) => {
		events.push(...batch);
	};
	stubs.enqueueEvent = async (event) => {
		events.push(event);
	};

	return { service, patches, events, message, settle };
};

describe("a delete never binds the folder/uid pair of an unsettled move (#845.3)", () => {
	it("binds the confirmed pair once the earlier move settles", async () => {
		const { service, events, settle } = buildWorld();

		setTimeout(settle, 30);
		await service.deleteMessages(ACCOUNT_CONFIG, [MESSAGE_ID], ACCOUNT);

		assert.equal(events.length, 1);
		assert.equal(events[0].operation, "move_to_trash");
		assert.equal(
			events[0].mailboxPath,
			"Archive",
			"the folder the confirmed move left the message in",
		);
		assert.equal(
			events[0].uid,
			ARCHIVE_UID,
			"and that folder's own uid, never the source folder's",
		);
	});

	it("refuses the delete, and touches nothing, when the move never settles", async () => {
		const { service, patches, events, message } = buildWorld();

		await assert.rejects(
			() => service.deleteMessages(ACCOUNT_CONFIG, [MESSAGE_ID], ACCOUNT),
			(error: unknown) =>
				error instanceof MessagePlacementUnsettledError &&
				error.statusCode === 409 &&
				error.publicApiError?.code === "message_placement_unsettled" &&
				error.publicApiError?.details?.messageId === MESSAGE_ID &&
				error.publicApiError?.details?.accountId === ACCOUNT,
		);

		assert.deepEqual(events, [], "nothing was enqueued");
		assert.deepEqual(patches, [], "and no local write was made");
		assert.equal(message.uid, INBOX_UID);
		assert.equal(message.status, "moving");
	});

	it("refuses the whole batch, expunging no part of it, on one unsettled row", async () => {
		const { service, patches, events } = buildWorld();

		await assert.rejects(
			() =>
				service.deleteMessages(ACCOUNT_CONFIG, [MESSAGE_ID], ACCOUNT, {
					permanent: true,
				}),
			MessagePlacementUnsettledError,
		);

		assert.deepEqual(events, []);
		assert.deepEqual(patches, []);
	});

	it("copies from the confirmed pair once the earlier move settles", async () => {
		const { service, events, settle } = buildWorld();

		setTimeout(settle, 30);
		await service.copyMessage(ACCOUNT_CONFIG, MESSAGE_ID, INBOX, ACCOUNT);

		assert.equal(events.length, 1);
		assert.equal(events[0].type, "MESSAGE_COPY");
		assert.equal(events[0].sourceMailboxPath, "Archive");
		assert.equal(events[0].uid, ARCHIVE_UID);
	});

	it("refuses the copy when the move never settles", async () => {
		const { service, events } = buildWorld();

		await assert.rejects(
			() => service.copyMessage(ACCOUNT_CONFIG, MESSAGE_ID, INBOX, ACCOUNT),
			MessagePlacementUnsettledError,
		);

		assert.deepEqual(events, []);
	});

	it("leaves a settled row's delete untouched", async () => {
		const { service, events, settle } = buildWorld();

		settle();
		await service.deleteMessages(ACCOUNT_CONFIG, [MESSAGE_ID], ACCOUNT);

		assert.equal(events.length, 1);
		assert.equal(events[0].uid, ARCHIVE_UID);
	});
});
