import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import type { AccountItem } from "@remit/data-ports";
import {
	AccountAuthType,
	AccountService,
	ConnectionState,
} from "@remit/domain-enums";
import { AccountRepo } from "@remit/drizzle-service";
import { createShippedSqliteDb } from "@remit/drizzle-service/test-sqlite";
import { capturingLogger, type LogLine } from "../test-helpers/test-world.js";
import { runSchedulerTick } from "./run-tick.js";

const TICK_INTERVAL_MS = 60 * 60 * 1000;
const OFFLINE_INTERVAL_MS = 12 * 60 * 60 * 1000;
const NOW = 1_700_000_000_000;

let accounts: AccountRepo;
let close: () => void;

beforeEach(() => {
	const store = createShippedSqliteDb();
	close = store.close;
	accounts = new AccountRepo(store.db);
});

afterEach(() => close());

const account = async (
	name: string,
	overrides: Partial<AccountItem> = {},
	stored: { credential: boolean } = { credential: true },
): Promise<AccountItem> => {
	const created = await accounts.create({
		accountConfigId: `cfg-${name}`,
		username: `${name}@example.com`,
		email: `${name}@example.com`,
		authType: AccountAuthType.Password,
		passwordHash: stored.credential ? '{"ciphertext":"x"}' : undefined,
		imapHost: "imap.example.com",
		imapPort: 993,
		imapTls: true,
		imapStartTls: false,
		isActive: true,
		connectionState: ConnectionState.Authenticated,
	} as Parameters<AccountRepo["create"]>[0]);
	if (Object.keys(overrides).length === 0) return created;
	await accounts.update(created.accountId, overrides);
	return accounts.get(created.accountId);
};

const tick = async (
	options: Partial<Parameters<typeof runSchedulerTick>[0]> = {},
) => {
	const sent: SendMessageCommand[] = [];
	const logs: LogLine[] = [];
	const result = await runSchedulerTick({
		accountService: accounts,
		sqsClient: {
			send: async (command: SendMessageCommand) => {
				sent.push(command);
				return {};
			},
		} as unknown as SQSClient,
		queueUrl:
			"https://sqs.eu-west-1.amazonaws.com/123/remit-dev-mailboxes.fifo",
		log: capturingLogger(logs),
		tickIntervalMs: TICK_INTERVAL_MS,
		offlineIntervalMs: OFFLINE_INTERVAL_MS,
		now: NOW,
		redriveStrandedPlacements: async () => 0,
		...options,
	});
	const enqueued = sent.map(
		(command) => JSON.parse(command.input.MessageBody ?? "{}").accountId,
	);
	return { result, sent, enqueued, logs };
};

describe("a scheduler tick", () => {
	it("enqueues the accounts that are due and only those", async () => {
		const due = await account("due", {
			lastSyncAt: NOW - OFFLINE_INTERVAL_MS - 1,
		});
		const never = await account("never");
		await account("fresh", { lastSyncAt: NOW - 60_000 });

		const { enqueued } = await tick();

		assert.deepEqual(enqueued.sort(), [due.accountId, never.accountId].sort());
	});

	it("skips an account it cannot or should not sync, and says so once in aggregate", async () => {
		const live = await account("live");
		await account("unsyncable", { imapHost: "mail.invalid" });
		await account("reauth", {
			connectionState: ConnectionState.ReauthRequired,
		});
		await account("calendar", { syncedServices: [AccountService.Calendar] });

		const { enqueued, result, logs } = await tick();

		assert.deepEqual(enqueued, [live.accountId]);
		assert.equal(result.skipped, 3);
		assert.equal(logs.length, 1, "one aggregate line, no per-account noise");
	});

	// Issue #1120: a sync for an account with no stored credential fenced the
	// account's FIFO group for its whole visibility timeout.
	it("skips an account that stores no credential", async () => {
		const live = await account("live");
		await account("missing", {}, { credential: false });

		const { enqueued } = await tick();

		assert.deepEqual(enqueued, [live.accountId]);
	});

	it("gives each enqueued account a scheduler-namespaced, time-bucketed dedup id", async () => {
		const live = await account("live");

		const { sent } = await tick();

		const dedupId = sent[0]?.input.MessageDeduplicationId;
		assert.ok(
			dedupId?.startsWith(`SYNC_MAILBOXES:scheduled:${live.accountId}:`),
		);
	});

	it("sweeps every account's attachments, due a sync or not", async () => {
		const due = await account("due");
		const fresh = await account("fresh", { lastSyncAt: NOW - 60_000 });
		const swept: string[] = [];

		const { result } = await tick({
			sweepAttachments: async (item) => {
				swept.push(item.accountId);
			},
		});

		assert.deepEqual(swept.sort(), [due.accountId, fresh.accountId].sort());
		assert.equal(result.swept, 2);
	});

	// Uncontained, one storage error reaches the loop, which exits, and the
	// container restarts without ever enqueuing an account again.
	it("keeps enqueuing mail when the attachment sweep throws", async () => {
		const live = await account("live");

		const { enqueued, result } = await tick({
			sweepAttachments: async () => {
				throw new Error("AccessDenied on ListObjectsV2");
			},
		});

		assert.deepEqual(enqueued, [live.accountId]);
		assert.equal(result.sweepFailed, 1);
	});

	it("keeps the tick alive when the calendar subscription refresh throws", async () => {
		const live = await account("live");

		const { enqueued, logs } = await tick({
			refreshCalendarSubscriptions: async () => {
				throw new Error("database is locked");
			},
		});

		assert.deepEqual(enqueued, [live.accountId]);
		assert.ok(logs.some((line) => line.level === "error"));
	});

	it("counts what each account re-drove and keeps enqueuing past one that fails", async () => {
		const live = await account("live");
		const busy = await account("busy");

		const { enqueued, result, logs } = await tick({
			redriveStrandedPlacements: async (redriven) => {
				if (redriven.accountId === busy.accountId) {
					throw new Error("SQLITE_BUSY");
				}
				return 2;
			},
		});

		assert.deepEqual(enqueued.sort(), [live.accountId, busy.accountId].sort());
		assert.equal(result.redriven, 2);
		assert.equal(result.redriveFailed, 1);
		assert.ok(logs.some((line) => line.level === "error"));
	});
});
