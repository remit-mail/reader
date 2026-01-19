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
import { emitEvent } from "../emit.js";
import type { SyncMailboxesEvent, SyncMessagesEvent } from "../events.js";

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
	log.info({ accountId }, "Syncing mailboxes");

	const account = await accountService.get(accountId);
	if (!account) {
		throw new Error(`Account ${accountId} not found`);
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

	const result = await mailboxSyncService
		.syncMailboxes({ accountId }, connection)
		.finally(() => connection.disconnect());

	log.info({ result }, "Mailbox sync complete");

	// Get all mailboxes and emit SYNC_MESSAGES for each
	const mailboxes = await collectAllMailboxes(accountId, mailboxService);

	if (mailboxes.length === 0) {
		log.info({ accountId }, "No mailboxes to sync messages for");
		return;
	}

	log.info(
		{ accountId, count: mailboxes.length },
		"Emitting SYNC_MESSAGES events",
	);

	// Emit events sequentially to preserve priority order (INBOX first)
	for (const { mailboxId } of mailboxes) {
		const syncEvent: Omit<SyncMessagesEvent, "eventId" | "timestamp"> = {
			type: "SYNC_MESSAGES",
			accountId,
			mailboxId,
		};
		await emitEvent(syncEvent);
	}
};

type MailboxSortEntry = { mailboxId: string; fullPath: string };

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
