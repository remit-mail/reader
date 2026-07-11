import type { SQSClient } from "@aws-sdk/client-sqs";
import {
	buildScheduledSyncDedupId,
	triggerAccountSync,
} from "@remit/backend/trigger-sync";
import type { AccountItem, IAccountRepository } from "@remit/data-ports";
import type { Logger } from "@remit/logger-lambda";
import pMap from "p-map";
import {
	isAccountDeleted,
	isAccountReauthRequired,
	isUnsyncableHost,
} from "../account-check.js";
import {
	SCHEDULER_ENQUEUE_CONCURRENCY,
	SCHEDULER_PAGE_SIZE,
} from "./config.js";
import { isSyncDue } from "./decide-due.js";

export interface RunSchedulerTickDeps {
	accountService: Pick<IAccountRepository, "listAllAccountsPage">;
	sqsClient: SQSClient;
	queueUrl: string;
	log: Logger;
	offlineIntervalMs: number;
	/**
	 * How often this tick itself runs — the dedup-id bucket width for
	 * `buildScheduledSyncDedupId`, so consecutive ticks each get a fresh id.
	 */
	tickIntervalMs: number;
	/** Injectable for tests; defaults to `Date.now()`. */
	now?: number;
}

export interface SchedulerTickResult {
	scanned: number;
	enqueued: number;
	skipped: number;
}

/**
 * `isAccountDeleted` / `isUnsyncableHost` / `isAccountReauthRequired` each log
 * one line per ineligible account — the right volume for their real call site
 * (once per SYNC_MAILBOXES event). Run across the whole account base every
 * tick, that becomes one log line per deleted/reauth/placeholder account
 * every 5 minutes, forever (review #1250). The tick already reports the
 * aggregate `skipped` count, so eligibility checks here go through a silent
 * logger — the per-event path (sync-mailboxes.ts) is untouched and keeps
 * logging normally.
 */
const silentLogger: Logger = (() => {
	const noop = () => {};
	const stub = {
		info: noop,
		warn: noop,
		error: noop,
		debug: noop,
		fatal: noop,
		trace: noop,
		child: () => stub,
	};
	return stub as unknown as Logger;
})();

const isEligible = (account: AccountItem): boolean => {
	if (isAccountDeleted(account, silentLogger)) return false;
	if (isUnsyncableHost(account, silentLogger)) return false;
	if (isAccountReauthRequired(account, silentLogger)) return false;
	return true;
};

/**
 * One tick of the periodic mailbox-sync scheduler (#1247, restructured
 * #1251). Pages through every account (never loading the whole account base
 * into memory), decides per account via `isSyncDue` against the single
 * offline threshold, and enqueues SYNC_MAILBOXES for the accounts that are
 * due — in bounded-concurrency batches, never an unbounded `Promise.all`.
 *
 * Every enqueue goes through the same `triggerAccountSync` the manual
 * POST /sync path uses, with a scheduler-specific, time-bucketed dedup id
 * (`buildScheduledSyncDedupId`, bucketed by `tickIntervalMs`) so this tick
 * can never collide with its own previous tick or with a concurrent manual
 * trigger (see trigger-sync.ts). Concurrent-sync safety for the mailbox
 * itself is MailboxLockService's job, inside the worker handler — this tick
 * only decides "is a sync due" and enqueues; it never talks to IMAP.
 */
export const runSchedulerTick = async (
	deps: RunSchedulerTickDeps,
): Promise<SchedulerTickResult> => {
	const {
		accountService,
		sqsClient,
		queueUrl,
		log,
		offlineIntervalMs,
		tickIntervalMs,
	} = deps;
	const now = deps.now ?? Date.now();

	let cursor: string | undefined;
	let scanned = 0;
	let enqueued = 0;
	let skipped = 0;

	do {
		const page = await accountService.listAllAccountsPage({
			limit: SCHEDULER_PAGE_SIZE,
			cursor,
		});
		scanned += page.items.length;

		const due = page.items.filter(
			(account) =>
				isEligible(account) && isSyncDue(account, now, offlineIntervalMs),
		);
		skipped += page.items.length - due.length;

		await pMap(
			due,
			(account) =>
				triggerAccountSync({
					sqsClient,
					queueUrl,
					accountId: account.accountId,
					dedupId: buildScheduledSyncDedupId(
						account.accountId,
						now,
						tickIntervalMs,
					),
				}),
			{ concurrency: SCHEDULER_ENQUEUE_CONCURRENCY },
		);
		enqueued += due.length;

		cursor = page.cursor ?? undefined;
	} while (cursor);

	log.info({ scanned, enqueued, skipped }, "Scheduled-sync tick complete");

	return { scanned, enqueued, skipped };
};
