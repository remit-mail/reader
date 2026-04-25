import {
	AccountService,
	getClient,
	MailboxService,
} from "@remit/remit-electrodb-service";
import type { Logger } from "@remit/remit-logger-lambda";
import {
	createConnectionFromAccount,
	MailboxSyncService,
} from "@remit/mailbox-service";
import {
	createKmsDataKeyProvider,
	createSecretsService,
	deserializeEncryptedPayload,
} from "@remit/secrets-service";
import { env } from "expect-env";
import pMap from "p-map";
import { isAccountDeleted } from "../account-check.js";
import { emitEvent } from "../emit.js";
import type { SyncMailboxesEvent, SyncMessagesEvent } from "../events.js";

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

	const password = await secrets.decrypt(
		deserializeEncryptedPayload(JSON.parse(account.passwordHash)),
	);

	const connection = createConnectionFromAccount(
		{
			username: account.username,
			imapHost: account.imapHost,
			imapPort: account.imapPort,
			imapTls: account.imapTls,
		},
		password,
	);

	await connection.connect();

	await accountService.markAuthenticated(accountId);

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
		return;
	}

	log.info(
		{ accountId, count: mailboxes.length },
		"Emitting SYNC_MESSAGES events",
	);

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
};

/**
 * Collect all mailboxes for an account, sorted with INBOX first, then alphabetically by path.
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
			});
		}

		continuationToken = result.continuationToken ?? undefined;
	} while (continuationToken);

	// Sort: INBOX first, then alphabetically by fullPath
	return mailboxes.sort((a, b) => {
		const aIsInbox = a.fullPath.toUpperCase() === "INBOX";
		const bIsInbox = b.fullPath.toUpperCase() === "INBOX";

		if (aIsInbox && !bIsInbox) return -1;
		if (!aIsInbox && bIsInbox) return 1;

		return a.fullPath.localeCompare(b.fullPath);
	});
};
