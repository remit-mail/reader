import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
	AccountItem,
	IMessageFlagPushRepository,
} from "@remit/data-ports";
import type { Logger } from "@remit/logger-lambda";
import { drainPendingFlagPushes } from "./sync-messages.js";

const buildLogger = (): {
	log: Logger;
	infos: Array<{ fields: Record<string, unknown>; msg: string }>;
	errors: Array<{ fields: Record<string, unknown>; msg: string }>;
} => {
	const infos: Array<{ fields: Record<string, unknown>; msg: string }> = [];
	const errors: Array<{ fields: Record<string, unknown>; msg: string }> = [];
	const log = {
		info: (fields: Record<string, unknown>, msg: string) => {
			infos.push({ fields, msg });
		},
		error: (fields: Record<string, unknown>, msg: string) => {
			errors.push({ fields, msg });
		},
		warn: () => {},
		debug: () => {},
		fatal: () => {},
		trace: () => {},
		child: () => log,
	} as unknown as Logger;
	return { log, infos, errors };
};

const account = {
	accountId: "acc-1",
	accountConfigId: "acc-cfg-1",
} as unknown as AccountItem;

const marker = (overrides: Partial<Record<string, unknown>> = {}) => ({
	messageId: "msg-1",
	flagName: "\\Seen",
	accountId: "acc-1",
	accountConfigId: "acc-cfg-1",
	mailboxId: "mbx-1",
	operation: "add",
	state: "pending",
	createdAt: 1,
	updatedAt: 1,
	...overrides,
});

describe("drainPendingFlagPushes — periodic per-mailbox re-arm (issue #1273)", () => {
	it("re-emits FLAG_PUSH for every marker stuck in `pending` (crash between local write and enqueue)", async () => {
		const markerService = {
			listByMailboxId: async () => [marker()],
		} as unknown as IMessageFlagPushRepository;

		const emitted: unknown[] = [];
		const { log } = buildLogger();

		await drainPendingFlagPushes(
			markerService,
			account,
			"mbx-1",
			log,
			async (event) => {
				emitted.push(event);
			},
		);

		assert.equal(emitted.length, 1);
		assert.deepEqual(emitted[0], {
			type: "FLAG_PUSH",
			accountId: "acc-1",
			accountConfigId: "acc-cfg-1",
			messageId: "msg-1",
			flagName: "\\Seen",
		});
	});

	it("does NOT re-arm markers already queued or processing — a live driver already owns them", async () => {
		const markerService = {
			listByMailboxId: async () => [
				marker({ messageId: "queued-msg", state: "queued" }),
				marker({ messageId: "processing-msg", state: "processing" }),
			],
		} as unknown as IMessageFlagPushRepository;

		const emitted: unknown[] = [];
		const { log } = buildLogger();

		await drainPendingFlagPushes(
			markerService,
			account,
			"mbx-1",
			log,
			async (event) => {
				emitted.push(event);
			},
		);

		assert.equal(emitted.length, 0);
	});

	it("is a no-op when no markers exist for the mailbox", async () => {
		const markerService = {
			listByMailboxId: async () => [],
		} as unknown as IMessageFlagPushRepository;

		const emitted: unknown[] = [];
		const { log, infos } = buildLogger();

		await drainPendingFlagPushes(
			markerService,
			account,
			"mbx-1",
			log,
			async (event) => {
				emitted.push(event);
			},
		);

		assert.equal(emitted.length, 0);
		assert.equal(infos.length, 0);
	});

	it("re-arms multiple stuck markers for the same mailbox (per-field, independent)", async () => {
		const markerService = {
			listByMailboxId: async () => [
				marker({ flagName: "\\Seen" }),
				marker({ flagName: "\\Flagged" }),
			],
		} as unknown as IMessageFlagPushRepository;

		const emitted: unknown[] = [];
		const { log } = buildLogger();

		await drainPendingFlagPushes(
			markerService,
			account,
			"mbx-1",
			log,
			async (event) => {
				emitted.push(event);
			},
		);

		assert.equal(emitted.length, 2);
	});

	it("a re-arm (SQS) failure is caught per-marker and logged loudly — never thrown", async () => {
		const markerService = {
			listByMailboxId: async () => [marker()],
		} as unknown as IMessageFlagPushRepository;

		const { log, errors } = buildLogger();

		await assert.doesNotReject(
			drainPendingFlagPushes(markerService, account, "mbx-1", log, async () => {
				throw Object.assign(new Error("queue down"), { code: "ECONNREFUSED" });
			}),
		);

		const alerted = errors.find(
			(e) => e.fields.alert === "flag_push_drain_rearm_failed",
		);
		assert.ok(
			alerted,
			"expected an alertable flag_push_drain_rearm_failed log",
		);
	});

	it("a re-arm failure for one marker does not stop the others from being re-armed", async () => {
		const markerService = {
			listByMailboxId: async () => [
				marker({ messageId: "will-fail", flagName: "\\Seen" }),
				marker({ messageId: "will-succeed", flagName: "\\Flagged" }),
			],
		} as unknown as IMessageFlagPushRepository;

		const emitted: unknown[] = [];
		const { log } = buildLogger();

		await drainPendingFlagPushes(
			markerService,
			account,
			"mbx-1",
			log,
			async (event) => {
				if (
					(event as unknown as { messageId: string }).messageId === "will-fail"
				) {
					throw new Error("queue down");
				}
				emitted.push(event);
			},
		);

		assert.equal(emitted.length, 1);
		assert.equal(
			(emitted[0] as { messageId: string }).messageId,
			"will-succeed",
		);
	});
});
