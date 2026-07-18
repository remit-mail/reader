import assert from "node:assert";
import { describe, it, mock } from "node:test";
import { MessageSystemFlag, StarColor } from "@remit/domain-enums";
import type {
	MessageFlagService,
	MessageService,
	ThreadMessageService,
} from "@remit/remit-electrodb-service";
import type { FlagPushService } from "./flag-push.js";
import { type FlagQueueConfig, FlagQueueService } from "./flag-queue.js";

const createMockMessageFlagService = () => {
	const flags = new Map<string, Set<string>>();
	const calls: Array<{
		op: "add" | "remove";
		messageId: string;
		flag: string;
	}> = [];

	return {
		addFlag: mock.fn(async (messageId: string, flag: string) => {
			calls.push({ op: "add", messageId, flag });
			if (!flags.has(messageId)) {
				flags.set(messageId, new Set());
			}
			flags.get(messageId)?.add(flag);
		}),
		removeFlag: mock.fn(async (messageId: string, flag: string) => {
			calls.push({ op: "remove", messageId, flag });
			flags.get(messageId)?.delete(flag);
		}),
		hasFlag: mock.fn(async (messageId: string, flag: string) => {
			return flags.get(messageId)?.has(flag) ?? false;
		}),
		_flags: flags,
		_calls: calls,
	} as unknown as MessageFlagService & {
		_flags: Map<string, Set<string>>;
		_calls: Array<{ op: "add" | "remove"; messageId: string; flag: string }>;
	};
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

const TEST_ACCOUNT_CONFIG_ID = "test-account-config-id";

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
		findByMessageId: mock.fn(
			async (_accountConfigId: string, messageId: string) => {
				return threadMessages.get(messageId) ?? null;
			},
		),
		findAllByMessageId: mock.fn(
			async (_accountConfigId: string, messageId: string) => {
				const tm = threadMessages.get(messageId);
				return tm ? [tm] : [];
			},
		),
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

const createMockFlagPushService = () => {
	const flips: Array<{
		accountId: string;
		accountConfigId: string;
		messageId: string;
		mailboxId: string;
		flagName: string;
		operation: "add" | "remove";
	}> = [];

	return {
		flip: mock.fn(async (params: (typeof flips)[number]) => {
			flips.push(params);
		}),
		_flips: flips,
	} as unknown as FlagPushService & { _flips: typeof flips };
};

const createTestConfig = (overrides: Partial<FlagQueueConfig> = {}) => {
	const mailboxId = "test-mailbox-id";

	const config: FlagQueueConfig = {
		messageFlagService: createMockMessageFlagService(),
		messageService: createMockMessageService(mailboxId),
		threadMessageService: createMockThreadMessageService(),
		flagPushService: createMockFlagPushService(),
		...overrides,
	};

	const service = new FlagQueueService(config);

	return { service, config, mailboxId };
};

describe("FlagQueueService.updateFlags", () => {
	const messageId = "test-message-id";
	const accountId = "test-account-id";

	it("marks message as read: local addFlag(Seen) + flip(add) via FlagPushService", async () => {
		const { service, config, mailboxId } = createTestConfig();

		const result = await service.updateFlags(
			TEST_ACCOUNT_CONFIG_ID,
			messageId,
			accountId,
			{ isRead: true },
		);

		assert.strictEqual(result.messageId, messageId);
		assert.strictEqual(result.isRead, true);

		const flagService = config.messageFlagService as ReturnType<
			typeof createMockMessageFlagService
		>;
		assert.strictEqual(flagService._calls.length, 1);
		assert.deepStrictEqual(flagService._calls[0], {
			op: "add",
			messageId,
			flag: MessageSystemFlag.Seen,
		});

		const flagPushService = config.flagPushService as ReturnType<
			typeof createMockFlagPushService
		>;
		assert.strictEqual(flagPushService._flips.length, 1);
		assert.deepStrictEqual(flagPushService._flips[0], {
			accountId,
			accountConfigId: TEST_ACCOUNT_CONFIG_ID,
			messageId,
			mailboxId,
			flagName: MessageSystemFlag.Seen,
			operation: "add",
		});
	});

	it("marks message as unread: local removeFlag(Seen) + flip(remove) via FlagPushService", async () => {
		const { service, config } = createTestConfig();

		const flagService = config.messageFlagService as ReturnType<
			typeof createMockMessageFlagService
		>;
		flagService._flags.set(messageId, new Set([MessageSystemFlag.Seen]));

		const result = await service.updateFlags(
			TEST_ACCOUNT_CONFIG_ID,
			messageId,
			accountId,
			{ isRead: false },
		);

		assert.strictEqual(result.isRead, false);
		assert.strictEqual(flagService._calls.at(-1)?.op, "remove");
		assert.strictEqual(flagService._calls.at(-1)?.flag, MessageSystemFlag.Seen);

		const flagPushService = config.flagPushService as ReturnType<
			typeof createMockFlagPushService
		>;
		assert.strictEqual(flagPushService._flips.length, 1);
		assert.strictEqual(flagPushService._flips[0].operation, "remove");
		assert.strictEqual(
			flagPushService._flips[0].flagName,
			MessageSystemFlag.Seen,
		);
	});

	it("the marker flip is persisted BEFORE the local flag write (review finding on #1292 — a crash after must never strand a flipped flag with no marker)", async () => {
		const { service, config } = createTestConfig();

		const flagService = config.messageFlagService as ReturnType<
			typeof createMockMessageFlagService
		>;
		const flagPushService = config.flagPushService as ReturnType<
			typeof createMockFlagPushService
		>;

		const order: string[] = [];
		flagService.addFlag = mock.fn(async () => {
			order.push("local-write");
		}) as unknown as typeof flagService.addFlag;
		flagPushService.flip = mock.fn(async () => {
			order.push("marker-flip");
		}) as unknown as typeof flagPushService.flip;

		await service.updateFlags(TEST_ACCOUNT_CONFIG_ID, messageId, accountId, {
			isRead: true,
		});

		assert.deepStrictEqual(order, ["marker-flip", "local-write"]);
	});

	it("crash window: the marker is already durable even when the SUBSEQUENT local flag write then fails — never a flipped flag with no marker", async () => {
		const { service, config, mailboxId } = createTestConfig();

		const flagService = config.messageFlagService as ReturnType<
			typeof createMockMessageFlagService
		>;
		const flagPushService = config.flagPushService as ReturnType<
			typeof createMockFlagPushService
		>;

		flagService.addFlag = mock.fn(async () => {
			throw new Error("simulated crash after the marker write");
		}) as unknown as typeof flagService.addFlag;

		await assert.rejects(
			service.updateFlags(TEST_ACCOUNT_CONFIG_ID, messageId, accountId, {
				isRead: true,
			}),
			/simulated crash after the marker write/,
		);

		// The marker flip already completed before the failing local write —
		// it is durable regardless of what happens next. A stuck marker with
		// no completed local write is safely recoverable (the caller's
		// natural retry re-applies both steps, idempotently); a flipped flag
		// with NO marker — the defect this fix closes — is now impossible.
		assert.strictEqual(flagPushService._flips.length, 1);
		assert.deepStrictEqual(flagPushService._flips[0], {
			accountId,
			accountConfigId: TEST_ACCOUNT_CONFIG_ID,
			messageId,
			mailboxId,
			flagName: MessageSystemFlag.Seen,
			operation: "add",
		});
	});

	it("passes CURRENT isRead value (not new) to ThreadMessage update composites", async () => {
		const { service, config } = createTestConfig();

		const threadMessageService = config.threadMessageService as ReturnType<
			typeof createMockThreadMessageService
		>;
		threadMessageService._addThreadMessage(messageId, {
			accountConfigId: "test-account-config",
			threadMessageId: "test-thread-message-id",
			mailboxId: "test-mailbox-id",
			sentDate: 1700000000000,
			isRead: false,
			isDeleted: false,
			hasStars: false,
			hasAttachment: false,
		});

		await service.updateFlags(TEST_ACCOUNT_CONFIG_ID, messageId, accountId, {
			isRead: true,
		});

		const updateCalls = (
			threadMessageService.update as unknown as ReturnType<typeof mock.fn>
		).mock.calls;
		assert.strictEqual(updateCalls.length, 1);

		const setArg = updateCalls[0].arguments[2] as { isRead?: boolean };
		assert.strictEqual(setArg.isRead, true, "set() must carry the NEW isRead");

		const optionsArg = updateCalls[0].arguments[3] as {
			composites?: { isRead?: boolean };
		};
		assert.strictEqual(
			optionsArg?.composites?.isRead,
			false,
			"composites.isRead must be the CURRENT value (false), not the new value",
		);
	});

	it("passes CURRENT hasStars value (not new) to ThreadMessage update composites", async () => {
		const { service, config } = createTestConfig();

		const threadMessageService = config.threadMessageService as ReturnType<
			typeof createMockThreadMessageService
		>;
		threadMessageService._addThreadMessage(messageId, {
			accountConfigId: "test-account-config",
			threadMessageId: "test-thread-message-id",
			mailboxId: "test-mailbox-id",
			sentDate: 1700000000000,
			isRead: false,
			isDeleted: false,
			hasStars: false,
			hasAttachment: false,
		});

		await service.updateFlags(TEST_ACCOUNT_CONFIG_ID, messageId, accountId, {
			isStarred: true,
		});

		const updateCalls = (
			threadMessageService.update as unknown as ReturnType<typeof mock.fn>
		).mock.calls;
		assert.strictEqual(updateCalls.length, 1);

		const setArg = updateCalls[0].arguments[2] as { hasStars?: boolean };
		assert.strictEqual(
			setArg.hasStars,
			true,
			"set() must carry the NEW hasStars",
		);

		const optionsArg = updateCalls[0].arguments[3] as {
			composites?: { hasStars?: boolean };
		};
		assert.strictEqual(
			optionsArg?.composites?.hasStars,
			false,
			"composites.hasStars must be the CURRENT value (false), not the new value",
		);
	});

	it("marks message as starred: local addFlag(Flagged) + flip(add)", async () => {
		const { service, config } = createTestConfig();

		const result = await service.updateFlags(
			TEST_ACCOUNT_CONFIG_ID,
			messageId,
			accountId,
			{ isStarred: true },
		);

		assert.strictEqual(result.isStarred, true);

		const flagPushService = config.flagPushService as ReturnType<
			typeof createMockFlagPushService
		>;
		assert.strictEqual(flagPushService._flips.length, 1);
		assert.strictEqual(
			flagPushService._flips[0].flagName,
			MessageSystemFlag.Flagged,
		);
		assert.strictEqual(flagPushService._flips[0].operation, "add");
	});

	it("removes starred flag: local removeFlag(Flagged) + flip(remove)", async () => {
		const { service, config } = createTestConfig();

		const flagService = config.messageFlagService as ReturnType<
			typeof createMockMessageFlagService
		>;
		flagService._flags.set(messageId, new Set([MessageSystemFlag.Flagged]));

		const result = await service.updateFlags(
			TEST_ACCOUNT_CONFIG_ID,
			messageId,
			accountId,
			{ isStarred: false },
		);

		assert.strictEqual(result.isStarred, false);

		const flagPushService = config.flagPushService as ReturnType<
			typeof createMockFlagPushService
		>;
		assert.strictEqual(flagPushService._flips[0].operation, "remove");
	});

	it("updates star color on ThreadMessage without a marker flip (starColor never syncs to IMAP)", async () => {
		const { service, config } = createTestConfig();

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

		await service.updateFlags(TEST_ACCOUNT_CONFIG_ID, messageId, accountId, {
			starColor: StarColor.Blue,
		});

		const updateCalls = (
			threadMessageService.update as unknown as ReturnType<typeof mock.fn>
		).mock.calls;
		assert.strictEqual(updateCalls.length, 1);
		assert.strictEqual(
			(updateCalls[0].arguments[2] as { star?: string }).star,
			StarColor.Blue,
		);

		const flagPushService = config.flagPushService as ReturnType<
			typeof createMockFlagPushService
		>;
		assert.strictEqual(flagPushService._flips.length, 0);
	});

	it("handles multiple flags in a single call — one flip per field", async () => {
		const { service, config } = createTestConfig();

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

		await service.updateFlags(TEST_ACCOUNT_CONFIG_ID, messageId, accountId, {
			isRead: true,
			isStarred: true,
		});

		const flagService = config.messageFlagService as ReturnType<
			typeof createMockMessageFlagService
		>;
		assert.strictEqual(flagService._calls.length, 2);

		const flagPushService = config.flagPushService as ReturnType<
			typeof createMockFlagPushService
		>;
		assert.strictEqual(flagPushService._flips.length, 2);
		const flagNames = flagPushService._flips.map((f) => f.flagName).sort();
		assert.deepStrictEqual(
			flagNames,
			[MessageSystemFlag.Flagged, MessageSystemFlag.Seen].sort(),
		);
	});

	it("does not flip anything when no flag changes are requested", async () => {
		const { service, config } = createTestConfig();

		await service.updateFlags(TEST_ACCOUNT_CONFIG_ID, messageId, accountId, {});

		const flagPushService = config.flagPushService as ReturnType<
			typeof createMockFlagPushService
		>;
		assert.strictEqual(flagPushService._flips.length, 0);
	});

	it("skips ThreadMessage update when not found", async () => {
		const { service, config } = createTestConfig();

		await service.updateFlags(TEST_ACCOUNT_CONFIG_ID, messageId, accountId, {
			isStarred: true,
		});

		const threadMessageService = config.threadMessageService as ReturnType<
			typeof createMockThreadMessageService
		>;
		const updateCalls = (
			threadMessageService.update as unknown as ReturnType<typeof mock.fn>
		).mock.calls;
		assert.strictEqual(updateCalls.length, 0);
	});

	it("updateFlags(isRead: true) on an already-read message is a no-op — no false unseenCount undercount (review finding on #1292)", async () => {
		const { service, config } = createTestConfig();

		const flagService = config.messageFlagService as ReturnType<
			typeof createMockMessageFlagService
		>;
		flagService._flags.set(messageId, new Set([MessageSystemFlag.Seen]));

		const result = await service.updateFlags(
			TEST_ACCOUNT_CONFIG_ID,
			messageId,
			accountId,
			{ isRead: true },
		);

		assert.strictEqual(result.isRead, true);

		const flagPushService = config.flagPushService as ReturnType<
			typeof createMockFlagPushService
		>;
		assert.strictEqual(flagPushService._flips.length, 0);

		const threadMessageService = config.threadMessageService as ReturnType<
			typeof createMockThreadMessageService
		>;
		const updateCalls = (
			threadMessageService.update as unknown as ReturnType<typeof mock.fn>
		).mock.calls;
		assert.strictEqual(
			updateCalls.length,
			0,
			"no redundant ThreadMessage.isRead write either",
		);
	});

	it("never touches mailbox unseenCount — projections are pure (data-flow.md)", async () => {
		// FlagQueueConfig has no `mailboxService` at all anymore: the type
		// system enforces this invariant structurally, this test documents it.
		const { config } = createTestConfig();
		assert.strictEqual("mailboxService" in config, false);
	});
});

describe("FlagQueueService.markAsRead / markAsUnread", () => {
	const messageId = "test-message-id";
	const accountId = "test-account-id";

	it("markAsRead flips Seen -> add", async () => {
		const { service, config, mailboxId } = createTestConfig();

		await service.markAsRead(TEST_ACCOUNT_CONFIG_ID, messageId, accountId);

		const flagPushService = config.flagPushService as ReturnType<
			typeof createMockFlagPushService
		>;
		assert.deepStrictEqual(flagPushService._flips, [
			{
				accountId,
				accountConfigId: TEST_ACCOUNT_CONFIG_ID,
				messageId,
				mailboxId,
				flagName: MessageSystemFlag.Seen,
				operation: "add",
			},
		]);
	});

	it("markAsUnread flips Seen -> remove", async () => {
		const { service, config, mailboxId } = createTestConfig();

		// Message starts read — otherwise "mark unread" is a genuine no-op
		// (already matches the desired state, review finding on #1292).
		const flagService = config.messageFlagService as ReturnType<
			typeof createMockMessageFlagService
		>;
		flagService._flags.set(messageId, new Set([MessageSystemFlag.Seen]));

		await service.markAsUnread(TEST_ACCOUNT_CONFIG_ID, messageId, accountId);

		const flagPushService = config.flagPushService as ReturnType<
			typeof createMockFlagPushService
		>;
		assert.deepStrictEqual(flagPushService._flips, [
			{
				accountId,
				accountConfigId: TEST_ACCOUNT_CONFIG_ID,
				messageId,
				mailboxId,
				flagName: MessageSystemFlag.Seen,
				operation: "remove",
			},
		]);
	});

	it("markAsRead on an ALREADY-read message is a no-op — no marker, no local write, no false unseenCount undercount (review finding on #1292)", async () => {
		const { service, config } = createTestConfig();

		const flagService = config.messageFlagService as ReturnType<
			typeof createMockMessageFlagService
		>;
		flagService._flags.set(messageId, new Set([MessageSystemFlag.Seen]));

		await service.markAsRead(TEST_ACCOUNT_CONFIG_ID, messageId, accountId);

		const flagPushService = config.flagPushService as ReturnType<
			typeof createMockFlagPushService
		>;
		assert.strictEqual(
			flagPushService._flips.length,
			0,
			"a redundant mark-as-read must not write a fresh add-Seen marker — it would falsely subtract from unseenCount at read time",
		);
		assert.strictEqual(
			flagService._calls.length,
			0,
			"no redundant local MessageFlag write either",
		);
	});

	it("markAsUnread on an ALREADY-unread message is a no-op — no marker, no local write", async () => {
		const { service, config } = createTestConfig();

		const flagPushService = config.flagPushService as ReturnType<
			typeof createMockFlagPushService
		>;
		const flagService = config.messageFlagService as ReturnType<
			typeof createMockMessageFlagService
		>;

		await service.markAsUnread(TEST_ACCOUNT_CONFIG_ID, messageId, accountId);

		assert.strictEqual(flagPushService._flips.length, 0);
		assert.strictEqual(flagService._calls.length, 0);
	});
});

describe("FlagQueueService.toggleFlagged", () => {
	const messageId = "test-message-id";
	const accountId = "test-account-id";

	it("adds the Flagged flag and returns true when not currently starred", async () => {
		const { service, config } = createTestConfig();

		const result = await service.toggleFlagged(
			TEST_ACCOUNT_CONFIG_ID,
			messageId,
			accountId,
		);

		assert.strictEqual(result, true);
		const flagPushService = config.flagPushService as ReturnType<
			typeof createMockFlagPushService
		>;
		assert.strictEqual(flagPushService._flips[0].operation, "add");
		assert.strictEqual(
			flagPushService._flips[0].flagName,
			MessageSystemFlag.Flagged,
		);
	});

	it("removes the Flagged flag and returns false when currently starred", async () => {
		const { service, config } = createTestConfig();

		const flagService = config.messageFlagService as ReturnType<
			typeof createMockMessageFlagService
		>;
		flagService._flags.set(messageId, new Set([MessageSystemFlag.Flagged]));

		const result = await service.toggleFlagged(
			TEST_ACCOUNT_CONFIG_ID,
			messageId,
			accountId,
		);

		assert.strictEqual(result, false);
		const flagPushService = config.flagPushService as ReturnType<
			typeof createMockFlagPushService
		>;
		assert.strictEqual(flagPushService._flips[0].operation, "remove");
	});
});
