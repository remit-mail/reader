import {
	AccountService,
	getClient,
	MailboxService,
} from "@remit/remit-electrodb-service";
import { MailboxSyncStatus } from "@remit/domain-enums";
import type { Logger } from "@remit/remit-logger-lambda";
import { MailboxManagementService } from "@remit/mailbox-service";
import {
	createKmsDataKeyProvider,
	createSecretsService,
	deserializeEncryptedPayload,
} from "@remit/secrets-service";
import { env } from "expect-env";
import { isAccountDeleted } from "../account-check.js";
import { createConnectionScopeFromAccount } from "../connection-scope.js";
import type {
	MailboxCreateEvent,
	MailboxDeleteEvent,
	MailboxManagementEvent,
	MailboxRenameEvent,
} from "../events.js";

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

/**
 * Handle MAILBOX_CREATE event
 */
const handleCreate = async (
	event: MailboxCreateEvent,
	log: Logger,
): Promise<void> => {
	const { accountId, mailboxId, path, subscribe } = event;

	log.info({ accountId, mailboxId, path }, "Creating mailbox on IMAP");

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

	const scope = createConnectionScopeFromAccount(account, password);
	const managementService = new MailboxManagementService(mailboxService, log);

	await managementService
		.syncCreate(mailboxId, path, scope.getConnection, subscribe)
		.then((result) => {
			if (result.success) {
				log.info({ accountId, mailboxId, path }, "Mailbox created on IMAP");
			} else {
				log.error(
					{ accountId, mailboxId, path, error: result.error },
					"Failed to create mailbox on IMAP",
				);
			}
		})
		.catch(async (error) => {
			// Check if mailbox already exists (idempotent)
			if (error instanceof Error && error.message.includes("already exists")) {
				log.info(
					{ accountId, mailboxId, path },
					"Mailbox already exists, marking as synced",
				);
				await mailboxService.update(mailboxId, {
					syncStatus: MailboxSyncStatus.synced,
				});
			} else {
				await mailboxService.update(mailboxId, {
					syncStatus: MailboxSyncStatus.failed,
				});
				throw error;
			}
		})
		.finally(() => scope.disconnect());
};

/**
 * Handle MAILBOX_RENAME event
 */
const handleRename = async (
	event: MailboxRenameEvent,
	log: Logger,
): Promise<void> => {
	const { accountId, mailboxId, oldPath, newPath } = event;

	log.info(
		{ accountId, mailboxId, oldPath, newPath },
		"Renaming mailbox on IMAP",
	);

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

	const scope = createConnectionScopeFromAccount(account, password);
	const managementService = new MailboxManagementService(mailboxService, log);

	await managementService
		.syncRename(mailboxId, oldPath, newPath, scope.getConnection)
		.then((result) => {
			if (result.success) {
				log.info(
					{ accountId, mailboxId, oldPath, newPath },
					"Mailbox renamed on IMAP",
				);
			} else {
				log.error(
					{ accountId, mailboxId, oldPath, newPath, error: result.error },
					"Failed to rename mailbox on IMAP",
				);
			}
		})
		.catch(async (error) => {
			// If source not found, delete local mailbox
			if (error instanceof Error && error.message.includes("not found")) {
				log.info(
					{ accountId, mailboxId, oldPath },
					"Source mailbox not found, deleting local",
				);
				await mailboxService.delete(mailboxId);
			} else {
				// Rollback local rename by restoring old path
				await mailboxService.update(mailboxId, {
					fullPath: oldPath,
					oldPath: undefined,
					syncStatus: MailboxSyncStatus.failed,
				});
				throw error;
			}
		})
		.finally(() => scope.disconnect());
};

/**
 * Handle MAILBOX_DELETE event
 */
const handleDelete = async (
	event: MailboxDeleteEvent,
	log: Logger,
): Promise<void> => {
	const { accountId, mailboxId, path } = event;

	log.info({ accountId, mailboxId, path }, "Deleting mailbox on IMAP");

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

	const scope = createConnectionScopeFromAccount(account, password);
	const managementService = new MailboxManagementService(mailboxService, log);

	await managementService
		.syncDelete(mailboxId, path, scope.getConnection)
		.then((result) => {
			if (result.success) {
				log.info({ accountId, mailboxId, path }, "Mailbox deleted on IMAP");
			} else {
				log.error(
					{ accountId, mailboxId, path, error: result.error },
					"Failed to delete mailbox on IMAP",
				);
			}
		})
		.catch(async (error) => {
			// If mailbox not found, it's already deleted (idempotent)
			if (error instanceof Error && error.message.includes("not found")) {
				log.info(
					{ accountId, mailboxId, path },
					"Mailbox not found on IMAP, deleting local",
				);
				await mailboxService.delete(mailboxId);
			} else if (
				error instanceof Error &&
				error.message.includes("Cannot delete INBOX")
			) {
				// Restore the mailbox
				await mailboxService.update(mailboxId, {
					syncStatus: MailboxSyncStatus.synced,
				});
				log.error(
					{ accountId, mailboxId, path },
					"Cannot delete INBOX, restoring mailbox",
				);
				// Don't rethrow - this is an expected error
			} else {
				// Restore the mailbox on other errors
				await mailboxService.update(mailboxId, {
					syncStatus: MailboxSyncStatus.failed,
				});
				throw error;
			}
		})
		.finally(() => scope.disconnect());
};

/**
 * Process mailbox management events
 */
export const processMailboxManagement = async (
	event: MailboxManagementEvent,
	log: Logger,
): Promise<void> => {
	switch (event.type) {
		case "MAILBOX_CREATE":
			return handleCreate(event, log);
		case "MAILBOX_RENAME":
			return handleRename(event, log);
		case "MAILBOX_DELETE":
			return handleDelete(event, log);
	}
};
