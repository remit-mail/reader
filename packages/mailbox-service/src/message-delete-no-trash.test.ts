import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
	IAddressRepository,
	IMailboxRepository,
	IMailboxSpecialUseRepository,
	IMessageRepository,
	IThreadMessageRepository,
} from "@remit/data-ports";
import type { RoleResolution } from "@remit/data-ports/folder-role";
import {
	type MessageMoveConfig,
	MessageMoveService,
	NoTrashMailboxError,
	StaleTrashAppointmentError,
	UnconfirmedTrashMailboxError,
} from "./message-move.js";
import { NO_JUNK_ROLES } from "./test-helpers/folder-roles.js";

const ACCOUNT = "acc-1";
const ACCOUNT_CONFIG = "cfg-1";
const INBOX = "mbx-inbox";
const TRASH = "mbx-trash";
const MESSAGE_ID = "msg-1";

type TrashMailbox = { mailboxId: string; fullPath: string };

interface EnqueuedEvent {
	operation: string;
	destinationMailboxPath?: string;
}

const buildWorld = (
	trashResolution: RoleResolution<TrashMailbox>,
	startingMailboxId = INBOX,
) => {
	const patches: Array<Record<string, unknown>> = [];
	const events: EnqueuedEvent[] = [];
	const threadMessageDeletes: string[] = [];

	const message = {
		messageId: MESSAGE_ID,
		mailboxId: startingMailboxId,
		uid: 337,
		status: "active",
		syncStatus: "synced",
	};

	const messageService = {
		get: async () => [message],
		update: async (_id: string, patch: Record<string, unknown>) => {
			patches.push(patch);
			return Object.assign(message, patch);
		},
		updateForMove: async (_id: string, patch: Record<string, unknown>) => {
			patches.push(patch);
			return Object.assign(message, patch);
		},
	} as unknown as IMessageRepository;

	const threadMessageService = {
		findAllByMessageId: async () => [],
		getByMessageId: async () => ({
			accountConfigId: ACCOUNT_CONFIG,
			threadMessageId: "tm-1",
			messageId: MESSAGE_ID,
			mailboxId: startingMailboxId,
		}),
		update: async () => {},
		delete: async (_cfg: string, id: string) => {
			threadMessageDeletes.push(id);
		},
	} as unknown as IThreadMessageRepository;

	const mailboxService = {
		get: async () => [
			{ mailboxId: INBOX, fullPath: "INBOX", accountId: ACCOUNT },
			{ mailboxId: TRASH, fullPath: "INBOX/Trash", accountId: ACCOUNT },
		],
	} as unknown as IMailboxRepository;

	const mailboxSpecialUseService = {
		resolveTrashRole: async () => trashResolution,
		resolveJunkRolesForConfig: async () => NO_JUNK_ROLES,
	} as unknown as IMailboxSpecialUseRepository;

	const addressService = {
		reconcileJunkOnlyForMessage: async () => {},
	} as unknown as IAddressRepository;

	const config: MessageMoveConfig = {
		messageService,
		mailboxService,
		mailboxSpecialUseService,
		threadMessageService,
		addressService,
		sqsQueueUrl: "http://localhost:9324/000000000000/remit-messages.fifo",
	};

	const service = new MessageMoveService(config);
	(
		service as unknown as {
			enqueueEventsBatch: (batch: EnqueuedEvent[]) => Promise<void>;
		}
	).enqueueEventsBatch = async (batch) => {
		events.push(...batch);
	};

	return { service, patches, events, message };
};

const flaggedTrash: RoleResolution<TrashMailbox> = {
	kind: "flagged",
	mailbox: { mailboxId: TRASH, fullPath: "INBOX/Trash" },
};

describe("delete only expunges when it was asked to", () => {
	it("moves to a Trash the account resolves under a nested path", async () => {
		const { service, events, message } = buildWorld(flaggedTrash);

		await service.deleteMessages(ACCOUNT_CONFIG, [MESSAGE_ID], ACCOUNT);

		assert.deepEqual(
			events.map((event) => event.operation),
			["move_to_trash"],
		);
		assert.equal(events[0].destinationMailboxPath, "INBOX/Trash");
		assert.equal(message.mailboxId, TRASH);
	});

	it("refuses, and touches nothing, when no Trash resolves", async () => {
		const { service, patches, events, message } = buildWorld({ kind: "none" });

		await assert.rejects(
			() => service.deleteMessages(ACCOUNT_CONFIG, [MESSAGE_ID], ACCOUNT),
			(error: unknown) =>
				error instanceof NoTrashMailboxError &&
				error.statusCode === 409 &&
				error.publicApiError?.details?.reason === "none" &&
				error.message.includes("no Trash folder"),
		);

		assert.deepEqual(events, []);
		assert.deepEqual(patches, []);
		assert.equal(message.mailboxId, INBOX);
		assert.equal(message.status, "active");
	});

	it("refuses a stale appointment rather than filing into the fallback", async () => {
		// #887 Done item 2: the user appointed a folder another client has since
		// deleted. Silently filing 200 messages into the flagged folder overrides
		// a choice they made and cannot see was lost.
		const { service, patches, events, message } = buildWorld({
			kind: "appointment_stale",
			appointedMailboxId: "mbx-appointed-and-gone",
			fallback: flaggedTrash,
		});

		await assert.rejects(
			() => service.deleteMessages(ACCOUNT_CONFIG, [MESSAGE_ID], ACCOUNT),
			(error: unknown) =>
				error instanceof StaleTrashAppointmentError &&
				error.statusCode === 409 &&
				error.publicApiError?.details?.reason === "stale" &&
				error.publicApiError?.details?.accountId === ACCOUNT,
		);

		assert.deepEqual(events, []);
		assert.deepEqual(patches, []);
		assert.equal(message.mailboxId, INBOX);
		assert.equal(message.status, "active");
	});

	it("files into a Trash that resolves by name alone", async () => {
		// A name guess is enough to move mail somewhere retrievable; only the
		// expunge demands more (D4).
		const { service, events, message } = buildWorld({
			kind: "proposed",
			mailbox: { mailboxId: TRASH, fullPath: "Trash" },
		});

		await service.deleteMessages(ACCOUNT_CONFIG, [MESSAGE_ID], ACCOUNT);

		assert.deepEqual(
			events.map((event) => event.operation),
			["move_to_trash"],
		);
		assert.equal(message.mailboxId, TRASH);
	});

	it("expunges only when the caller asked for a permanent delete", async () => {
		// fc685509: an explicit permanent delete never resolves Trash at all, so
		// an account with none can still empty a message it selected.
		const { service, events } = buildWorld({ kind: "none" });

		await service.deleteMessages(ACCOUNT_CONFIG, [MESSAGE_ID], ACCOUNT, {
			permanent: true,
		});

		assert.deepEqual(
			events.map((event) => event.operation),
			["permanent_delete"],
		);
	});

	it("refuses to expunge a message already inside a Trash that only resolves by name", async () => {
		// #876: a message already sitting in the guessed folder used to fall
		// straight through to an expunge, on the same name guess Empty Trash
		// refuses to act on. Deleting it is exactly as unrecoverable, so it
		// demands the same confirmed evidence — nobody, neither the user nor the
		// server, ever said this folder is Trash.
		const { service, patches, events, message } = buildWorld(
			{ kind: "proposed", mailbox: { mailboxId: TRASH, fullPath: "Trash" } },
			TRASH,
		);

		await assert.rejects(
			() => service.deleteMessages(ACCOUNT_CONFIG, [MESSAGE_ID], ACCOUNT),
			(error: unknown) =>
				error instanceof UnconfirmedTrashMailboxError &&
				error.statusCode === 409 &&
				error.publicApiError?.details?.reason === "unconfirmed" &&
				error.publicApiError?.details?.accountId === ACCOUNT,
		);

		assert.deepEqual(events, []);
		assert.deepEqual(patches, []);
		assert.equal(message.mailboxId, TRASH);
	});

	it("expunges a message already inside a confirmed Trash", async () => {
		const { service, events } = buildWorld(flaggedTrash, TRASH);

		await service.deleteMessages(ACCOUNT_CONFIG, [MESSAGE_ID], ACCOUNT);

		assert.deepEqual(
			events.map((event) => event.operation),
			["permanent_delete"],
		);
	});
});
