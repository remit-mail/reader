import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { recordingQueue } from "@remit/data-ports/recording-queue";
import { noopLogger } from "@remit/logger";
import type { CascadeServices } from "../cascade.js";
import type { AccountDeleteEvent } from "../events.js";
import { processAccountFanout } from "./account-fanout.js";

const buildServices = (): CascadeServices =>
	({
		accountConfigService: { get: async () => [{ userId: "user-1" }] },
	}) as unknown as CascadeServices;

const deleteEvent: AccountDeleteEvent = {
	type: "AccountDelete",
	accountConfigId: "cfg-1",
};

describe("processAccountFanout on account delete", () => {
	it("enqueues the finalize step", async () => {
		const accountFinalize = recordingQueue();

		await processAccountFanout(deleteEvent, noopLogger, {
			queues: {
				accountFinalize,
				accountPurgeDelete: recordingQueue().grouped,
			},
			services: buildServices(),
			signOut: async () => {},
		});

		assert.deepEqual(
			accountFinalize.sent.map((m) => m.body.type),
			["FinalizeAccountDelete"],
		);
	});
});
