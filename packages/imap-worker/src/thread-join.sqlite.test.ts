import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
	IMailboxRepository,
	IMailboxSpecialUseRepository,
	MailboxItem,
} from "@remit/data-ports";
import { deriveThreadId } from "@remit/data-ports/id";
import {
	AddressRepo,
	DrizzleEnvelopeRepository,
	DrizzleMessageRepository,
	DrizzleThreadMessageRepository,
	SyncWarningRepo,
} from "@remit/drizzle-service";
import { createShippedSqliteDb } from "@remit/drizzle-service/test-sqlite";
import { MessageSyncService, SyncWarningService } from "@remit/mailbox-service";
import type { ImapMessage } from "@remit/mailbox-service/types";

const ACCOUNT = "acct-1";
const CONFIG = "cfg-1";
const MAILBOX = { mailboxId: "mbx-1", fullPath: "INBOX" } as MailboxItem;
const ROLES = {
	junkMailboxId: null,
	trashMailboxId: null,
	configJunkRoles: { junkMailboxIds: [], trashMailboxIds: [] },
};

const message = (
	uid: number,
	messageId: string,
	inReplyTo: string,
	references?: string[],
): ImapMessage =>
	({
		uid,
		seq: uid,
		size: 100,
		internalDate: new Date(uid * 1000),
		flags: [],
		references,
		envelope: {
			date: new Date(uid * 1000).toISOString(),
			messageId,
			subject: `Subject ${uid}`,
			from: [{ name: "Sender", mailbox: "sender", host: "example.com" }],
			sender: [],
			replyTo: [],
			to: [],
			cc: [],
			bcc: [],
			inReplyTo,
		},
	}) as unknown as ImapMessage;

const PARENT = message(1, "<p@example.com>", "<a@example.com>", [
	"<a@example.com>",
]);
const REPLY = message(2, "<r@example.com>", "<p@example.com>");

const syncInOrder = async (
	messages: ImapMessage[],
): Promise<{ threadIds: (messageId: string) => string[] }> => {
	const { db, sqlite } = createShippedSqliteDb();
	const typed = db as unknown as ConstructorParameters<
		typeof DrizzleMessageRepository
	>[0];
	const service = new MessageSyncService(
		{} as never,
		{} as IMailboxRepository,
		{} as IMailboxSpecialUseRepository,
		new DrizzleMessageRepository(typed),
		new DrizzleEnvelopeRepository(typed),
		new AddressRepo(db as never),
		new DrizzleThreadMessageRepository(db),
		new SyncWarningService(new SyncWarningRepo(db as never)),
	);
	const save = (
		service as unknown as {
			saveMessage: (...args: unknown[]) => Promise<unknown>;
		}
	).saveMessage.bind(service);
	for (const msg of messages) {
		await save(MAILBOX, ACCOUNT, CONFIG, msg, ROLES, {
			departed: new Set(),
			settled: new Set(),
		});
	}
	return {
		threadIds: (messageIdHeader) =>
			(
				sqlite
					.prepare(
						"SELECT thread_id FROM thread_message WHERE message_id_header = ?",
					)
					.all(messageIdHeader) as { thread_id: string }[]
			).map((row) => row.thread_id),
	};
};

describe("a reply naming only its parent, which is itself a reply", () => {
	const rootThread = deriveThreadId(CONFIG, "<a@example.com>");

	it("joins the root's thread when the parent synced first", async () => {
		const { threadIds } = await syncInOrder([PARENT, REPLY]);
		assert.deepEqual(threadIds("<r@example.com>"), [rootThread]);
	});

	it("joins the root's thread when it synced before its parent, and stays there on a re-save", async () => {
		const { threadIds } = await syncInOrder([REPLY, PARENT, REPLY]);
		assert.deepEqual(threadIds("<r@example.com>"), [rootThread]);
		assert.deepEqual(threadIds("<p@example.com>"), [rootThread]);
	});
});
