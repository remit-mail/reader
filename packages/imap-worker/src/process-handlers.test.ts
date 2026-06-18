import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { Logger } from "@remit/remit-logger-lambda";
import { installCrashHandlers } from "./process-handlers.js";

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

afterEach(() => {
	process.removeAllListeners("unhandledRejection");
	process.removeAllListeners("uncaughtException");
});

describe("installCrashHandlers", () => {
	it("logs structured and exits 1 on unhandledRejection", () => {
		const { log, errorCalls } = createCapturingLogger();
		const exitCodes: number[] = [];

		installCrashHandlers(log, (code) => {
			exitCodes.push(code);
		});

		const handler = process.listeners("unhandledRejection").at(-1);
		assert.ok(handler, "unhandledRejection handler registered");
		handler(new Error("rejected"), Promise.resolve());

		assert.deepEqual(exitCodes, [1]);
		assert.equal(errorCalls.length, 1);
		assert.match(String(errorCalls[0].args[1]), /Unhandled rejection/);
	});

	it("logs structured and exits 1 on uncaughtException", () => {
		const { log, errorCalls } = createCapturingLogger();
		const exitCodes: number[] = [];

		installCrashHandlers(log, (code) => {
			exitCodes.push(code);
		});

		const handler = process.listeners("uncaughtException").at(-1);
		assert.ok(handler, "uncaughtException handler registered");
		handler(new Error("boom"), "uncaughtException");

		assert.deepEqual(exitCodes, [1]);
		assert.equal(errorCalls.length, 1);
		assert.match(String(errorCalls[0].args[1]), /Uncaught exception/);
	});
});
