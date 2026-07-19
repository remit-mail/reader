import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type {
	IMessageFlagRepository,
	IMessageRepository,
	IThreadMessageRepository,
	MessageItem,
	ThreadMessageItem,
	UpdateThreadMessageInput,
} from "@remit/data-ports";
import type { FlagPushService } from "./flag-push.js";
import { FlagQueueService } from "./flag-queue.js";

// #44: `hasStars` is the boolean of record and `star` its presentation colour.
// The UI's star toggle sends only `isStarred`, so a star that left `star` at
// the `none` sentinel disagreed with `hasStars` and every read site that
// consulted the colour rejected the row. The colour now follows the boolean.

const ACCOUNT_CONFIG_ID = "cfg-1";
const ACCOUNT_ID = "acct-1";
const MESSAGE_ID = "msg-1";
const MAILBOX_ID = "mbx-1";
const THREAD_MESSAGE_ID = "tm-1";

const threadMessage = {
	threadMessageId: THREAD_MESSAGE_ID,
	accountConfigId: ACCOUNT_CONFIG_ID,
	mailboxId: MAILBOX_ID,
	sentDate: 1,
	isRead: false,
	isDeleted: false,
	hasStars: false,
	hasAttachment: false,
} as unknown as ThreadMessageItem;

const buildService = (): {
	service: FlagQueueService;
	updates: UpdateThreadMessageInput[];
} => {
	const updates: UpdateThreadMessageInput[] = [];

	const messageService = {
		get: async () => ({ mailboxId: MAILBOX_ID }) as unknown as MessageItem,
	} as unknown as IMessageRepository;

	const messageFlagService = {
		hasFlag: async () => false,
		addFlag: async () => {},
		removeFlag: async () => {},
	} as unknown as IMessageFlagRepository;

	const threadMessageService = {
		findAllByMessageId: async () => [threadMessage],
		update: async (
			_accountConfigId: string,
			_threadMessageId: string,
			input: UpdateThreadMessageInput,
		) => {
			updates.push(input);
			return threadMessage;
		},
	} as unknown as IThreadMessageRepository;

	const flagPushService = {
		flip: async () => {},
	} as unknown as FlagPushService;

	const service = new FlagQueueService({
		messageFlagService,
		messageService,
		threadMessageService,
		flagPushService,
	});

	return { service, updates };
};

describe("updateFlags keeps hasStars and the star colour in step", () => {
	test("starring without a colour sets both the boolean and a visible colour", async () => {
		const { service, updates } = buildService();

		await service.updateFlags(ACCOUNT_CONFIG_ID, MESSAGE_ID, ACCOUNT_ID, {
			isStarred: true,
		});

		assert.deepEqual(updates, [{ hasStars: true, star: "yellow" }]);
	});

	test("unstarring clears the colour back to the none sentinel", async () => {
		const { service, updates } = buildService();

		await service.updateFlags(ACCOUNT_CONFIG_ID, MESSAGE_ID, ACCOUNT_ID, {
			isStarred: false,
		});

		assert.deepEqual(updates, [{ hasStars: false, star: "none" }]);
	});

	test("an explicit colour wins over the default", async () => {
		const { service, updates } = buildService();

		await service.updateFlags(ACCOUNT_CONFIG_ID, MESSAGE_ID, ACCOUNT_ID, {
			isStarred: true,
			starColor: "red",
		});

		assert.deepEqual(updates, [{ hasStars: true, star: "red" }]);
	});

	test("a colour change alone does not touch the boolean", async () => {
		const { service, updates } = buildService();

		await service.updateFlags(ACCOUNT_CONFIG_ID, MESSAGE_ID, ACCOUNT_ID, {
			starColor: "blue",
		});

		assert.deepEqual(updates, [{ star: "blue" }]);
	});
});
