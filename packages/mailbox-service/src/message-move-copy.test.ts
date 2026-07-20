import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
	IMailboxRepository,
	IMailboxSpecialUseRepository,
	IMessageRepository,
	IThreadMessageRepository,
} from "@remit/data-ports";
import { deriveCopyMessageId, deriveMessageId } from "@remit/data-ports/id";
import { type MessageMoveConfig, MessageMoveService } from "./message-move.js";

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
		create: async (input: Record<string, unknown>) => {
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

	return { service, threadRows, messages, sent };
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

	it("copy then sync reconciles: a replayed copy converges on one row, no duplicate", async () => {
		const { service, threadRows, messages } = buildWorld();

		await service.copyMessages(
			ACCOUNT_CONFIG,
			[SOURCE_ID],
			DEST_MAILBOX,
			ACCOUNT,
		);
		// A replay (retried COPY event, or the user copying the same mail again)
		// re-derives the same id, so the idempotent create is a no-op.
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
