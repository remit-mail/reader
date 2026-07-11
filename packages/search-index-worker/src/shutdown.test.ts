import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { RunningConsumer } from "./shutdown.js";
import { runShutdown } from "./shutdown.js";

const nextTick = (): Promise<void> =>
	new Promise((resolve) => setImmediate(resolve));

describe("runShutdown", () => {
	test("force-exits with code 1 when stop() never settles", async () => {
		const hanging: RunningConsumer = {
			stop: () => new Promise<void>(() => {}),
		};
		const codes: number[] = [];

		runShutdown(hanging, {
			timeoutMs: 5,
			exit: (code) => codes.push(code),
		});

		await new Promise((resolve) => setTimeout(resolve, 25));
		assert.deepStrictEqual(codes, [1], "timeout forces a code-1 exit");
	});

	test("exits 0 when stop() resolves before the deadline", async () => {
		const clean: RunningConsumer = { stop: async () => {} };
		const codes: number[] = [];

		runShutdown(clean, { timeoutMs: 10_000, exit: (code) => codes.push(code) });

		await nextTick();
		assert.deepStrictEqual(codes, [0], "clean stop exits 0");
	});

	test("exits 1 and reports when stop() rejects", async () => {
		const failing: RunningConsumer = {
			stop: async () => {
				throw new Error("consumer stop failed");
			},
		};
		const codes: number[] = [];
		const errors: unknown[] = [];

		runShutdown(failing, {
			timeoutMs: 10_000,
			exit: (code) => codes.push(code),
			onError: (error) => errors.push(error),
		});

		await nextTick();
		assert.deepStrictEqual(codes, [1], "a failed stop exits 1");
		assert.equal(errors.length, 1);
	});
});
