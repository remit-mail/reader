import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type {
	CreateThreadMessageInput,
	IAddressRepository,
	IEnvelopeRepository,
	IMailboxRepository,
	IMessageRepository,
	IThreadMessageRepository,
	ThreadMessageItem,
} from "@remit/data-ports";
import { MessageSystemFlag } from "@remit/domain-enums";
import type { ManagedConnectionFactory } from "./connection-factory.js";
import { MessageSyncService } from "./message-sync.js";
import type { ImapEnvelope } from "./types.js";

// #44: initial sync hardcoded `hasStars: false` on row create, so mail flagged
// in another client arrived unstarred and never appeared in Flagged. The
// server's \Flagged keyword is the star; these cover the mapping on create.

const ACCOUNT_ID = "acct-1";
const ACCOUNT_CONFIG_ID = "cfg-1";
const MAILBOX_ID = "mbx-1";
const MESSAGE_ID = "msg-1";

const envelope: ImapEnvelope = {
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

/**
 * Capture the ThreadMessage create input the sync path builds. Only `create` is
 * exercised; the rest of the port is unreachable from this code path.
 */
const captureCreate = (): {
	repo: IThreadMessageRepository;
	inputs: CreateThreadMessageInput[];
} => {
	const inputs: CreateThreadMessageInput[] = [];
	const repo = {
		create: async (input: CreateThreadMessageInput) => {
			inputs.push(input);
			return input as unknown as ThreadMessageItem;
		},
	} as unknown as IThreadMessageRepository;
	return { repo, inputs };
};

const stub = <T>(): T => ({}) as T;

/**
 * `createThreadForMessage` is private to the service — it is only ever reached
 * through a live IMAP fetch. Reach it directly so the flag mapping is covered
 * without standing up a server.
 */
type CreateThreadForMessage = (
	threadMessageService: IThreadMessageRepository,
	messageId: string,
	mailboxId: string,
	accountId: string,
	accountConfigId: string,
	uid: number,
	internalDate: number,
	sentDate: number,
	envelope: ImapEnvelope,
	flags: string[],
	references?: string[],
	hasAttachment?: boolean,
) => Promise<void>;

const createThreadWithFlags = async (
	flags: string[],
): Promise<CreateThreadMessageInput> => {
	const service = new MessageSyncService(
		stub<ManagedConnectionFactory>(),
		stub<IMailboxRepository>(),
		stub<IMessageRepository>(),
		stub<IEnvelopeRepository>(),
		stub<IAddressRepository>(),
		stub<IThreadMessageRepository>(),
	);
	const { repo, inputs } = captureCreate();
	const now = Date.now();

	await (
		service as unknown as { createThreadForMessage: CreateThreadForMessage }
	).createThreadForMessage(
		repo,
		MESSAGE_ID,
		MAILBOX_ID,
		ACCOUNT_ID,
		ACCOUNT_CONFIG_ID,
		42,
		now,
		now,
		envelope,
		flags,
	);

	assert.equal(inputs.length, 1);
	const [input] = inputs;
	assert.ok(input);
	return input;
};

describe("message sync maps IMAP flags onto the created ThreadMessage", () => {
	test("a message carrying \\Flagged is created starred", async () => {
		const input = await createThreadWithFlags(["\\Flagged"]);
		assert.equal(input.hasStars, true);
		assert.equal(input.star, "yellow");
	});

	test("a message without \\Flagged is created unstarred", async () => {
		const input = await createThreadWithFlags(["\\Seen"]);
		assert.equal(input.hasStars, false);
		assert.equal(input.star, "none");
	});

	test("\\Flagged and \\Seen are mapped independently", async () => {
		const input = await createThreadWithFlags(["\\Seen", "\\Flagged"]);
		assert.equal(input.isRead, true);
		assert.equal(input.hasStars, true);
	});
});

// #79: the mapping above was correct and still shipped broken. The sync path
// compares a server flag list against these members, so what they hold has to
// be the spelling IMAP puts on the wire — a leading backslash and all. The
// published images carried `Flagged`, the member's *name*, because the emitter
// that generates them was installed unpatched and ate the escape. Every
// comparison then quietly stopped matching: mail flagged on the server arrived
// unstarred, and a star set in the app went out as a custom keyword no other
// client reads. Asserted against literals rather than the enum, because the
// enum is the thing under test.
describe("the generated flag members carry the IMAP wire spelling", () => {
	test("system flags keep their leading backslash", () => {
		assert.equal(MessageSystemFlag.Flagged, "\\Flagged");
		assert.equal(MessageSystemFlag.Seen, "\\Seen");
		assert.equal(MessageSystemFlag.Answered, "\\Answered");
		assert.equal(MessageSystemFlag.Deleted, "\\Deleted");
		assert.equal(MessageSystemFlag.Draft, "\\Draft");
	});

	test("a member's name is never its value", () => {
		for (const [name, value] of Object.entries(MessageSystemFlag)) {
			assert.notEqual(value, name);
		}
	});
});
