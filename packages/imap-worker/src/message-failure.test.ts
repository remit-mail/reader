import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Logger } from "@remit/remit-logger-lambda";
import {
	handleMessageFailure,
	MAX_RECEIVE_COUNT,
	type ReceivedMessage,
} from "./message-failure.js";

interface CapturedLogEntry {
	args: unknown[];
}

const createCapturingLogger = (): {
	log: Logger;
	errorCalls: CapturedLogEntry[];
} => {
	const errorCalls: CapturedLogEntry[] = [];
	const noop = () => {};
	const log = {
		info: noop,
		warn: noop,
		error: (...args: unknown[]) => errorCalls.push({ args }),
		debug: noop,
		fatal: noop,
		trace: noop,
		child: () => log,
	} as unknown as Logger;
	return { log, errorCalls };
};

const makeMessage = (receiveCount: number): ReceivedMessage => ({
	body: "{}",
	receiptHandle: "rh",
	messageId: "msg-1",
	receiveCount,
});

describe("handleMessageFailure", () => {
	it("logs a redelivery warning while attempts remain — never deletes the message", () => {
		const { log, errorCalls } = createCapturingLogger();

		handleMessageFailure(makeMessage(1), new Error("boom"), log);

		assert.equal(errorCalls.length, 1);
		const [context, message] = errorCalls[0].args;
		assert.match(String(message), /redelivered by SQS/);
		assert.equal((context as { receiveCount: number }).receiveCount, 1);
	});

	it("logs loudly that SQS will dead-letter once retries are exhausted", () => {
		const { log, errorCalls } = createCapturingLogger();

		handleMessageFailure(
			makeMessage(MAX_RECEIVE_COUNT),
			new Error("boom"),
			log,
		);

		assert.equal(errorCalls.length, 1);
		const [context, message] = errorCalls[0].args;
		assert.match(String(message), /dead-letter/);
		assert.equal(
			(context as { receiveCount: number }).receiveCount,
			MAX_RECEIVE_COUNT,
		);
		assert.equal(
			(context as { maxReceiveCount: number }).maxReceiveCount,
			MAX_RECEIVE_COUNT,
		);
	});

	it("treats a count beyond the max as dead-lettering too", () => {
		const { log, errorCalls } = createCapturingLogger();

		handleMessageFailure(
			makeMessage(MAX_RECEIVE_COUNT + 5),
			new Error("boom"),
			log,
		);

		assert.match(String(errorCalls[0].args[1]), /dead-letter/);
	});
});
