import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import type {
	AccountItem,
	AccountSchedulerPage,
} from "@remit/data-ports";
import type { Logger } from "@remit/remit-logger-lambda";
import { runSchedulerTick } from "./run-tick.js";

const TICK_INTERVAL_MS = 60 * 60 * 1000;
const OFFLINE_INTERVAL_MS = 12 * 60 * 60 * 1000;
const NOW = 1_700_000_000_000;

const createNoopLogger = (): Logger => {
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

const createCapturingLogger = (): {
	log: Logger;
	calls: { level: string; args: unknown[] }[];
} => {
	const calls: { level: string; args: unknown[] }[] = [];
	const capture =
		(level: string) =>
		(...args: unknown[]) =>
			calls.push({ level, args });
	const log = {
		info: capture("info"),
		warn: capture("warn"),
		error: capture("error"),
		debug: capture("debug"),
		fatal: capture("fatal"),
		trace: capture("trace"),
		child: () => log,
	} as unknown as Logger;
	return { log, calls };
};

const baseAccount = (overrides: Partial<AccountItem>): AccountItem =>
	({
		accountId: "acct_1",
		accountConfigId: "acfg_1",
		username: "user",
		email: "user@example.com",
		authType: "password",
		imapHost: "imap.example.com",
		imapPort: 993,
		imapTls: true,
		imapStartTls: false,
		smtpEnabled: false,
		smtpHost: "",
		smtpPort: 587,
		smtpTls: false,
		smtpStartTls: true,
		smtpUsername: "",
		isActive: true,
		connectionState: "authenticated",
		createdAt: NOW - 1_000_000,
		updatedAt: NOW - 1_000_000,
		...overrides,
	}) as AccountItem;

const fakeAccountService = (pages: AccountSchedulerPage[]) => {
	let call = 0;
	return {
		listAllAccountsPage: async (): Promise<AccountSchedulerPage> => {
			const page = pages[call];
			call++;
			if (!page) throw new Error("no more pages configured");
			return page;
		},
	};
};

const fakeSqsClient = (): {
	sqsClient: SQSClient;
	sent: SendMessageCommand[];
} => {
	const sent: SendMessageCommand[] = [];
	const sqsClient = {
		send: async (cmd: SendMessageCommand) => {
			sent.push(cmd);
			return {};
		},
	} as unknown as SQSClient;
	return { sqsClient, sent };
};

describe("runSchedulerTick", () => {
	it("enqueues only accounts that are due, and pages through every account", async () => {
		const due = baseAccount({
			accountId: "acct_due",
			lastSyncAt: NOW - OFFLINE_INTERVAL_MS - 1,
		});
		const notDue = baseAccount({
			accountId: "acct_not_due",
			lastSyncAt: NOW - 60_000,
		});

		const accountService = fakeAccountService([
			{ items: [due], cursor: "page2" },
			{ items: [notDue], cursor: null },
		]);
		const { sqsClient, sent } = fakeSqsClient();

		const result = await runSchedulerTick({
			accountService,
			sqsClient,
			queueUrl:
				"https://sqs.eu-west-1.amazonaws.com/123/remit-dev-mailboxes.fifo",
			log: createNoopLogger(),
			tickIntervalMs: TICK_INTERVAL_MS,
			offlineIntervalMs: OFFLINE_INTERVAL_MS,
			now: NOW,
		});

		assert.equal(result.scanned, 2);
		assert.equal(result.enqueued, 1);
		assert.equal(result.skipped, 1);
		assert.equal(sent.length, 1);
		const body = JSON.parse(sent[0]?.input.MessageBody ?? "{}");
		assert.equal(body.accountId, "acct_due");
	});

	it("skips deleted, unsyncable-host, and reauth-required accounts", async () => {
		const deleted = baseAccount({ accountId: "acct_deleted", deletedAt: NOW });
		const unsyncable = baseAccount({
			accountId: "acct_unsyncable",
			imapHost: "mail.invalid",
		});
		const reauth = baseAccount({
			accountId: "acct_reauth",
			connectionState: "reauth_required",
		});

		const accountService = fakeAccountService([
			{ items: [deleted, unsyncable, reauth], cursor: null },
		]);
		const { sqsClient, sent } = fakeSqsClient();

		const result = await runSchedulerTick({
			accountService,
			sqsClient,
			queueUrl:
				"https://sqs.eu-west-1.amazonaws.com/123/remit-dev-mailboxes.fifo",
			log: createNoopLogger(),
			tickIntervalMs: TICK_INTERVAL_MS,
			offlineIntervalMs: OFFLINE_INTERVAL_MS,
			now: NOW,
		});

		assert.equal(result.enqueued, 0);
		assert.equal(result.skipped, 3);
		assert.equal(sent.length, 0);
	});

	it("never logs per-account for ineligible accounts — only the aggregate tick summary (review #1250)", async () => {
		const deleted = baseAccount({ accountId: "acct_deleted", deletedAt: NOW });
		const unsyncable = baseAccount({
			accountId: "acct_unsyncable",
			imapHost: "mail.invalid",
		});
		const reauth = baseAccount({
			accountId: "acct_reauth",
			connectionState: "reauth_required",
		});

		const accountService = fakeAccountService([
			{ items: [deleted, unsyncable, reauth], cursor: null },
		]);
		const { sqsClient } = fakeSqsClient();
		const { log, calls } = createCapturingLogger();

		await runSchedulerTick({
			accountService,
			sqsClient,
			queueUrl:
				"https://sqs.eu-west-1.amazonaws.com/123/remit-dev-mailboxes.fifo",
			log,
			tickIntervalMs: TICK_INTERVAL_MS,
			offlineIntervalMs: OFFLINE_INTERVAL_MS,
			now: NOW,
		});

		// Sweeping 3 ineligible accounts must not produce 3 (or more) log
		// lines through the tick's own logger — only the one aggregate
		// "tick complete" summary. Per-account noise from the shared
		// isAccountDeleted/isUnsyncableHost/isAccountReauthRequired helpers
		// must be swallowed by a silent logger inside the sweep.
		assert.equal(
			calls.length,
			1,
			`expected exactly one aggregate log line, got ${calls.length}: ${JSON.stringify(calls)}`,
		);
	});

	it("gives each enqueued account a scheduler-namespaced, time-bucketed dedup id", async () => {
		const due = baseAccount({ accountId: "acct_due" });
		const accountService = fakeAccountService([{ items: [due], cursor: null }]);
		const { sqsClient, sent } = fakeSqsClient();

		await runSchedulerTick({
			accountService,
			sqsClient,
			queueUrl:
				"https://sqs.eu-west-1.amazonaws.com/123/remit-dev-mailboxes.fifo",
			log: createNoopLogger(),
			tickIntervalMs: TICK_INTERVAL_MS,
			offlineIntervalMs: OFFLINE_INTERVAL_MS,
			now: NOW,
		});

		const dedupId = sent[0]?.input.MessageDeduplicationId;
		assert.ok(dedupId?.startsWith("SYNC_MAILBOXES:scheduled:acct_due:"));
		assert.notEqual(dedupId, "SYNC_MAILBOXES:acct_due");
	});

	it("terminates pagination and never revisits a page", async () => {
		const accountService = fakeAccountService([
			{ items: [], cursor: "page2" },
			{ items: [], cursor: "page3" },
			{ items: [], cursor: null },
		]);
		const { sqsClient } = fakeSqsClient();

		const result = await runSchedulerTick({
			accountService,
			sqsClient,
			queueUrl:
				"https://sqs.eu-west-1.amazonaws.com/123/remit-dev-mailboxes.fifo",
			log: createNoopLogger(),
			tickIntervalMs: TICK_INTERVAL_MS,
			offlineIntervalMs: OFFLINE_INTERVAL_MS,
			now: NOW,
		});

		assert.equal(result.scanned, 0);
		assert.equal(result.enqueued, 0);
	});
});
