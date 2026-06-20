import {
	type AccountItem,
	AccountService,
	getClient,
	MailboxService,
} from "@remit/remit-electrodb-service";
import { SyncPhase } from "@remit/domain-enums";
import type { Logger } from "@remit/logger-lambda";
import { RefreshTokenError } from "@remit/mail-oauth-service";
import {
	createConnectionWithCredentials,
	MailboxSyncService,
	MailConnectionError,
	type MailCredentials,
} from "@remit/mailbox-service";
import {
	createKmsDataKeyProvider,
	createSecretsService,
} from "@remit/secrets-service";
import { env } from "expect-env";
import pMap from "p-map";
import { isAccountDeleted, isUnsyncableHost } from "../account-check.js";
import { emitEvent } from "../emit.js";
import type { SyncMailboxesEvent, SyncMessagesEvent } from "../events.js";
import { withOAuthLifecycle } from "../with-oauth-lifecycle.js";
import { buildLifecycleDeps } from "../with-oauth-lifecycle-deps.js";
import { orderMailboxesForSync } from "./mailbox-sync-order.js";

const EVENT_EMIT_CONCURRENCY = 20;
const SYNC_COOLDOWN_MS = 30_000; // 30 seconds

const client = getClient();
const dataKeyProvider = createKmsDataKeyProvider(env.KMS_KEY_ID);
const secrets = createSecretsService(dataKeyProvider);

const accountService = new AccountService({
	client,
	table: env.DYNAMODB_TABLE_NAME,
});
const mailboxService = new MailboxService({
	client,
	table: env.DYNAMODB_TABLE_NAME,
});
const mailboxSyncService = new MailboxSyncService({
	client,
	table: env.DYNAMODB_TABLE_NAME,
});

export const syncMailboxes = async (
	event: SyncMailboxesEvent,
	log: Logger,
): Promise<void> => {
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
				await syncMailboxesForAccount(account, credentials, log);
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

	const result = await mailboxSyncService
		.syncMailboxes({ accountId }, connection)
		.finally(() => connection.disconnect());

	await accountService.update(accountId, { lastSyncAt: Date.now() });

	log.info({ result }, "Mailbox sync complete");

	// Get all mailboxes and emit SYNC_MESSAGES for each
	const allMailboxes = await collectAllMailboxes(accountId, mailboxService);

	// Filter out mailboxes that were synced recently (cooldown)
	// Always include mailboxes that were never synced (lastMessageSyncAt is 0, undefined, or null)
	const now = Date.now();
	const mailboxes = allMailboxes.filter(
		(m) => !m.lastMessageSyncAt || now - m.lastMessageSyncAt > SYNC_COOLDOWN_MS,
	);

	const skipped = allMailboxes.length - mailboxes.length;
	if (skipped > 0) {
		log.info({ accountId, skipped }, "Skipped mailboxes due to sync cooldown");
	}

	if (mailboxes.length === 0) {
		log.info({ accountId }, "No mailboxes to sync messages for");
		// If there are no mailboxes to sync, mark as complete
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

	// Phase transition. Completion events only fire for the enqueued
	// (cooldown-filtered) set, so pre-credit the skipped mailboxes into
	// mailboxCountSynced — otherwise synced can never reach total.
	// If INBOX itself was skipped, go straight to syncing_others.
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
	mailboxService: MailboxService,
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
