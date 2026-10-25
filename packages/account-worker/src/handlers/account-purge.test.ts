import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	type RecordingQueue,
	recordingQueue,
} from "@remit/data-ports/recording-queue";
import { noopLogger } from "@remit/logger";
import type { CascadeServices } from "../cascade.js";
import type { AccountDataPurgeEvent } from "../events.js";
import {
	type ProcessPurgeFanoutDeps,
	processAccountDataPurge,
} from "./account-purge.js";

const buildServices = (
	manifest: Array<{
		threadMessageId: string;
		messageId: string;
		mailboxId: string;
	}>,
	mailboxIds: string[] = ["mbx-1"],
): CascadeServices =>
	({
		accountService: {
			describe: async () => ({
				mailbox: mailboxIds.map((mailboxId) => ({ mailboxId })),
			}),
		},
		threadMessageService: {
			listAllByAccount: async () => manifest,
		},
	}) as unknown as CascadeServices;

const event: AccountDataPurgeEvent = {
	type: "AccountDataPurge",
	accountId: "acc-1",
	accountConfigId: "cfg-1",
};

const baseDeps = (queue: RecordingQueue): ProcessPurgeFanoutDeps => ({
	services: buildServices([
		{ threadMessageId: "tm-1", messageId: "msg-1", mailboxId: "mbx-1" },
		{ threadMessageId: "tm-2", messageId: "msg-2", mailboxId: "mbx-1" },
	]),
	queue: queue.grouped,
});

describe("processAccountDataPurge", () => {
	it("enqueues a subtrees batch and one container leftover", async () => {
		const queue = recordingQueue();
		await processAccountDataPurge(event, noopLogger, baseDeps(queue));

		const finalize = queue.sent;
		assert.ok(finalize.every((m) => m.groupId === "cfg-1"));
		const kinds = finalize.map((m) => m.body.kind);
		assert.deepEqual(kinds, ["subtrees", "container"]);
		assert.equal(
			(finalize[0]?.body.items as unknown[])?.length,
			2,
			"both subtrees ride the one batch",
		);
	});

	it("drops manifest rows outside the account's mailbox set", async () => {
		const queue = recordingQueue();
		await processAccountDataPurge(event, noopLogger, {
			...baseDeps(queue),
			services: buildServices([
				{ threadMessageId: "tm-1", messageId: "msg-1", mailboxId: "mbx-1" },
				{ threadMessageId: "tm-9", messageId: "msg-9", mailboxId: "other" },
			]),
		});

		const subtrees = queue.sent.find((m) => m.body.kind === "subtrees");
		assert.equal((subtrees?.body.items as unknown[])?.length, 1);
	});

	it("no-ops when the account is already gone", async () => {
		const queue = recordingQueue();
		await processAccountDataPurge(event, noopLogger, {
			...baseDeps(queue),
			services: {
				accountService: {
					describe: async () => {
						throw Object.assign(new Error("gone"), {
							name: "NotFoundError",
						});
					},
				},
				threadMessageService: { listAllByAccount: async () => [] },
			} as unknown as CascadeServices,
		});

		assert.equal(
			queue.sent.length,
			0,
			"nothing enqueued for a missing account",
		);
	});

	it("rethrows a non-NotFound describe error", async () => {
		const queue = recordingQueue();
		await assert.rejects(
			processAccountDataPurge(event, noopLogger, {
				...baseDeps(queue),
				services: {
					accountService: {
						describe: async () => {
							throw new Error("dynamo throttled");
						},
					},
					threadMessageService: { listAllByAccount: async () => [] },
				} as unknown as CascadeServices,
			}),
			/dynamo throttled/,
		);
	});
});
