import assert from "node:assert";
import { describe, it, mock } from "node:test";
import type {
	MessageFlagService,
	MessageService,
	ThreadMessageService,
} from "@remit/remit-electrodb-service";
import { MessageSystemFlag, StarColor } from "@remit/domain-enums";
import { type FlagQueueConfig, FlagQueueService } from "./flag-queue.js";

const createMockMessageFlagService = () => {
	const flags = new Map<string, Set<string>>();

	return {
		addFlag: mock.fn(async (messageId: string, flag: string) => {
			if (!flags.has(messageId)) {
				flags.set(messageId, new Set());
			}
			flags.get(messageId)?.add(flag);
		}),
		removeFlag: mock.fn(async (messageId: string, flag: string) => {
			flags.get(messageId)?.delete(flag);
		}),
		hasFlag: mock.fn(async (messageId: string, flag: string) => {
			return flags.get(messageId)?.has(flag) ?? false;
		}),
		_flags: flags,
	} as unknown as MessageFlagService & { _flags: Map<string, Set<string>> };
};

const createMockMessageService = (mailboxId: string) => {
	return {
		get: mock.fn(async (messageId: string) => ({
			messageId,
			mailboxId,
			uid: 1,
		})),
	} as unknown as MessageService;
};

const createMockThreadMessageService = () => {
	const threadMessages = new Map<
		string,
		{
			accountConfigId: string;
			threadMessageId: string;
			messageId: string;
			mailboxId: string;
			sentDate: number;
			isRead: boolean;
			isDeleted: boolean;
			hasStars: boolean;
			hasAttachment: boolean;
			star?: string;
		}
	>();

	return {
		findByMessageId: mock.fn(async (messageId: string) => {
			return threadMessages.get(messageId) ?? null;
		}),
		update: mock.fn(
			async (
				_accountConfigId: string,
				_threadMessageId: string,
				updates: Record<string, unknown>,
			) => {
				return updates;
			},
		),
		_threadMessages: threadMessages,
		_addThreadMessage: (
			messageId: string,
			data: {
				accountConfigId: string;
				threadMessageId: string;
				mailboxId: string;
				sentDate: number;
				isRead: boolean;
				isDeleted: boolean;
				hasStars: boolean;
				hasAttachment: boolean;
				star?: string;
			},
		) => {
			threadMessages.set(messageId, { messageId, ...data });
		},
	} as unknown as ThreadMessageService & {
		_threadMessages: Map<string, Record<string, unknown>>;
		_addThreadMessage: (
			messageId: string,
			data: Record<string, unknown>,
		) => void;
	};
};

const createMockSQSClient = () => {
	const sentMessages: Array<{ QueueUrl: string; MessageBody: string }> = [];

	return {
		send: mock.fn(
			async (command: { input: { QueueUrl: string; MessageBody: string } }) => {
				sentMessages.push(command.input);
				return { MessageId: "test-message-id" };
			},
		),
		_sentMessages: sentMessages,
	};
};

const createTestConfig = (overrides: Partial<FlagQueueConfig> = {}) => {
	const mailboxId = "test-mailbox-id";
	const mockSQS = createMockSQSClient();

	const config: FlagQueueConfig & { _mockSQS: typeof mockSQS } = {
		messageFlagService: createMockMessageFlagService(),
		messageService: createMockMessageService(mailboxId),
		threadMessageService: createMockThreadMessageService(),
		sqsQueueUrl: "http://localhost:4566/test-queue",
		_mockSQS: mockSQS,
		...overrides,
	};

	// Inject mock SQS client
	const service = new FlagQueueService(config);
	// @ts-expect-error - accessing private for testing
	service.sqs = mockSQS;

	return { service, config, mockSQS };
};

describe("FlagQueueService.updateFlags", () => {
	const messageId = "test-message-id";
	const accountId = "test-account-id";

	it("marks message as read when isRead is true", async () => {
		const { service, config } = createTestConfig();

		const result = await service.updateFlags(messageId, accountId, {
			isRead: true,
		});

		assert.strictEqual(result.messageId, messageId);
		assert.strictEqual(result.isRead, true);

		// Verify addFlag was called with Seen
		const flagService = config.messageFlagService as ReturnType<
			typeof createMockMessageFlagService
		>;
		const addFlagCalls = (
			flagService.addFlag as unknown as ReturnType<typeof mock.fn>
		).mock.calls;
		assert.strictEqual(addFlagCalls.length, 1);
		assert.strictEqual(addFlagCalls[0].arguments[0], messageId);
		assert.strictEqual(addFlagCalls[0].arguments[1], MessageSystemFlag.Seen);
	});

	it("marks message as unread when isRead is false", async () => {
		const { service, config } = createTestConfig();

		// Pre-set the flag so hasFlag returns true after
		const flagService = config.messageFlagService as ReturnType<
			typeof createMockMessageFlagService
		>;
		flagService._flags.set(messageId, new Set([MessageSystemFlag.Seen]));

		const result = await service.updateFlags(messageId, accountId, {
			isRead: false,
		});

		assert.strictEqual(result.messageId, messageId);
		assert.strictEqual(result.isRead, false);

		// Verify removeFlag was called with Seen
		const removeFlagCalls = (
			flagService.removeFlag as unknown as ReturnType<typeof mock.fn>
		).mock.calls;
		assert.strictEqual(removeFlagCalls.length, 1);
		assert.strictEqual(removeFlagCalls[0].arguments[0], messageId);
		assert.strictEqual(removeFlagCalls[0].arguments[1], MessageSystemFlag.Seen);
	});

	it("marks message as starred when isStarred is true", async () => {
		const { service, config, mockSQS } = createTestConfig();

		const result = await service.updateFlags(messageId, accountId, {
			isStarred: true,
		});

		assert.strictEqual(result.messageId, messageId);
		assert.strictEqual(result.isStarred, true);

		// Verify addFlag was called with Flagged
		const flagService = config.messageFlagService as ReturnType<
			typeof createMockMessageFlagService
		>;
		const addFlagCalls = (
			flagService.addFlag as unknown as ReturnType<typeof mock.fn>
		).mock.calls;
		assert.strictEqual(addFlagCalls.length, 1);
		assert.strictEqual(addFlagCalls[0].arguments[0], messageId);
		assert.strictEqual(addFlagCalls[0].arguments[1], MessageSystemFlag.Flagged);

		// Verify SQS message was sent
		assert.strictEqual(mockSQS._sentMessages.length, 1);
		const event = JSON.parse(mockSQS._sentMessages[0].MessageBody);
		assert.strictEqual(event.type, "SYNC_FLAGS");
		assert.strictEqual(event.accountId, accountId);
		assert.strictEqual(event.operations[0].flagName, MessageSystemFlag.Flagged);
		assert.strictEqual(event.operations[0].operation, "add");
	});

	it("removes starred flag when isStarred is false", async () => {
		const { service, config } = createTestConfig();

		// Pre-set the flag
		const flagService = config.messageFlagService as ReturnType<
			typeof createMockMessageFlagService
		>;
		flagService._flags.set(messageId, new Set([MessageSystemFlag.Flagged]));

		const result = await service.updateFlags(messageId, accountId, {
			isStarred: false,
		});

		assert.strictEqual(result.messageId, messageId);
		assert.strictEqual(result.isStarred, false);

		// Verify removeFlag was called with Flagged
		const removeFlagCalls = (
			flagService.removeFlag as unknown as ReturnType<typeof mock.fn>
		).mock.calls;
		assert.strictEqual(removeFlagCalls.length, 1);
		assert.strictEqual(removeFlagCalls[0].arguments[0], messageId);
		assert.strictEqual(
			removeFlagCalls[0].arguments[1],
			MessageSystemFlag.Flagged,
		);
	});

	it("updates star color on ThreadMessage", async () => {
		const { service, config } = createTestConfig();

		// Add a thread message
		const threadMessageService = config.threadMessageService as ReturnType<
			typeof createMockThreadMessageService
		>;
		threadMessageService._addThreadMessage(messageId, {
			accountConfigId: "test-account-config",
			threadMessageId: "test-thread-message-id",
			mailboxId: "test-mailbox-id",
			sentDate: Date.now(),
			isRead: false,
			isDeleted: false,
			hasStars: false,
			hasAttachment: false,
		});

		await service.updateFlags(messageId, accountId, {
			starColor: StarColor.Blue,
		});

		// Verify update was called with star color
		const updateCalls = (
			threadMessageService.update as unknown as ReturnType<typeof mock.fn>
		).mock.calls;
		assert.strictEqual(updateCalls.length, 1);
		assert.strictEqual(
			(updateCalls[0].arguments[2] as { star?: string }).star,
			StarColor.Blue,
		);
	});

	it("updates both isStarred and starColor together", async () => {
		const { service, config } = createTestConfig();

		// Add a thread message
		const threadMessageService = config.threadMessageService as ReturnType<
			typeof createMockThreadMessageService
		>;
		threadMessageService._addThreadMessage(messageId, {
			accountConfigId: "test-account-config",
			threadMessageId: "test-thread-message-id",
			mailboxId: "test-mailbox-id",
			sentDate: Date.now(),
			isRead: false,
			isDeleted: false,
			hasStars: false,
			hasAttachment: false,
		});

		await service.updateFlags(messageId, accountId, {
			isStarred: true,
			starColor: StarColor.Red,
		});

		// Verify update was called with both hasStars and star
		const updateCalls = (
			threadMessageService.update as unknown as ReturnType<typeof mock.fn>
		).mock.calls;
		assert.strictEqual(updateCalls.length, 1);
		assert.strictEqual(
			(updateCalls[0].arguments[2] as { hasStars?: boolean }).hasStars,
			true,
		);
		assert.strictEqual(
			(updateCalls[0].arguments[2] as { star?: string }).star,
			StarColor.Red,
		);
	});

	it("handles multiple flags in single call", async () => {
		const { service, config, mockSQS } = createTestConfig();

		// Add a thread message
		const threadMessageService = config.threadMessageService as ReturnType<
			typeof createMockThreadMessageService
		>;
		threadMessageService._addThreadMessage(messageId, {
			accountConfigId: "test-account-config",
			threadMessageId: "test-thread-message-id",
			mailboxId: "test-mailbox-id",
			sentDate: Date.now(),
			isRead: false,
			isDeleted: false,
			hasStars: false,
			hasAttachment: false,
		});

		await service.updateFlags(messageId, accountId, {
			isRead: true,
			isStarred: true,
		});

		// Verify both flags were added
		const flagService = config.messageFlagService as ReturnType<
			typeof createMockMessageFlagService
		>;
		const addFlagCalls = (
			flagService.addFlag as unknown as ReturnType<typeof mock.fn>
		).mock.calls;
		assert.strictEqual(addFlagCalls.length, 2);

		// Verify SQS event contains both operations
		assert.strictEqual(mockSQS._sentMessages.length, 1);
		const event = JSON.parse(mockSQS._sentMessages[0].MessageBody);
		assert.strictEqual(event.operations.length, 2);
	});

	it("does not enqueue SQS event when no flag changes", async () => {
		const { service, mockSQS } = createTestConfig();

		// Call with empty input
		await service.updateFlags(messageId, accountId, {});

		// Verify no SQS message was sent
		assert.strictEqual(mockSQS._sentMessages.length, 0);
	});

	it("skips ThreadMessage update when not found", async () => {
		const { service, config } = createTestConfig();

		// Don't add a thread message - it should skip the update

		await service.updateFlags(messageId, accountId, {
			isStarred: true,
		});

		// Verify update was NOT called
		const threadMessageService = config.threadMessageService as ReturnType<
			typeof createMockThreadMessageService
		>;
		const updateCalls = (
			threadMessageService.update as unknown as ReturnType<typeof mock.fn>
		).mock.calls;
		assert.strictEqual(updateCalls.length, 0);
	});
});
