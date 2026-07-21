import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
	IAddressRepository,
	IEnvelopeRepository,
	IMailboxRepository,
	IMailboxSpecialUseRepository,
	IMessageRepository,
	IThreadMessageRepository,
	IUnitOfWork,
} from "@remit/data-ports";
import { CreateFailedConflictError } from "@remit/data-ports/errors";
import { deriveCopyMessageId, deriveMessageId } from "@remit/data-ports/id";
import { MailboxCursorState } from "@remit/domain-enums";
import type { ManagedConnectionFactory } from "./connection-factory.js";
import { type MessageMoveConfig, MessageMoveService } from "./message-move.js";
import { MessageSyncService } from "./message-sync.js";
import type { IImapConnection, ImapMessage } from "./types.js";

// A copy is a per-folder placement of the same mail. These tests pin the three
// properties issue #75 turns on: the copy row is deterministic (idempotent), a
// delete removes exactly the placement it targets, and neither the copy nor the
// original leaves an unreachable row behind.

const ACCOUNT = "acc-1";
const ACCOUNT_CONFIG = "cfg-1";
const SOURCE_MAILBOX = "mbx-inbox";
const DEST_MAILBOX = "mbx-archive";
const HEADER = "<abc@example.com>";
const SOURCE_ID = deriveMessageId(ACCOUNT, HEADER);
const THREAD_ID = "thread-1";

interface ThreadRow {
	accountConfigId: string;
	threadMessageId: string;
	threadId: string;
	messageId: string;
	mailboxId: string;
	messageIdHeader: string;
	isRead?: boolean;
	hasStars?: boolean;
}

const buildWorld = () => {
	const messages = new Map<string, Record<string, unknown>>([
		[
			SOURCE_ID,
			{
				messageId: SOURCE_ID,
				mailboxId: SOURCE_MAILBOX,
				uid: 42,
				rfc822Size: 100,
				internalDate: 1_700_000_000_000,
				messageIdHeader: HEADER,
				envelopeId: "env-1",
				rootBodyPartId: "body-1",
				bodyStorageKey: "s3://body-1",
				category: "primary",
				hasListUnsubscribe: false,
			},
		],
	]);

	const threadRows: ThreadRow[] = [
		{
			accountConfigId: ACCOUNT_CONFIG,
			threadMessageId: `tm:${THREAD_ID}::${SOURCE_ID}`,
			threadId: THREAD_ID,
			messageId: SOURCE_ID,
			mailboxId: SOURCE_MAILBOX,
			messageIdHeader: HEADER,
			isRead: false,
			hasStars: false,
		},
	];

	const mailboxes = new Map<string, Record<string, unknown>>([
		[
			SOURCE_MAILBOX,
			{ mailboxId: SOURCE_MAILBOX, fullPath: "INBOX", accountId: ACCOUNT },
		],
		[
			DEST_MAILBOX,
			{ mailboxId: DEST_MAILBOX, fullPath: "Archive", accountId: ACCOUNT },
		],
	]);

	const messageService = {
		get: async (id: string | string[]) => {
			if (Array.isArray(id)) {
				return id.map((i) => messages.get(i)).filter(Boolean);
			}
			const m = messages.get(id);
			if (!m) throw new Error(`no message ${id}`);
			return m;
		},
		// Faithful to the production repo: a duplicate messageId throws a
		// conflict. create is NOT idempotent — only upsert is — so a copy path
		// that relied on create swallowing the duplicate would strand the second
		// attempt here (issue #75). The copy path uses upsert for exactly this
		// reason.
		create: async (input: Record<string, unknown>) => {
			const id = input.messageId as string;
			if (messages.has(id)) {
				throw new CreateFailedConflictError("Message", input);
			}
			messages.set(id, { ...input });
			return messages.get(id);
		},
		upsert: async (input: Record<string, unknown>) => {
			const id = input.messageId as string;
			if (!messages.has(id)) messages.set(id, { ...input });
			return messages.get(id);
		},
		update: async (id: string, patch: Record<string, unknown>) => {
			const m = messages.get(id);
			if (m) Object.assign(m, patch);
			return m;
		},
	} as unknown as IMessageRepository;

	const threadMessageService = {
		create: async (input: Record<string, unknown>) => {
			const threadId = input.threadId as string;
			const messageId = input.messageId as string;
			const existing = threadRows.find(
				(r) => r.threadId === threadId && r.messageId === messageId,
			);
			if (existing) return existing;
			const row: ThreadRow = {
				accountConfigId: input.accountConfigId as string,
				threadMessageId: `tm:${threadId}::${messageId}`,
				threadId,
				messageId,
				mailboxId: input.mailboxId as string,
				messageIdHeader: input.messageIdHeader as string,
			};
			threadRows.push(row);
			return row;
		},
		getByMessageId: async (_cfg: string, messageId: string) => {
			const row = threadRows.find((r) => r.messageId === messageId);
			if (!row) throw new Error(`no thread message ${messageId}`);
			return row;
		},
		findByMessageId: async (_cfg: string, messageId: string) =>
			threadRows.find((r) => r.messageId === messageId) ?? null,
		findAllByMessageId: async (_cfg: string, messageId: string) =>
			threadRows.filter((r) => r.messageId === messageId),
		delete: async (_cfg: string, threadMessageId: string) => {
			const idx = threadRows.findIndex(
				(r) => r.threadMessageId === threadMessageId,
			);
			if (idx >= 0) threadRows.splice(idx, 1);
		},
	} as unknown as IThreadMessageRepository;

	const mailboxService = {
		get: async (_acc: string, id: string | string[]) => {
			if (Array.isArray(id)) {
				return id.map((i) => mailboxes.get(i)).filter(Boolean);
			}
			return mailboxes.get(id);
		},
	} as unknown as IMailboxRepository;

	// No Trash configured, so deleteMessages takes the permanent-delete path —
	// the branch that eagerly removes ThreadMessage rows (issue #212), which is
	// where a copy's placement row must be reachable.
	const mailboxSpecialUseService = {
		findTrashMailbox: async () => null,
	} as unknown as IMailboxSpecialUseRepository;

	const config: MessageMoveConfig = {
		messageService,
		mailboxService,
		mailboxSpecialUseService,
		threadMessageService,
		sqsQueueUrl: "http://localhost:9324/000000000000/message-mgmt",
	};

	const service = new MessageMoveService(config);
	// The service builds a real SQS producer in its constructor; a unit test has
	// no queue, so swap in a recorder.
	const sent: unknown[] = [];
	(
		service as unknown as { sqs: { send: (c: unknown) => Promise<unknown> } }
	).sqs = {
		send: async (command: unknown) => {
			sent.push(command);
			return {};
		},
	};

	return {
		service,
		threadRows,
		messages,
		sent,
		messageService,
		threadMessageService,
	};
};

// A message copied into the destination folder, as IMAP later enumerates it:
// same valid Message-ID header as the source, a real server UID. Sync derives
// its identity from that header (folder-independent), so the id it computes is
// the ORIGINAL's — not the copy's folder-scoped id.
const destinationServerMessage = (uid: number): ImapMessage =>
	({
		uid,
		seq: uid,
		flags: [],
		internalDate: new Date("2023-11-14T22:13:20Z"),
		size: 100,
		modseq: "510",
		envelope: {
			date: "Tue, 14 Nov 2023 22:13:20 +0000",
			subject: "Hello",
			from: [{ mailbox: "sender", host: "example.com" }],
			sender: [],
			replyTo: [],
			to: [{ mailbox: "me", host: "example.com" }],
			cc: [],
			bcc: [],
			inReplyTo: "",
			messageId: HEADER,
		},
	}) as ImapMessage;

// A MessageSyncService that reads and writes the SAME rows the copy produced,
// so "copy then sync" is exercised against one shared world. A stored envelope
// with a valid Message-ID takes the CHANGEDSINCE path; anything the round tries
// to create lands in the shared maps, so a duplicate would be visible to the
// caller's row-count assertions.
const buildSyncOverDestination = (
	world: ReturnType<typeof buildWorld>,
	changed: ImapMessage[],
) => {
	const destMailbox = {
		mailboxId: DEST_MAILBOX,
		accountId: ACCOUNT,
		fullPath: "Archive",
		uidValidity: 100,
		lastSyncUid: 1,
		highWaterMarkUid: 20,
		highestModseq: "500",
		cursorState: MailboxCursorState.normal,
	};

	const connection = {
		openBox: async () => ({ uidvalidity: 100, uidnext: 99 }),
		getMailboxStatus: async () => ({
			messages: 10,
			recent: 0,
			unseen: 1,
			uidNext: 99,
			uidValidity: 100,
			highestModseq: "600",
			deletedCount: 0,
		}),
		supportsCondstore: () => true,
		fetchMessagesChangedSince: async () => changed,
		search: async () => [],
		fetchMessages: async () => [],
		fetchEnvelopeSnapshots: async () => [],
	} as unknown as IImapConnection;

	const connectionFactory = {
		getConnection: () => connection,
		close: async () => {},
	} as ManagedConnectionFactory;

	const mailboxService = {
		get: async () => destMailbox,
		update: async () => destMailbox,
	} as unknown as IMailboxRepository;

	// A create that reaches DynamoDB would append to the shared maps, so the
	// caller's "nothing accumulated" assertions catch a regression that mints a
	// third row.
	const unitOfWork: IUnitOfWork = {
		transaction: (fn) =>
			fn({
				message: world.messageService,
				envelope: {
					upsertEnvelope: async () => undefined,
					upsertBodyParts: async () => undefined,
				} as unknown as IEnvelopeRepository,
				address: {
					upsertAddress: async () => undefined,
					upsertEnvelopeAddress: async () => undefined,
				} as unknown as IAddressRepository,
				threadMessage: world.threadMessageService,
			}),
	};

	return new MessageSyncService(
		connectionFactory,
		mailboxService,
		world.messageService,
		{} as IEnvelopeRepository,
		{} as IAddressRepository,
		world.threadMessageService,
		undefined,
		unitOfWork,
	);
};

describe("MessageMoveService.copyMessage — deterministic per-folder identity (#75)", () => {
	it("derives the copy id from source + destination, not at random", async () => {
		const { service, threadRows } = buildWorld();

		await service.copyMessages(
			ACCOUNT_CONFIG,
			[SOURCE_ID],
			DEST_MAILBOX,
			ACCOUNT,
		);

		const expected = deriveCopyMessageId(SOURCE_ID, DEST_MAILBOX);
		const copyRow = threadRows.find((r) => r.mailboxId === DEST_MAILBOX);
		assert.ok(copyRow, "a placement row exists in the destination folder");
		assert.equal(copyRow.messageId, expected);
	});

	it("a replayed copy converges on one row, no duplicate", async () => {
		const { service, threadRows, messages } = buildWorld();

		await service.copyMessages(
			ACCOUNT_CONFIG,
			[SOURCE_ID],
			DEST_MAILBOX,
			ACCOUNT,
		);
		// A replay (retried COPY event, or the user copying the same mail again)
		// re-derives the same id. The copy path upserts, so the second write is a
		// no-op on the existing row rather than the CreateFailedConflictError a
		// plain create would throw — the operation is idempotent.
		await service.copyMessages(
			ACCOUNT_CONFIG,
			[SOURCE_ID],
			DEST_MAILBOX,
			ACCOUNT,
		);

		const copyId = deriveCopyMessageId(SOURCE_ID, DEST_MAILBOX);
		assert.equal(
			threadRows.filter((r) => r.messageId === copyId).length,
			1,
			"exactly one copy row after a replay",
		);
		assert.equal(
			threadRows.length,
			2,
			"the original and one copy — nothing accumulates",
		);
		assert.equal(messages.has(copyId), true);
	});

	it("copy then a destination-folder sync creates no third row", async () => {
		const world = buildWorld();

		await world.service.copyMessages(
			ACCOUNT_CONFIG,
			[SOURCE_ID],
			DEST_MAILBOX,
			ACCOUNT,
		);

		const copyId = deriveCopyMessageId(SOURCE_ID, DEST_MAILBOX);
		assert.equal(world.threadRows.length, 2, "original plus one copy");
		assert.equal(world.messages.size, 2, "original plus one copy");

		// IMAP now enumerates the copied message in the destination folder. Sync
		// derives its id from the valid Message-ID header — the folder-independent
		// original id, not the copy's — finds the existing original row, and takes
		// the flag-only branch. The crux of #75: no third or duplicate row.
		const sync = buildSyncOverDestination(world, [
			destinationServerMessage(77),
		]);
		const result = await sync.syncMessages(
			DEST_MAILBOX,
			ACCOUNT,
			ACCOUNT_CONFIG,
		);

		assert.equal(result.syncedCount, 0, "sync created no new message");
		assert.equal(
			world.threadRows.length,
			2,
			"still original plus the copy — sync added nothing",
		);
		assert.equal(
			world.messages.size,
			2,
			"still original plus the copy — sync added nothing",
		);
		assert.equal(
			world.threadRows.filter((r) => r.messageId === copyId).length,
			1,
			"the copy row is untouched",
		);
	});

	it("copy then delete of the copy removes the copy row and leaves the original", async () => {
		const { service, threadRows } = buildWorld();

		await service.copyMessages(
			ACCOUNT_CONFIG,
			[SOURCE_ID],
			DEST_MAILBOX,
			ACCOUNT,
		);
		const copyId = deriveCopyMessageId(SOURCE_ID, DEST_MAILBOX);

		await service.deleteMessages(ACCOUNT_CONFIG, [copyId], ACCOUNT, {
			permanent: true,
		});

		assert.equal(
			threadRows.some((r) => r.messageId === copyId),
			false,
			"copy row removed",
		);
		assert.equal(
			threadRows.some((r) => r.messageId === SOURCE_ID),
			true,
			"original row survives",
		);
	});

	it("copy then delete of the original removes the original and leaves the copy — no orphan of the wrong row", async () => {
		const { service, threadRows } = buildWorld();

		await service.copyMessages(
			ACCOUNT_CONFIG,
			[SOURCE_ID],
			DEST_MAILBOX,
			ACCOUNT,
		);
		const copyId = deriveCopyMessageId(SOURCE_ID, DEST_MAILBOX);

		await service.deleteMessages(ACCOUNT_CONFIG, [SOURCE_ID], ACCOUNT, {
			permanent: true,
		});

		assert.equal(
			threadRows.some((r) => r.messageId === SOURCE_ID),
			false,
			"original row removed",
		);
		assert.equal(
			threadRows.some((r) => r.messageId === copyId),
			true,
			"copy row survives its own delete boundary",
		);
	});

	it("a copy into two folders is two distinct, reachable rows", async () => {
		const { service, threadRows } = buildWorld();

		await service.copyMessages(
			ACCOUNT_CONFIG,
			[SOURCE_ID],
			DEST_MAILBOX,
			ACCOUNT,
		);
		await service.copyMessages(
			ACCOUNT_CONFIG,
			[SOURCE_ID],
			SOURCE_MAILBOX,
			ACCOUNT,
		);

		const idArchive = deriveCopyMessageId(SOURCE_ID, DEST_MAILBOX);
		const idInbox = deriveCopyMessageId(SOURCE_ID, SOURCE_MAILBOX);
		assert.notEqual(idArchive, idInbox);
		assert.equal(threadRows.filter((r) => r.messageId === idArchive).length, 1);
		assert.equal(threadRows.filter((r) => r.messageId === idInbox).length, 1);
	});
});
