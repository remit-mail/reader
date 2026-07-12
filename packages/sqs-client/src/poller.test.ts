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

	it("throws when constructed with no targets", async () => {
		await assert.rejects(
			() => runQueuePoller({ targets: [], log: buildLog() }),
			/no targets configured/,
		);
	});
});
