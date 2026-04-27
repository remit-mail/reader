import assert from "node:assert";
import { describe, it, mock } from "node:test";
import type {
	MailboxService,
	MailboxSpecialUseService,
	MessageService,
	ThreadMessageService,
} from "@remit/remit-electrodb-service";
import { type MessageMoveConfig, MessageMoveService } from "./message-move.js";

// Tests for issue #212 — delete leaves stale row in inbox list.
//
// `deleteMessages({ permanent: true })` must remove ThreadMessage rows
// optimistically so the inbox list never shows a row whose backing Message
// is being hard-deleted. `deleteMessages({ toTrash: true })` must flip the
// row's `mailboxId` to Trash and set `isDeleted: true` so the inbox query
// (with `excludeDeleted: true`) excludes it.

interface FakeThreadMessageRow {
	accountConfigId: string;
	threadMessageId: string;
	messageId: string;
	mailboxId: string;
	sentDate: number;
	isRead: boolean;
	isDeleted: boolean;
	hasStars: boolean;
	hasAttachment: boolean;
}

const aliceAccountConfigId = "alice-config-aaaaaaaaaa";
const aliceAccountId = "alice-account-aaaaaaaaaa";
const inboxId = "alice-inbox-aaaaaaaaaaaa";
const trashId = "alice-trash-aaaaaaaaaaaa";

const createMockMessageService = (
	rows: Array<{ messageId: string; mailboxId: string; uid: number }>,
) => {
	const messages = new Map(rows.map((r) => [r.messageId, { ...r }]));
	return {
		get: mock.fn(async (idOrIds: string | string[]) => {
			if (Array.isArray(idOrIds)) {
				return idOrIds
					.map((id) => messages.get(id))
					.filter(
						(m): m is { messageId: string; mailboxId: string; uid: number } =>
							Boolean(m),
					);
			}
			const msg = messages.get(idOrIds);
			if (!msg) throw new Error(`Message not found: ${idOrIds}`);
			return msg;
		}),
		update: mock.fn(async (_messageId: string, _input: unknown) => undefined),
		updateForMove: mock.fn(
			async (_messageId: string, _input: unknown) => undefined,
		),
		delete: mock.fn(async (_messageId: string) => undefined),
		_messages: messages,
	} as unknown as MessageService & {
		_messages: Map<
			string,
			{ messageId: string; mailboxId: string; uid: number }
		>;
	};
};

const createMockMailboxService = (
	mailboxes: Array<{ mailboxId: string; fullPath: string }>,
) => {
	const map = new Map(mailboxes.map((m) => [m.mailboxId, m]));
	return {
		get: mock.fn(async (idOrIds: string | string[]) => {
			if (Array.isArray(idOrIds)) {
				return idOrIds
					.map((id) => map.get(id))
					.filter((m): m is { mailboxId: string; fullPath: string } =>
						Boolean(m),
					);
			}
			const mb = map.get(idOrIds);
			if (!mb) throw new Error(`Mailbox not found: ${idOrIds}`);
			return mb;
		}),
	} as unknown as MailboxService;
};

const createMockMailboxSpecialUseService = (
	trash: { mailboxId: string; fullPath: string } | null,
) =>
	({
		findTrashMailbox: mock.fn(async () => trash),
	}) as unknown as MailboxSpecialUseService;

const createMockThreadMessageService = (rows: FakeThreadMessageRow[]) => {
	const byKey = new Map<string, FakeThreadMessageRow>();
	for (const row of rows) {
		byKey.set(row.threadMessageId, { ...row });
	}

	const findAllByMessageId = mock.fn(async (messageId: string) =>
		Array.from(byKey.values()).filter((r) => r.messageId === messageId),
	);

	const getByMessageId = mock.fn(async (messageId: string) => {
		const row = Array.from(byKey.values()).find(
			(r) => r.messageId === messageId,
		);
		if (!row) throw new Error(`ThreadMessage not found for ${messageId}`);
		return row;
	});

	const update = mock.fn(
		async (
			_accountConfigId: string,
			threadMessageId: string,
			input: Record<string, unknown>,
			_options?: unknown,
		) => {
			const row = byKey.get(threadMessageId);
			if (!row) throw new Error(`row missing: ${threadMessageId}`);
			Object.assign(row, input);
			return row;
		},
	);

	const deleteRow = mock.fn(
		async (_accountConfigId: string, threadMessageId: string) => {
			byKey.delete(threadMessageId);
		},
	);

	return {
		findAllByMessageId,
		getByMessageId,
		update,
		delete: deleteRow,
		_rows: byKey,
	} as unknown as ThreadMessageService & {
		_rows: Map<string, FakeThreadMessageRow>;
	};
};

const createMockSqs = () => {
	const sent: unknown[] = [];
	return {
		send: mock.fn(async (cmd: { input: unknown }) => {
			sent.push(cmd.input);
			return { MessageId: "ok" };
		}),
		_sent: sent,
	};
};

const createTestService = (overrides: {
	messages: Array<{ messageId: string; mailboxId: string; uid: number }>;
	mailboxes: Array<{ mailboxId: string; fullPath: string }>;
	trash: { mailboxId: string; fullPath: string } | null;
	threadMessageRows: FakeThreadMessageRow[];
}) => {
	const messageService = createMockMessageService(overrides.messages);
	const mailboxService = createMockMailboxService(overrides.mailboxes);
	const mailboxSpecialUseService = createMockMailboxSpecialUseService(
		overrides.trash,
	);
	const threadMessageService = createMockThreadMessageService(
		overrides.threadMessageRows,
	);
	const mockSqs = createMockSqs();

	const config: MessageMoveConfig = {
		messageService,
		mailboxService,
		mailboxSpecialUseService,
		threadMessageService,
		sqsQueueUrl: "http://localhost:4566/test-queue",
	};

	const service = new MessageMoveService(config);
	// @ts-expect-error - replace SQS client with mock
	service.sqs = mockSqs;

	return {
		service,
		messageService,
		mailboxService,
		mailboxSpecialUseService,
		threadMessageService,
		mockSqs,
	};
};

describe("MessageMoveService.deleteMessages move-to-trash (#212)", () => {
	it("flips ThreadMessage mailboxId to Trash and sets isDeleted=true (optimistic)", async () => {
		const messageId = "alice-msg-1-aaaaaaaaaaaa";
		const threadMessageId = "alice-tm-1-aaaaaaaaaaaaa";

		const ctx = createTestService({
			messages: [{ messageId, mailboxId: inboxId, uid: 42 }],
			mailboxes: [
				{ mailboxId: inboxId, fullPath: "INBOX" },
				{ mailboxId: trashId, fullPath: "Trash" },
			],
			trash: { mailboxId: trashId, fullPath: "Trash" },
			threadMessageRows: [
				{
					accountConfigId: aliceAccountConfigId,
					threadMessageId,
					messageId,
					mailboxId: inboxId,
					sentDate: 1700000000000,
					isRead: false,
					isDeleted: false,
					hasStars: false,
					hasAttachment: false,
				},
			],
		});

		await ctx.service.deleteMessages([messageId], aliceAccountId, {
			toTrash: true,
		});

		const row = ctx.threadMessageService._rows.get(threadMessageId);
		assert.ok(row, "row must still exist (move-to-trash, not permanent)");
		assert.equal(
			row.mailboxId,
			trashId,
			"mailboxId must flip to Trash so the inbox listing excludes it",
		);
		assert.equal(
			row.isDeleted,
			true,
			"isDeleted must flip to true so excludeDeleted-aware queries hide it",
		);
	});
});

describe("MessageMoveService.deleteMessages permanent-delete (#212)", () => {
	it("deletes ThreadMessage row up-front so the inbox list stops showing it", async () => {
		const messageId = "alice-msg-2-aaaaaaaaaaaa";
		const threadMessageId = "alice-tm-2-aaaaaaaaaaaaa";

		const ctx = createTestService({
			messages: [{ messageId, mailboxId: inboxId, uid: 7 }],
			mailboxes: [{ mailboxId: inboxId, fullPath: "INBOX" }],
			trash: null,
			threadMessageRows: [
				{
					accountConfigId: aliceAccountConfigId,
					threadMessageId,
					messageId,
					mailboxId: inboxId,
					sentDate: 1700000000000,
					isRead: true,
					isDeleted: false,
					hasStars: false,
					hasAttachment: false,
				},
			],
		});

		await ctx.service.deleteMessages([messageId], aliceAccountId, {
			permanent: true,
		});

		assert.equal(
			ctx.threadMessageService._rows.has(threadMessageId),
			false,
			"ThreadMessage row must be deleted in the optimistic step (#212)",
		);

		const deleteCalls = (
			ctx.threadMessageService.delete as unknown as ReturnType<typeof mock.fn>
		).mock.calls;
		assert.equal(
			deleteCalls.length,
			1,
			"threadMessage.delete must be called exactly once for the single row",
		);
	});

	it("deletes EVERY ThreadMessage row when a message exists in multiple mailboxes", async () => {
		// A single Message can have one ThreadMessage row per mailbox copy
		// (e.g. INBOX + a Label folder). Permanent delete must clean up ALL of
		// them — using `findByMessageId` would leave orphans behind. #212 fix
		// plan step 4.
		const messageId = "alice-msg-multi-aaaaaaaaa";
		const tmInInbox = "alice-tm-multi-1-aaaaaaaa";
		const tmInLabel = "alice-tm-multi-2-aaaaaaaa";
		const labelId = "alice-label-aaaaaaaaaaaa";

		const ctx = createTestService({
			messages: [{ messageId, mailboxId: inboxId, uid: 9 }],
			mailboxes: [{ mailboxId: inboxId, fullPath: "INBOX" }],
			trash: null,
			threadMessageRows: [
				{
					accountConfigId: aliceAccountConfigId,
					threadMessageId: tmInInbox,
					messageId,
					mailboxId: inboxId,
					sentDate: 1700000000000,
					isRead: true,
					isDeleted: false,
					hasStars: false,
					hasAttachment: false,
				},
				{
					accountConfigId: aliceAccountConfigId,
					threadMessageId: tmInLabel,
					messageId,
					mailboxId: labelId,
					sentDate: 1700000000000,
					isRead: true,
					isDeleted: false,
					hasStars: false,
					hasAttachment: false,
				},
			],
		});

		await ctx.service.deleteMessages([messageId], aliceAccountId, {
			permanent: true,
		});

		assert.equal(
			ctx.threadMessageService._rows.has(tmInInbox),
			false,
			"INBOX row must be deleted",
		);
		assert.equal(
			ctx.threadMessageService._rows.has(tmInLabel),
			false,
			"Label row must be deleted (regression for #212 multi-mailbox cleanup)",
		);
	});
});
