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

	// Every mailbox is fanned out on every SYNC_MAILBOXES event. A recency
	// filter here used to drop mailboxes synced in the last 30 seconds, which
	// made a sync the user asked for a no-op whenever a sync had just run —
	// exactly when new mail is most likely to be waiting (issue #37). Deciding
	// whether a sync is warranted belongs to whoever enqueues SYNC_MAILBOXES:
	// the scheduler's own interval, or a person pressing refresh. A mailbox with
	// nothing new costs one SEARCH and returns, and a fan-out that overlaps a
	// sync already running is collapsed by MailboxLockService.
	const mailboxes = await collectAllMailboxes(accountId, mailboxService);

	if (mailboxes.length === 0) {
		log.info({ accountId }, "No mailboxes to sync messages for");
		await accountService.update(accountId, {
			syncPhase: SyncPhase.complete,
			mailboxCountTotal: 0,
			mailboxCountSynced: 0,
		});
		return;
	}

	log.info(
		{ accountId, count: mailboxes.length },
		"Emitting SYNC_MESSAGES events",
	);

	// Phase transition. Every mailbox is enqueued, so the synced counter starts
	// at zero and each completion event drives it towards the total.
	const inboxEnqueued = mailboxes.some(
		(m) => m.fullPath.toUpperCase() === "INBOX",
	);
	await accountService.update(accountId, {
		syncPhase: inboxEnqueued
			? SyncPhase.syncing_inbox
			: SyncPhase.syncing_others,
		mailboxCountTotal: mailboxes.length,
		mailboxCountSynced: 0,
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
				specialUse: mailbox.specialUse,
			});
		}

		continuationToken = result.continuationToken ?? undefined;
	} while (continuationToken);

	return orderMailboxesForSync(mailboxes);
};
