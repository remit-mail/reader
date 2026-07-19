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
import { MessageSystemFlag } from "@remit/domain-enums";
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

const buildService = ({
	alreadyFlagged = false,
}: {
	alreadyFlagged?: boolean;
} = {}): {
	service: FlagQueueService;
	updates: UpdateThreadMessageInput[];
	flips: Array<{ flagName: string; operation: string }>;
} => {
	const updates: UpdateThreadMessageInput[] = [];
	const flips: Array<{ flagName: string; operation: string }> = [];

	const messageService = {
		get: async () => ({ mailboxId: MAILBOX_ID }) as unknown as MessageItem,
	} as unknown as IMessageRepository;

	const messageFlagService = {
		hasFlag: async (_messageId: string, flagName: string) =>
			flagName === MessageSystemFlag.Flagged ? alreadyFlagged : false,
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
		flip: async (event: { flagName: string; operation: string }) => {
			flips.push({ flagName: event.flagName, operation: event.operation });
		},
	} as unknown as FlagPushService;

	const service = new FlagQueueService({
		messageFlagService,
		messageService,
		threadMessageService,
		flagPushService,
	});

	return { service, updates, flips };
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
		const { service, updates } = buildService({ alreadyFlagged: true });

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

	// A colour-only request is legal on the wire. Before, it wrote the colour
	// and left `hasStars` alone, so a coloured-but-unstarred row rendered
	// unstarred, stayed out of Starred, and never pushed \Flagged.
	test("a colour alone stars the message and pushes the flag", async () => {
		const { service, updates, flips } = buildService();

		await service.updateFlags(ACCOUNT_CONFIG_ID, MESSAGE_ID, ACCOUNT_ID, {
			starColor: "blue",
		});

		assert.deepEqual(updates, [{ hasStars: true, star: "blue" }]);
		assert.deepEqual(flips, [
			{ flagName: MessageSystemFlag.Flagged, operation: "add" },
		]);
	});

	test("the none colour unstars the message", async () => {
		const { service, updates, flips } = buildService({ alreadyFlagged: true });

		await service.updateFlags(ACCOUNT_CONFIG_ID, MESSAGE_ID, ACCOUNT_ID, {
			starColor: "none",
		});

		assert.deepEqual(updates, [{ hasStars: false, star: "none" }]);
		assert.deepEqual(flips, [
			{ flagName: MessageSystemFlag.Flagged, operation: "remove" },
		]);
	});

	test("isStarred decides the boolean when both fields are sent", async () => {
		const { service, updates } = buildService();

		await service.updateFlags(ACCOUNT_CONFIG_ID, MESSAGE_ID, ACCOUNT_ID, {
			isStarred: true,
			starColor: "none",
		});

		assert.deepEqual(updates, [{ hasStars: true, star: "none" }]);
	});

	test("starring pushes the Flagged keyword", async () => {
		const { service, flips } = buildService();

		await service.updateFlags(ACCOUNT_CONFIG_ID, MESSAGE_ID, ACCOUNT_ID, {
			isStarred: true,
		});

		assert.deepEqual(flips, [
			{ flagName: MessageSystemFlag.Flagged, operation: "add" },
		]);
	});
});
