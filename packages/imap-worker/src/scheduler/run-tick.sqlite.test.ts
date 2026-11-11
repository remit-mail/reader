import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { AccountItem } from "@remit/data-ports";
import {
	classificationUsageName,
	utcDateOf,
} from "@remit/data-ports/classification-presets";
import { recordingQueue } from "@remit/data-ports/recording-queue";
import {
	AccountAuthType,
	AccountService,
	ClassificationPresetId,
	ConnectionState,
} from "@remit/domain-enums";
import {
	type AccountRepo,
	BETTER_SQLITE3_LIMITS,
	createSqliteRepositories,
	messageObjectsInMemory,
} from "@remit/drizzle-service";
import { createShippedSqliteDb } from "@remit/drizzle-service/test-sqlite";
import { capturingLogger, type LogLine } from "../test-helpers/test-world.js";
import { buildJunkReevaluationEnqueue } from "./junk-reevaluation.js";
import { runSchedulerTick } from "./run-tick.js";

const TICK_INTERVAL_MS = 60 * 60 * 1000;
const OFFLINE_INTERVAL_MS = 12 * 60 * 60 * 1000;
const NOW = 1_700_000_000_000;

let repos: ReturnType<typeof createSqliteRepositories>;
let accounts: AccountRepo;
let close: () => void;

beforeEach(() => {
	const store = createShippedSqliteDb();
	close = store.close;
	repos = createSqliteRepositories(
		{
			app: store.db,
			mail: store.db,
			search: store.db,
		},
		BETTER_SQLITE3_LIMITS,
		messageObjectsInMemory(),
	);
	accounts = repos.account;
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
	const queue = recordingQueue();
	const { sent } = queue;
	const logs: LogLine[] = [];
	const result = await runSchedulerTick({
		accountService: accounts,
		queue: queue.fifo,
		log: capturingLogger(logs),
		tickIntervalMs: TICK_INTERVAL_MS,
		offlineIntervalMs: OFFLINE_INTERVAL_MS,
		now: NOW,
		redriveStrandedPlacements: async () => 0,
		enqueueJunkReevaluation: async () => false,
		...options,
	});
	const enqueued = sent.map((message) => String(message.body.accountId));
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

		const dedupId = sent[0]?.deduplicationId;
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

	it("counts the Junk re-checks it enqueued and keeps going past one that fails", async () => {
		const backlog = await account("backlog");
		const busy = await account("busy");
		await account("clear");

		const { enqueued, result, logs } = await tick({
			enqueueJunkReevaluation: async (candidate) => {
				if (candidate.accountId === busy.accountId) {
					throw new Error("SQLITE_BUSY");
				}
				return candidate.accountId === backlog.accountId;
			},
		});

		assert.equal(enqueued.length, 3);
		assert.equal(result.junkReevaluations, 1);
		assert.equal(result.junkReevaluationFailed, 1);
		assert.ok(logs.some((line) => line.level === "error"));
	});
});

describe("the Junk re-check enqueue", () => {
	const withJunkBacklog = async (): Promise<AccountItem> => {
		await repos.accountConfig.create({
			accountConfigId: "cfg-junk",
			userId: "user-1",
			name: "Me",
		});
		const owner = await account("junk");
		const created = await repos.mailbox.create({
			accountId: owner.accountId,
			namespacePrefix: "",
			hierarchyDelimiter: "/",
			fullPath: "Junk",
			uidValidity: 7,
			uidNext: 2,
			highestModseq: "0",
			messageCount: 1,
			unseenCount: 1,
			deletedCount: 0,
			totalSize: 0,
			lastSyncUid: 0,
			highWaterMarkUid: 0,
			lastMessageSyncAt: 0,
			specialUse: ["Junk"],
		});
		if (created.outcome !== "Created") throw new Error("Junk exists");
		await repos.mailboxSpecialUse.create(created.mailbox.mailboxId, "Junk");
		await repos.message.create({
			messageId: "junk-1",
			mailboxId: created.mailbox.mailboxId,
			uid: 1,
			sequenceNumber: 1,
			rfc822Size: 100,
			internalDate: NOW - 60_000,
			status: "active",
			syncStatus: "synced",
			bodyStorageKey: "body/1",
		});
		return owner;
	};

	it("enqueues nothing once the classifier budget for the day is spent", async () => {
		const owner = await withJunkBacklog();
		const queue = recordingQueue();
		const enqueue = buildJunkReevaluationEnqueue({
			...repos,
			classificationDefault: {
				state: "Configured",
				presetId: ClassificationPresetId.Jev,
				model: "jev-test",
				baseUrl: "https://api.typesafe.ai",
				apiKey: "sk-test",
				enabled: true,
				dailyLimit: 1,
			},
			queues: { accountFanout: queue },
		});

		assert.equal(await enqueue(owner, NOW), true);

		await repos.accountSetting.claimDailyCount({
			accountConfigId: owner.accountConfigId,
			name: classificationUsageName(owner.accountId),
			date: utcDateOf(NOW),
			limit: 1,
		});

		assert.equal(await enqueue(owner, NOW), false);
		assert.equal(queue.sent.length, 1);
	});
});
