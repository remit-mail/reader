/**
 * Both scheduler entry points must hand the tick a sweep.
 *
 * Only the hosted one strictly needs it — a browser PUTs straight to block
 * storage there, so nothing is in the path to refuse an upload against a draft
 * that is already gone — but a deployment that quietly stops collecting is
 * indistinguishable from one that has nothing to collect. Deleting either wiring
 * used to leave the suite green.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { AccountItem } from "@remit/data-ports";
import type { Logger } from "@remit/logger-lambda";
import type { StorageService } from "@remit/storage-service";
import { buildAttachmentSweep } from "./attachment-sweep.js";

const here = dirname(fileURLToPath(import.meta.url));
const TICK_TIME = 1_700_000_000_000;

const silentLogger = (): Logger => {
	const noop = () => {};
	const log = {
		info: noop,
		warn: noop,
		error: noop,
		debug: noop,
		fatal: noop,
		trace: noop,
		child: () => log,
	} as unknown as Logger;
	return log;
};

/** Enough of an account for the tick's eligibility checks to run. */
const eligibleAccount = (accountId: string) =>
	({
		accountId,
		accountConfigId: "cfg-1",
		email: `${accountId}@example.com`,
		username: accountId,
		authType: "password",
		imapHost: "imap.example.com",
		imapPort: 993,
		imapTls: true,
		imapStartTls: false,
		isActive: true,
		connectionState: "authenticated",
		// Freshly synced, so nothing is due and no SQS send is attempted. The
		// sweep must still run: abandoned bytes have nothing to do with how
		// recently mail was fetched.
		lastSyncAt: TICK_TIME,
		createdAt: 0,
		updatedAt: 0,
	}) as unknown as AccountItem;

describe("the hosted tick sweeps", () => {
	it("runs the sweep for every account, due a sync or not", async () => {
		process.env.SQS_QUEUE_URL_MAILBOXES = "https://queue.test/mailboxes";

		const swept: string[] = [];
		const { setClient, _resetForTest } = await import("@remit/backend/client");
		setClient({
			account: {
				listAllAccountsPage: async () => ({
					items: [eligibleAccount("acc-1"), eligibleAccount("acc-2")],
					cursor: null,
				}),
			},
			storage: {
				listOutboxDraftsWithAttachments: async (
					_cfg: string,
					accountId: string,
				) => {
					swept.push(accountId);
					return [];
				},
			},
			outboxAttachment: { reapAndListLive: async () => [] },
		} as never);

		try {
			const { handler } = await import("./handler.js");
			await handler(
				{ time: new Date(TICK_TIME).toISOString() } as never,
				{} as never,
				() => {},
			);
			assert.deepEqual(swept.sort(), ["acc-1", "acc-2"]);
		} finally {
			_resetForTest();
		}
	});
});

describe("the self-host runner wires the sweep", () => {
	it("hands runSchedulerTick a sweep", () => {
		// runner.ts starts its loop on import, so it cannot be invoked from a test
		// the way handler.ts can. This guards the wiring itself: without it,
		// deleting the line leaves the suite green and self-host silently stops
		// collecting.
		const source = readFileSync(join(here, "runner.ts"), "utf8");
		assert.match(source, /sweepAttachments:\s*buildAttachmentSweep\(/);
	});
});

describe("buildAttachmentSweep", () => {
	const account = {
		accountId: "acc-1",
		accountConfigId: "cfg-1",
	} as unknown as AccountItem;

	it("collects the objects the database does not name", async () => {
		const deleted: string[] = [];
		const storage = {
			listOutboxDraftsWithAttachments: async () => ["draft-1"],
			listOutboxAttachments: async () => [
				{ outboxAttachmentId: "known", key: "k1", sizeBytes: 1 },
				{ outboxAttachmentId: "orphan", key: "k2", sizeBytes: 1 },
			],
			deleteOutboxAttachment: async (
				_cfg: string,
				_acc: string,
				_draft: string,
				id: string,
			) => {
				deleted.push(id);
			},
		} as unknown as StorageService;

		await buildAttachmentSweep(
			{
				storage,
				outboxAttachment: {
					reapAndListLive: async () => ["known"],
				},
			} as never,
			silentLogger(),
		)(account);

		assert.deepEqual(deleted, ["orphan"]);
	});

	it("lets a storage failure out, so the tick can count it", async () => {
		// Containment belongs to the tick, which keeps enqueuing mail regardless.
		// Swallowing here would make a broken sweep look like a working one.
		const storage = {
			listOutboxDraftsWithAttachments: async () => {
				throw new Error("storage root does not exist");
			},
		} as unknown as StorageService;

		await assert.rejects(
			() =>
				buildAttachmentSweep(
					{
						storage,
						outboxAttachment: { reapAndListLive: async () => [] },
					} as never,
					silentLogger(),
				)(account),
			/storage root does not exist/,
		);
	});
});
