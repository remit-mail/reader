import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { SQSClient } from "@aws-sdk/client-sqs";
import type { SQSBatchResponse, SQSEvent } from "aws-lambda";
import { runQueuePoller } from "./poller.js";

const QUEUE_URL = "http://localhost:9324/000000000000/remit-test";

const buildLog = () => ({
	info: mock.fn(() => {}),
	error: mock.fn(() => {}),
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

	it("beats the heartbeat at the top of every receive attempt, on every target", async () => {
		const beats: number[] = [];
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
				heartbeat: async () => {
					beats.push(Date.now());
				},
			});
		} finally {
			sendMock.mock.restore();
		}

		assert.ok(receiveCalls >= 4, `only ${receiveCalls} receives ran`);
		assert.equal(beats.length, receiveCalls);
	});

	it("throws when constructed with no targets", async () => {
		await assert.rejects(
			() => runQueuePoller({ targets: [], log: buildLog() }),
			/no targets configured/,
		);
	});
});
