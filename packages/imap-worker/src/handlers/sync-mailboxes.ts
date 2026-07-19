import { getClient } from "@remit/backend/client";
import type {
	AccountItem,
	IAccountRepository,
	IMailboxRepository,
	IMailboxSpecialUseRepository,
} from "@remit/data-ports";
import { SyncPhase } from "@remit/domain-enums";
import type { Logger } from "@remit/logger-lambda";
import { RefreshTokenError } from "@remit/mail-oauth-service";
import {
	createConnectionWithCredentials,
	MailboxSyncService,
	MailConnectionError,
	type MailCredentials,
} from "@remit/mailbox-service";
import pMap from "p-map";
import { isAccountDeleted, isUnsyncableHost } from "../account-check.js";
import { emitEvent } from "../emit.js";
import type { SyncMailboxesEvent, SyncMessagesEvent } from "../events.js";
import { withOAuthLifecycle } from "../with-oauth-lifecycle.js";
import { buildLifecycleDeps } from "../with-oauth-lifecycle-deps.js";
import { orderMailboxesForSync } from "./mailbox-sync-order.js";

const EVENT_EMIT_CONCURRENCY = 20;

/**
 * How recently a mailbox must have been synced for a side-effect trigger to
 * leave it alone. Short enough that a folder is never more than a minute
 * staler than the trigger that arrived, long enough to collapse the burst a
 * client produces when it loads (`GET /config` triggers a sync per account)
 * into one round of IMAP work.
 *
 * The web client floors its automatic poll at this same window
 * (`MIN_POLL_INTERVAL_MS` in useStaleAccountSync), so the one caller that
 * skips this gate on a timer still cannot drive a fan-out faster than it.
 */
export const MAILBOX_FRESHNESS_MS = 60_000;

/**
 * Whether this fan-out should enqueue a mailbox.
 *
 * A sync asked for by name — POST /sync, which is the refresh control,
 * pull-to-refresh, and the client's automatic poll — always syncs every
 * mailbox, whatever ran a moment ago. A sync that happens as a side effect of
 * something else (config load, OAuth connect, account create, the scheduled
 * tick) skips mailboxes synced inside {@link MAILBOX_FRESHNESS_MS}, which is
 * what stops those triggers from re-enumerating an account's folders on every
 * page load.
 *
 * A mailbox that has never synced is always due.
 */
export const mailboxNeedsSync = (
	mailbox: { lastMessageSyncAt?: number },
	event: Pick<SyncMailboxesEvent, "explicitRequest">,
	now: number,
): boolean => {
	if (event.explicitRequest) return true;
	if (!mailbox.lastMessageSyncAt) return true;
	return now - mailbox.lastMessageSyncAt >= MAILBOX_FRESHNESS_MS;
};

export const syncMailboxes = async (
	event: SyncMailboxesEvent,
	log: Logger,
): Promise<void> => {
	const {
		account: accountService,
		mailbox: mailboxService,
		mailboxSpecialUse: mailboxSpecialUseService,
		secrets,
	} = await getClient();

	const { accountId } = event;
	log.info({ event: event.type, accountId }, "Handling event");

	const account = await accountService.get(accountId);
	if (!account) {
		throw new Error(`Account ${accountId} not found`);
	}

	if (isAccountDeleted(account, log)) {
		return;
	}

	// A reserved/never-resolvable IMAP host (RFC 2606) can never connect, so a
	// sync attempt would retry and dead-letter forever. Skip cleanly — ack the
	// event without connecting or throwing.
	if (isUnsyncableHost(account, log)) {
		return;
	}

	// withOAuthLifecycle owns the reauth/ACK contract (skip-if-reauth, flip on
	// terminal auth failure, rethrow transient). The inner try/catch only
	// records the terminal non-auth error phase before letting the wrapper
	// rethrow for SQS retry/DLQ.
	await withOAuthLifecycle(
		buildLifecycleDeps(secrets, accountService),
		account,
		log,
		async (credentials) => {
			try {
				await syncMailboxesForAccount(
					event,
					account,
					credentials,
					mailboxService,
					mailboxSpecialUseService,
					accountService,
					log,
				);
			} catch (err) {
				// Auth failures are handled by the wrapper — rethrow untouched so it
				// flips the account to reauth_required rather than recording an error
				// phase.
				if (
					err instanceof RefreshTokenError ||
					(err instanceof MailConnectionError && err.kind === "auth")
				) {
					throw err;
				}
				// Record the terminal error phase before crashing (let-it-crash:
				// record state, then rethrow so the event is retried/DLQ'd).
				const message = err instanceof Error ? err.message : String(err);
				await accountService.update(accountId, {
					syncPhase: SyncPhase.error,
					lastError: message,
				});
				throw err;
			}
		},
	);
};

const syncMailboxesForAccount = async (
	event: SyncMailboxesEvent,
	account: AccountItem,
	credentials: MailCredentials,
	mailboxService: IMailboxRepository,
	mailboxSpecialUseService: IMailboxSpecialUseRepository,
	accountService: IAccountRepository,
	log: Logger,
): Promise<void> => {
	const { accountId } = account;

	const connection = createConnectionWithCredentials(
		{
			username: account.username,
			imapHost: account.imapHost,
			imapPort: account.imapPort,
			imapTls: account.imapTls,
		},
		credentials,
	);

	await connection.connect();

	await accountService.markAuthenticated(accountId);

	// Phase transition: discovering mailboxes
	await accountService.update(accountId, {
		syncPhase: SyncPhase.discovering_mailboxes,
	});

	const mailboxSyncService = new MailboxSyncService(
		mailboxService,
		mailboxSpecialUseService,
	);

	const result = await mailboxSyncService
		.syncMailboxes({ accountId }, connection)
		.finally(() => connection.disconnect());

	await accountService.update(accountId, { lastSyncAt: Date.now() });

	log.info({ result }, "Mailbox sync complete");

	const allMailboxes = await collectAllMailboxes(accountId, mailboxService);

	// This fan-out is where an account's IMAP work is decided: one SEARCH per
	// mailbox per event, on a queue every account shares. `GET /config` fires a
	// trigger per account on every call, so without a gate here an idle client
	// re-enumerates every folder it owns on every page load.
	//
	// The gate is per mailbox and a sync asked for by name skips it outright.
	// That distinction is the whole point: the previous cooldown gated
	// everything, which is what made a refresh a no-op whenever a side-effect
	// trigger had just run (issue #37).
	const now = Date.now();
	const mailboxes = allMailboxes.filter((mailbox) =>
		mailboxNeedsSync(mailbox, event, now),
	);

	const skipped = allMailboxes.length - mailboxes.length;
	if (skipped > 0) {
		log.info(
			{ accountId, skipped },
			"Skipped recently-synced mailboxes for a side-effect trigger",
		);
	}

	if (allMailboxes.length === 0) {
		log.info({ accountId }, "No mailboxes to sync messages for");
		await accountService.update(accountId, {
			syncPhase: SyncPhase.complete,
			mailboxCountTotal: 0,
			mailboxCountSynced: 0,
		});
		return;
	}

	if (mailboxes.length === 0) {
		log.info({ accountId }, "Every mailbox is fresh; nothing to sync");
		await accountService.update(accountId, {
			syncPhase: SyncPhase.complete,
			mailboxCountTotal: allMailboxes.length,
			mailboxCountSynced: allMailboxes.length,
		});
		return;
	}

	log.info(
		{ accountId, count: mailboxes.length },
		"Emitting SYNC_MESSAGES events",
	);

	// Phase transition. Only the enqueued mailboxes emit a completion, so the
	// gated ones are pre-credited — otherwise synced could never reach total.
	//
	// The counter is progress through THIS round, not a lifetime total: a new
	// round restarts it, which is why it can read lower than a moment ago while
	// a previous round is still draining. That is the same instant
	// `account.lastSyncAt` is stamped, and the per-mailbox completion guard in
	// sync-messages.ts keys off exactly that stamp — so a completion still in
	// flight from the previous round counts once towards the new one, and each
	// mailbox counts at most once per round.
	const inboxEnqueued = mailboxes.some(
		(m) => m.fullPath.toUpperCase() === "INBOX",
	);
	await accountService.update(accountId, {
		syncPhase: inboxEnqueued
			? SyncPhase.syncing_inbox
			: SyncPhase.syncing_others,
		mailboxCountTotal: allMailboxes.length,
		mailboxCountSynced: skipped,
	});

	// Emit events in parallel with concurrency limit
	// INBOX is first in the sorted list, so it gets priority
	await pMap(
		mailboxes,
		({ mailboxId }) => {
			const syncEvent: Omit<SyncMessagesEvent, "eventId" | "timestamp"> = {
				type: "SYNC_MESSAGES",
				accountId,
				mailboxId,
			};
			return emitEvent(syncEvent);
		},
		{ concurrency: EVENT_EMIT_CONCURRENCY },
	);
};

type MailboxSortEntry = {
	mailboxId: string;
	fullPath: string;
	lastMessageSyncAt: number;
	specialUse?: readonly string[];
};

/**
 * Collect all mailboxes for an account, ordered for sync fan-out by
 * special-use: INBOX first, then Sent/Drafts, then normal folders, with
 * Junk/Spam and Trash last (issue #567). Real mail dispatches ahead of bulk
 * folders so a fresh account fills its inbox before its spam.
 */
const collectAllMailboxes = async (
	accountId: string,
	mailboxService: IMailboxRepository,
): Promise<MailboxSortEntry[]> => {
	const mailboxes: MailboxSortEntry[] = [];
	let continuationToken: string | undefined;

	do {
		const result = await mailboxService.listByAccount(accountId, {
			continuationToken,
		});

		for (const mailbox of result.items) {
			mailboxes.push({
				mailboxId: mailbox.mailboxId,
				fullPath: mailbox.fullPath,
				lastMessageSyncAt: mailbox.lastMessageSyncAt,
				specialUse: mailbox.specialUse,
			});
		}

		continuationToken = result.continuationToken ?? undefined;
	} while (continuationToken);

	return orderMailboxesForSync(mailboxes);
};
