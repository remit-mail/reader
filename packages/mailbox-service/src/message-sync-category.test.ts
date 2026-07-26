/**
 * A ThreadMessage row created for a message that is already classified used to
 * start at `uncategorized` and stay there: `denormalizeCategory` runs at
 * body-sync, and body-sync skips a message whose body is already stored. So the
 * second mailbox a message appears in got a permanently stale row (issue #320).
 *
 * The row now carries the category of the Message the same save just wrote. The
 * negative case matters as much as the positive one: a genuinely new,
 * unclassified message must still land `uncategorized` — the declared pending
 * state, which is not `personal` (issue #45).
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
	MessageItem,
	ThreadMessageItem,
} from "@remit/data-ports";
import { MessageCategory } from "@remit/domain-enums";
import type { ManagedConnectionFactory } from "./connection-factory.js";
import { MessageSyncService } from "./message-sync.js";
import type { ImapMessage } from "./types.js";

const envelope = {
	date: new Date(0).toISOString(),
	messageId: "<root@example.com>",
	subject: "Subject",
	from: [{ name: "Sender", mailbox: "sender", host: "example.com" }],
	sender: [],
	replyTo: [],
	to: [],
	cc: [],
	bcc: [],
	inReplyTo: "",
};

const imapMessage = {
	uid: 42,
	seq: 1,
	size: 100,
	internalDate: new Date(0),
	flags: [],
	envelope,
} as unknown as ImapMessage;

const stub = <T>(): T => ({}) as T;

/**
 * Drive the real save path so the value the ThreadMessage gets is the one the
 * Message write returned, not one a test handed to a private method.
 */
const saveIntoMailbox = async (
	storedCategory: MessageItem["category"],
): Promise<CreateThreadMessageInput> => {
	const inputs: CreateThreadMessageInput[] = [];

	const messageService = {
		upsertWithStatus: async (input: CreateMessageInput) => ({
			item: {
				...input,
				category: storedCategory,
			} as unknown as MessageItem,
			created: false,
		}),
	} as unknown as IMessageRepository;

	const threadMessageService = {
		create: async (input: CreateThreadMessageInput) => {
			inputs.push(input);
			return input as unknown as ThreadMessageItem;
		},
	} as unknown as IThreadMessageRepository;

	const envelopeService = {
		upsertEnvelope: async () => {},
		upsertBodyParts: async () => {},
	} as unknown as IEnvelopeRepository;

	const addressService = {
		upsertAddress: async () => {},
		upsertEnvelopeAddress: async () => {},
	} as unknown as IAddressRepository;

	const service = new MessageSyncService(
		stub<ManagedConnectionFactory>(),
		stub<IMailboxRepository>(),
		messageService,
		envelopeService,
		addressService,
		threadMessageService,
	);

	await (
		service as unknown as {
			saveMessage: (
				mailboxId: string,
				accountId: string,
				accountConfigId: string,
				msg: ImapMessage,
			) => Promise<unknown>;
		}
	).saveMessage("mbx-1", "acct-1", "cfg-1", imapMessage);

	assert.equal(inputs.length, 1);
	const [input] = inputs;
	assert.ok(input);
	return input;
};

describe("a created ThreadMessage carries the Message's category", () => {
	it("gives a row for an already-classified message that message's category", async () => {
		const input = await saveIntoMailbox(MessageCategory.newsletter);
		assert.equal(input.category, MessageCategory.newsletter);
	});

	it("leaves a row for a new, unclassified message at uncategorized", async () => {
		const input = await saveIntoMailbox(MessageCategory.uncategorized);
		assert.equal(input.category, MessageCategory.uncategorized);
	});

	it("never substitutes personal for the pending state", async () => {
		const input = await saveIntoMailbox(MessageCategory.uncategorized);
		assert.notEqual(input.category, MessageCategory.personal);
	});
});
