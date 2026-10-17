/**
 * Reader sent its replies with `In-Reply-To: <<id>>` and `References: <<id>>`,
 * and sync keyed the thread on the header as written — so each reply, and any
 * answer whose client copied the References, opened a thread of its own beside
 * the message it answered. These save the parent and the misspelt answers
 * through the real save path and compare the threads they land in.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
	CreateMessageInput,
	CreateThreadMessageInput,
	IAddressRepository,
	IEnvelopeRepository,
	IMailboxRepository,
	IMessageRepository,
	IThreadMessageRepository,
	MailboxItem,
	MessageItem,
	ThreadMessageItem,
} from "@remit/data-ports";
import type { ManagedConnectionFactory } from "./connection-factory.js";
import { type AccountFolderRoles, MessageSyncService } from "./message-sync.js";
import { NO_FOLDER_ROLES, noFolderRoles } from "./test-helpers/folder-roles.js";
import type { ImapMessage } from "./types.js";

const stub = <T>(): T => ({}) as T;

const message = (
	uid: number,
	headers: { messageId: string; inReplyTo?: string; references?: string[] },
): ImapMessage =>
	({
		uid,
		seq: uid,
		size: 100,
		internalDate: new Date(uid * 1000),
		flags: [],
		references: headers.references,
		envelope: {
			date: new Date(uid * 1000).toISOString(),
			messageId: headers.messageId,
			subject: "Subject",
			from: [{ name: "Sender", mailbox: "sender", host: "example.com" }],
			sender: [],
			replyTo: [],
			to: [],
			cc: [],
			bcc: [],
			inReplyTo: headers.inReplyTo ?? "",
		},
	}) as unknown as ImapMessage;

const threadRowsFor = async (
	messages: ImapMessage[],
): Promise<CreateThreadMessageInput[]> => {
	const rows: CreateThreadMessageInput[] = [];

	const messageService = {
		upsertWithStatus: async (input: CreateMessageInput) => ({
			item: { ...input, category: "uncategorized" } as unknown as MessageItem,
			created: true,
		}),
	} as unknown as IMessageRepository;

	const threadMessageService = {
		create: async (input: CreateThreadMessageInput) => {
			rows.push(input);
			return input as unknown as ThreadMessageItem;
		},
	} as unknown as IThreadMessageRepository;

	const service = new MessageSyncService(
		stub<ManagedConnectionFactory>(),
		stub<IMailboxRepository>(),
		noFolderRoles,
		messageService,
		{
			upsertEnvelope: async () => {},
			upsertBodyParts: async () => {},
		} as unknown as IEnvelopeRepository,
		{
			upsertCorrespondentAddress: async () => {},
			upsertEnvelopeAddress: async () => {},
		} as unknown as IAddressRepository,
		threadMessageService,
	);

	const save = (
		service as unknown as {
			saveMessage: (
				mailbox: MailboxItem,
				accountId: string,
				accountConfigId: string,
				msg: ImapMessage,
				roles: AccountFolderRoles,
			) => Promise<unknown>;
		}
	).saveMessage.bind(service);

	for (const msg of messages) {
		await save(
			{ mailboxId: "mbx-1", fullPath: "INBOX" } as MailboxItem,
			"acct-1",
			"cfg-1",
			msg,
			NO_FOLDER_ROLES,
		);
	}
	return rows;
};

describe("a misspelt parent Message-ID threads with the parent", () => {
	it("joins the parent's thread when In-Reply-To doubles its brackets", async () => {
		const [parent, reply] = await threadRowsFor([
			message(1, { messageId: "<parent@example.com>" }),
			message(2, {
				messageId: "<reply@example.com>",
				inReplyTo: "<<parent@example.com>>",
			}),
		]);

		assert.equal(reply?.threadId, parent?.threadId);
		assert.equal(reply?.inReplyTo, "<parent@example.com>");
	});

	it("joins the parent's thread when References doubles its brackets", async () => {
		const [parent, answer] = await threadRowsFor([
			message(1, { messageId: "<parent@example.com>" }),
			message(2, {
				messageId: "<answer@example.com>",
				inReplyTo: "<reply@example.com>",
				references: ["<<parent@example.com>>", "<reply@example.com>"],
			}),
		]);

		assert.equal(answer?.threadId, parent?.threadId);
	});

	it("keeps an unrelated message in a thread of its own", async () => {
		const [parent, other] = await threadRowsFor([
			message(1, { messageId: "<parent@example.com>" }),
			message(2, { messageId: "<other@example.com>" }),
		]);

		assert.notEqual(other?.threadId, parent?.threadId);
	});
});
