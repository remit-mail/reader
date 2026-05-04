import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Logger } from "@remit/remit-logger-lambda";
import type { ImapWorkerStopEvent } from "./events.js";
import { processEvent } from "./processor.js";

interface CapturedLogEntry {
	args: unknown[];
}

const createCapturingLogger = (): {
	log: Logger;
	infoCalls: CapturedLogEntry[];
} => {
	const infoCalls: CapturedLogEntry[] = [];
	const noop = () => {};
	const log = {
		info: (...args: unknown[]) => infoCalls.push({ args }),
		warn: noop,
		error: noop,
		debug: noop,
		fatal: noop,
		trace: noop,
		child: () => log,
	} as unknown as Logger;
	return { log, infoCalls };
};

describe("processEvent — IMAP_WORKER_STOP", () => {
	it("returns undefined and logs the stop signal — tombstone fence on the account row already halts work", async () => {
		const event: ImapWorkerStopEvent = {
			type: "IMAP_WORKER_STOP",
			accountConfigId: "acfg_alice_replay_safe_test_id",
			accountId: "acct_alice_replay_safe_test_id",
		};
		const { log, infoCalls } = createCapturingLogger();

		const result = await processEvent(event, log);

		assert.equal(result, undefined);
		const matched = infoCalls.find((c) => {
			const [meta, msg] = c.args;
			return (
				typeof msg === "string" &&
				msg === "Imap worker stop signal received" &&
				typeof meta === "object" &&
				meta !== null &&
				(meta as { accountConfigId?: string }).accountConfigId ===
					event.accountConfigId &&
				(meta as { accountId?: string }).accountId === event.accountId
			);
		});
		assert.ok(
			matched,
			"processor must log the cascade-contract stop signal with both ids",
		);
	});
});
