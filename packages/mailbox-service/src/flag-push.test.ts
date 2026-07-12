import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import type { IMessageFlagPushRepository } from "@remit/data-ports";
import { MessageSystemFlag } from "@remit/domain-enums";
import { type FlagPushConfig, FlagPushService } from "./flag-push.js";

const accountId = "acc-1";
const accountConfigId = "acc-cfg-1";
const messageId = "msg-1";
const mailboxId = "mbx-1";

const createMockSqs = (impl?: () => Promise<unknown>) => {
	const sent: unknown[] = [];
	return {
		send: mock.fn(async (cmd: { input: unknown }) => {
			if (impl) await impl();
			sent.push(cmd.input);
			return { MessageId: "ok" };
		}),
		_sent: sent,
	};
};

interface Harness {
	service: FlagPushService;
	markerPuts: Array<Record<string, unknown>>;
	markerStateUpdates: Array<{
		messageId: string;
		flagName: string;
		state: string;
	}>;
	mockSqs: ReturnType<typeof createMockSqs>;
	logs: { info: unknown[]; error: unknown[] };
}

const createHarness = (opts?: {
	sqsImpl?: () => Promise<unknown>;
	queueUrl?: string;
	updateStateImpl?: () => Promise<unknown>;
	findImpl?: () => Promise<unknown>;
}): Harness => {
	const markerPuts: Array<Record<string, unknown>> = [];
	const markerStateUpdates: Array<{
		messageId: string;
		flagName: string;
		state: string;
	}> = [];
	const logs = { info: [] as unknown[], error: [] as unknown[] };

	const markerService: IMessageFlagPushRepository = {
		put: mock.fn(async (input: Record<string, unknown>) => {
			markerPuts.push(input);
			return {
				...input,
				state: "pending",
				createdAt: 1,
				updatedAt: 1,
			} as never;
		}),
		find: mock.fn(async () =>
			opts?.findImpl ? ((await opts.findImpl()) as never) : null,
		),
		updateState: mock.fn(
			async (id: string, flagName: string, state: string) => {
				if (opts?.updateStateImpl) return opts.updateStateImpl() as never;
				markerStateUpdates.push({ messageId: id, flagName, state });
				return {} as never;
			},
		),
		delete: mock.fn(async () => {}),
		listByAccountId: mock.fn(async () => []),
		listByMailboxId: mock.fn(async () => []),
	};

	const mockSqs = createMockSqs(opts?.sqsImpl);

	const config: FlagPushConfig = {
		markerService,
		sqsQueueUrl: opts?.queueUrl ?? "http://localhost:4566/test-queue",
		logger: {
			info: (fields: Record<string, unknown>) => {
				logs.info.push(fields);
			},
			error: (fields: Record<string, unknown>) => {
				logs.error.push(fields);
			},
		},
	};

	const service = new FlagPushService(config);
	// @ts-expect-error - inject mock SQS client for testing
	service.sqs = mockSqs;

	return { service, markerPuts, markerStateUpdates, mockSqs, logs };
};

describe("FlagPushService.flip", () => {
	it("persists a pending marker before enqueueing the wake-up hint", async () => {
		const { service, markerPuts } = createHarness();

		await service.flip({
			accountId,
			accountConfigId,
			messageId,
			mailboxId,
			flagName: MessageSystemFlag.Seen,
			operation: "add",
		});

		assert.equal(markerPuts.length, 1);
		assert.deepEqual(markerPuts[0], {
			messageId,
			flagName: MessageSystemFlag.Seen,
			accountId,
			accountConfigId,
			mailboxId,
			operation: "add",
		});
	});

	it("advances the marker to queued once the SQS hint is confirmed sent", async () => {
		const { service, markerStateUpdates } = createHarness();

		await service.flip({
			accountId,
			accountConfigId,
			messageId,
			mailboxId,
			flagName: MessageSystemFlag.Flagged,
			operation: "remove",
		});

		assert.deepEqual(markerStateUpdates, [
			{ messageId, flagName: MessageSystemFlag.Flagged, state: "queued" },
		]);
	});

	it("does NOT reject flip when the wake-up hint enqueue fails (queue down)", async () => {
		const { service } = createHarness({
			sqsImpl: () => {
				throw Object.assign(new Error(""), {
					name: "AggregateError",
					code: "ECONNREFUSED",
				});
			},
		});

		await assert.doesNotReject(
			service.flip({
				accountId,
				accountConfigId,
				messageId,
				mailboxId,
				flagName: MessageSystemFlag.Seen,
				operation: "add",
			}),
		);
	});

	it("leaves the marker in `pending` (never advances to queued) when the hint enqueue fails", async () => {
		const { service, markerStateUpdates } = createHarness({
			sqsImpl: () => {
				throw new Error("ECONNREFUSED");
			},
		});

		await service.flip({
			accountId,
			accountConfigId,
			messageId,
			mailboxId,
			flagName: MessageSystemFlag.Seen,
			operation: "add",
		});

		assert.deepEqual(markerStateUpdates, []);
	});

	it("logs the enqueue failure loudly with an alertable field (not silent)", async () => {
		const { service, logs } = createHarness({
			sqsImpl: () => {
				throw Object.assign(new Error(""), {
					name: "AggregateError",
					code: "ECONNREFUSED",
				});
			},
		});

		await service.flip({
			accountId,
			accountConfigId,
			messageId,
			mailboxId,
			flagName: MessageSystemFlag.Seen,
			operation: "add",
		});

		const alerted = logs.error.find(
			(entry) =>
				(entry as { alert?: string }).alert === "flag_push_hint_enqueue_failed",
		);
		assert.ok(
			alerted,
			"expected an alertable flag_push_hint_enqueue_failed log",
		);
		assert.equal((alerted as { errorCode?: string }).errorCode, "ECONNREFUSED");
	});

	it("does NOT leak an unhandled rejection onto a concurrent caller when the enqueue fails", async () => {
		const leaked: unknown[] = [];
		const onUnhandled = (reason: unknown): void => {
			leaked.push(reason);
		};
		process.on("unhandledRejection", onUnhandled);

		const { service } = createHarness({
			sqsImpl: () =>
				new Promise((_resolve, reject) => {
					setImmediate(() =>
						reject(
							Object.assign(new Error(""), {
								name: "AggregateError",
								code: "ECONNREFUSED",
							}),
						),
					);
				}),
		});

		try {
			void service.flip({
				accountId,
				accountConfigId,
				messageId,
				mailboxId,
				flagName: MessageSystemFlag.Seen,
				operation: "add",
			});
			await new Promise((resolve) => setImmediate(resolve));
			await new Promise((resolve) => setImmediate(resolve));
			await new Promise((resolve) => setImmediate(resolve));
		} finally {
			process.off("unhandledRejection", onUnhandled);
		}

		assert.equal(leaked.length, 0);
	});

	it("sets MessageGroupId=accountId for FIFO queue URLs", async () => {
		const { service, mockSqs } = createHarness({
			queueUrl:
				"https://sqs.eu-west-1.amazonaws.com/123456789012/remit-dev-mailboxes.fifo",
		});

		await service.flip({
			accountId,
			accountConfigId,
			messageId,
			mailboxId,
			flagName: MessageSystemFlag.Seen,
			operation: "add",
		});

		assert.equal(mockSqs._sent.length, 1);
		const sent = mockSqs._sent[0] as { MessageGroupId?: string };
		assert.equal(sent.MessageGroupId, accountId);
	});

	it("omits FIFO params for standard queue URLs", async () => {
		const { service, mockSqs } = createHarness({
			queueUrl:
				"https://sqs.eu-west-1.amazonaws.com/123456789012/remit-dev-mailboxes",
		});

		await service.flip({
			accountId,
			accountConfigId,
			messageId,
			mailboxId,
			flagName: MessageSystemFlag.Seen,
			operation: "add",
		});

		assert.equal(mockSqs._sent.length, 1);
		const sent = mockSqs._sent[0] as { MessageGroupId?: string };
		assert.equal(sent.MessageGroupId, undefined);
	});

	it("event body carries only messageId + flagName — never the operation or a UID", async () => {
		const { service, mockSqs } = createHarness();

		await service.flip({
			accountId,
			accountConfigId,
			messageId,
			mailboxId,
			flagName: MessageSystemFlag.Flagged,
			operation: "remove",
		});

		const sent = mockSqs._sent[0] as { MessageBody: string };
		const event = JSON.parse(sent.MessageBody);
		assert.equal(event.type, "FLAG_PUSH");
		assert.equal(event.messageId, messageId);
		assert.equal(event.flagName, MessageSystemFlag.Flagged);
		assert.equal(event.accountId, accountId);
		assert.equal(event.accountConfigId, accountConfigId);
		assert.equal("operation" in event, false);
		assert.equal("uid" in event, false);
	});

	describe("fast-path race: the worker drains and deletes the marker before the queued-state transition runs (review finding on #1292)", () => {
		it("does NOT log the flag_push_hint_enqueue_failed alarm when the marker is already gone", async () => {
			const { service, logs } = createHarness({
				updateStateImpl: () => {
					throw new Error(
						"Cannot update state on a MessageFlagPush that does not exist: msg-1/\\Seen",
					);
				},
				findImpl: () => Promise.resolve(null),
			});

			await service.flip({
				accountId,
				accountConfigId,
				messageId,
				mailboxId,
				flagName: MessageSystemFlag.Seen,
				operation: "add",
			});

			assert.equal(
				logs.error.length,
				0,
				"the enqueue succeeded; a fast-path race must never be logged as flag_push_hint_enqueue_failed",
			);
			assert.ok(
				logs.info.length > 0,
				"the race is still visible as routine info, not silent",
			);
		});

		it("still logs the flag_push_hint_enqueue_failed alarm when updateState fails for a REAL reason (marker still present)", async () => {
			const { service, logs } = createHarness({
				updateStateImpl: () => {
					throw new Error("ProvisionedThroughputExceededException");
				},
				findImpl: () =>
					Promise.resolve({
						messageId,
						flagName: MessageSystemFlag.Seen,
						state: "pending",
					}),
			});

			await service.flip({
				accountId,
				accountConfigId,
				messageId,
				mailboxId,
				flagName: MessageSystemFlag.Seen,
				operation: "add",
			});

			const alerted = logs.error.find(
				(entry) =>
					(entry as { alert?: string }).alert ===
					"flag_push_hint_enqueue_failed",
			);
			assert.ok(
				alerted,
				"a genuine failure behind the race-check must still alarm",
			);
		});

		it("still logs the flag_push_hint_enqueue_failed alarm when the re-check itself fails (backend genuinely down)", async () => {
			const { service, logs } = createHarness({
				updateStateImpl: () => {
					throw new Error(
						"Cannot update state on a MessageFlagPush that does not exist: msg-1/\\Seen",
					);
				},
				findImpl: () => {
					throw new Error("ECONNREFUSED");
				},
			});

			await service.flip({
				accountId,
				accountConfigId,
				messageId,
				mailboxId,
				flagName: MessageSystemFlag.Seen,
				operation: "add",
			});

			const alerted = logs.error.find(
				(entry) =>
					(entry as { alert?: string }).alert ===
					"flag_push_hint_enqueue_failed",
			);
			assert.ok(
				alerted,
				"a re-check failure is a real infra problem — must alarm",
			);
		});
	});
});
