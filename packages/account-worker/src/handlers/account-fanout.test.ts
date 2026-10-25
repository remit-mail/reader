import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { recordingQueue } from "@remit/data-ports/recording-queue";
import { noopLogger } from "@remit/logger";
import type { CascadeServices } from "../cascade.js";
import type { AccountDeleteEvent } from "../events.js";
import { processAccountFanout } from "./account-fanout.js";

// A CascadeServices fake with one account and no data: enough for
// enumerateCascadeEntities to yield a single Account row (so the stop-signal
// loop has one accountId to iterate) without standing up a database.
const buildServices = (): CascadeServices =>
	({
		accountConfigService: {
			get: async () => ({ userId: "user-1" }),
			describe: async () => ({
				account: [{ accountId: "acc-1" }],
				address: [],
			}),
		},
		accountService: {
			describe: async () => ({ mailbox: [] }),
		},
		messageService: {
			listAllByMailbox: async () => [],
			describe: async () => ({}),
		},
		outboxMessageService: { listByAccount: async () => ({ items: [] }) },
		mailboxLockService: { listByAccount: async () => [] },
		messagePlacementMoveService: { listByAccountId: async () => [] },
		messageFlagPushService: { listByAccountId: async () => [] },
		threadMessageService: { listAllByAccount: async () => [] },
		accountSettingService: { listByAccountConfig: async () => [] },
		filterService: { listByAccountConfig: async () => [] },
		labelService: { listByAccountConfig: async () => [] },
		messageLabelService: { listByLabelId: async () => [] },
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
				accountPurgeDelete: recordingQueue(),
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
