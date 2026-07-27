import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { SQSClient } from "@aws-sdk/client-sqs";
import type { SQSBatchResponse, SQSEvent } from "aws-lambda";
import { runQueuePoller } from "./poller.js";

const QUEUE_URL = "http://localhost:9324/000000000000/remit-test";

const buildLog = () => ({
	info: mock.fn((_fields: Record<string, unknown>, _message: string) => {}),
	error: mock.fn((_fields: Record<string, unknown>, _message: string) => {}),
});

const buildMessage = (id: string) => ({
	MessageId: id,
	ReceiptHandle: `receipt-${id}`,
	Body: "{}",
	Attributes: { ApproximateReceiveCount: "1" },
});

describe("runQueuePoller", () => {
	it("deletes succeeded messages and leaves batchItemFailures for redelivery, then stops on signal", async () => {
		const deletedReceiptHandles: string[] = [];
		let receiveCalls = 0;

		// SQSClient.prototype.send is mocked globally (poller.ts constructs its
		// own client internally — there is no injection seam), matching the
		// same shape every AWS SDK v3 command carries: `{ input, constructor }`.
		const sendMock = mock.method(
			SQSClient.prototype,
			"send",
			// biome-ignore lint/suspicious/noExplicitAny: minimal SDK command shape, not worth typing per-command here
			async function (this: SQSClient, command: any) {
				if (command.constructor.name === "ReceiveMessageCommand") {
					receiveCalls++;
					if (receiveCalls === 1) {
						// Simulate the shutdown signal landing while this batch is
						// in flight — the loop is expected to finish processing it
						// (delete succeeded / leave failures) and then exit before
						// issuing a second ReceiveMessage.
						process.emit("SIGWINCH", "SIGWINCH");
						return { Messages: [buildMessage("m1"), buildMessage("m2")] };
					}
					throw new Error(
						"unexpected second ReceiveMessage — poller did not stop on signal",
					);
				}
				if (command.constructor.name === "DeleteMessageCommand") {
					deletedReceiptHandles.push(command.input.ReceiptHandle);
					return {};
				}
				throw new Error(`unexpected command: ${command.constructor.name}`);
			},
		);

		const handler = mock.fn(
			async (_event: SQSEvent): Promise<SQSBatchResponse> => ({
				batchItemFailures: [{ itemIdentifier: "m2" }],
			}),
		);

		try {
			await runQueuePoller({
				targets: [{ queueUrl: QUEUE_URL, handler, functionName: "test-fn" }],
				log: buildLog(),
				signals: ["SIGWINCH"],
			});
		} finally {
			sendMock.mock.restore();
		}

		assert.equal(handler.mock.calls.length, 1);
		const event = handler.mock.calls[0]?.arguments[0] as SQSEvent;
		assert.deepEqual(
			event.Records.map((r) => r.messageId),
			["m1", "m2"],
		);

		// m1 succeeded (not in batchItemFailures) -> deleted. m2 failed -> left
		// for redelivery, matching the SQS batchItemFailures contract.
		assert.deepEqual(deletedReceiptHandles, ["receipt-m1"]);
	});

	it("aborts an in-flight idle long-poll on signal instead of waiting it out", async () => {
		let receiveCalls = 0;
		let sawAbortSignal = false;

		const sendMock = mock.method(
			SQSClient.prototype,
			"send",
			// biome-ignore lint/suspicious/noExplicitAny: minimal SDK command shape
			async function (this: SQSClient, command: any, options?: any) {
				if (command.constructor.name === "ReceiveMessageCommand") {
					receiveCalls++;
					if (receiveCalls > 1) {
						throw new Error(
							"a second ReceiveMessage was issued — the abort did not end the poll",
						);
					}
					const signal: AbortSignal | undefined = options?.abortSignal;
					sawAbortSignal = signal instanceof AbortSignal;
					// Model an empty long poll that only ever ends because it is
					// aborted: request shutdown, then resolve solely on abort. A
					// poller that waited out WaitTimeSeconds would hang this test.
					process.emit("SIGWINCH", "SIGWINCH");
					return await new Promise((_resolve, reject) => {
						const fail = () =>
							reject(
								Object.assign(new Error("aborted"), { name: "AbortError" }),
							);
						if (signal?.aborted) return fail();
						signal?.addEventListener("abort", fail, { once: true });
					});
				}
				throw new Error(`unexpected command: ${command.constructor.name}`);
			},
		);

		try {
			await runQueuePoller({
				targets: [
					{ queueUrl: QUEUE_URL, handler: mock.fn(), functionName: "test-fn" },
				],
				log: buildLog(),
				signals: ["SIGWINCH"],
				// A no-op heartbeat keeps this case about the abort alone, off the
				// real heartbeat file the default writer would touch.
				createHeartbeat: () => async () => {},
			});
		} finally {
			sendMock.mock.restore();
		}

		assert.ok(sawAbortSignal, "the receive was issued without an abort signal");
		assert.equal(receiveCalls, 1);
	});

	it("gives every target its own heartbeat, beaten at the top of each receive attempt", async () => {
		const beatsByQueue = new Map<string, number>();
		let receiveCalls = 0;

		const sendMock = mock.method(
			SQSClient.prototype,
			"send",
			// biome-ignore lint/suspicious/noExplicitAny: minimal SDK command shape, not worth typing per-command here
			async function (this: SQSClient, command: any) {
				if (command.constructor.name !== "ReceiveMessageCommand") {
					throw new Error(`unexpected command: ${command.constructor.name}`);
				}
				// Two empty receives per target, then shut down: the heartbeat has
				// to be written before the receive, and on an empty poll too — an
				// idle queue is the normal state of a healthy worker.
				receiveCalls++;
				if (receiveCalls >= 4) process.emit("SIGWINCH", "SIGWINCH");
				return { Messages: [] };
			},
		);

		try {
			await runQueuePoller({
				targets: [
					{ queueUrl: QUEUE_URL, handler: async () => {}, functionName: "a" },
					{
						queueUrl: `${QUEUE_URL}-2`,
						handler: async () => {},
						functionName: "b",
					},
				],
				log: buildLog(),
				signals: ["SIGWINCH"],
				createHeartbeat: (name) => async () => {
					beatsByQueue.set(name, (beatsByQueue.get(name) ?? 0) + 1);
				},
			});
		} finally {
			sendMock.mock.restore();
		}

		assert.ok(receiveCalls >= 4, `only ${receiveCalls} receives ran`);
		// One heartbeat per queue, named after it: a wedged loop has to go stale
		// on its own rather than ride on a sibling that is still turning.
		assert.deepEqual([...beatsByQueue.keys()].sort(), [
			"remit-test",
			"remit-test-2",
		]);
		assert.equal(
			[...beatsByQueue.values()].reduce((sum, count) => sum + count, 0),
			receiveCalls,
		);
	});

	it("keeps polling and logs when a heartbeat write fails", async () => {
		let receiveCalls = 0;
		const log = buildLog();

		const sendMock = mock.method(
			SQSClient.prototype,
			"send",
			// biome-ignore lint/suspicious/noExplicitAny: minimal SDK command shape, not worth typing per-command here
			async function (this: SQSClient, command: any) {
				if (command.constructor.name !== "ReceiveMessageCommand") {
					throw new Error(`unexpected command: ${command.constructor.name}`);
				}
				receiveCalls++;
				if (receiveCalls >= 2) process.emit("SIGWINCH", "SIGWINCH");
				return { Messages: [] };
			},
		);

		try {
			// A full disk is the likeliest cause, and the moment the loop must stay
			// up: the healthcheck reports the missed beat by itself.
			await runQueuePoller({
				targets: [
					{ queueUrl: QUEUE_URL, handler: async () => {}, functionName: "a" },
				],
				log,
				signals: ["SIGWINCH"],
				createHeartbeat: () => () =>
					Promise.reject(new Error("ENOSPC: no space left on device")),
			});
		} finally {
			sendMock.mock.restore();
		}

		assert.ok(receiveCalls >= 2, `only ${receiveCalls} receives ran`);
		const failures = log.error.mock.calls.filter(
			(call) => call.arguments[1] === "poller: heartbeat write failed",
		);
		assert.equal(failures.length, receiveCalls);
		assert.match(String(failures[0]?.arguments[0]?.error), /ENOSPC/);
	});

	it("throws when constructed with no targets", async () => {
		await assert.rejects(
			() => runQueuePoller({ targets: [], log: buildLog() }),
			/no targets configured/,
		);
	});
});
