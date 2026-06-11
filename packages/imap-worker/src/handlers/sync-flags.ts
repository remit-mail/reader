import {
	AccountService,
	getClient,
	MailboxService,
	MessageFlagService,
	MessageService,
} from "@remit/remit-electrodb-service";
import type { Logger } from "@remit/logger-lambda";
import { FlagSyncService } from "@remit/mailbox-service";
import {
	createKmsDataKeyProvider,
	createSecretsService,
} from "@remit/secrets-service";
import { env } from "expect-env";
import { isAccountDeleted } from "../account-check.js";
import { createConnectionScopeWithCredentials } from "../connection-scope.js";
import type { SyncFlagsEvent } from "../events.js";
import { withOAuthLifecycle } from "../with-oauth-lifecycle.js";
import { buildLifecycleDeps } from "../with-oauth-lifecycle-deps.js";

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
const messageService = new MessageService({
	client,
	table: env.DYNAMODB_TABLE_NAME,
});
const messageFlagService = new MessageFlagService({
	client,
	table: env.DYNAMODB_TABLE_NAME,
});

export const syncFlags = async (
	event: SyncFlagsEvent,
	log: Logger,
): Promise<void> => {
	const { accountId, mailboxId, operations } = event;

	log.info(
		{
			event: event.type,
			accountId,
			mailboxId,
			operationCount: operations.length,
		},
		"Handling event",
	);

	if (operations.length === 0) {
		log.info({ accountId, mailboxId }, "No flag operations to sync");
		return;
	}

	const account = await accountService.get(accountId);
	if (!account) {
		throw new Error(`Account ${accountId} not found`);
	}

	if (isAccountDeleted(account, log)) {
		return;
	}

	await withOAuthLifecycle(
		buildLifecycleDeps(secrets, accountService),
		account,
		log,
		async (credentials) => {
			const scope = createConnectionScopeWithCredentials(account, credentials);
			const mailbox = await mailboxService.get(mailboxId);

			const flagSyncService = new FlagSyncService(
				messageFlagService,
				messageService,
				log,
			);

			// Open mailbox for write operations (readOnly = false)
			const connection = await scope.getConnection();
			await connection.openBox(mailbox.fullPath, false);

			await flagSyncService
				.syncToImap(operations, () => Promise.resolve(connection))
				.then((result) => {
					log.info(
						{
							accountId,
							mailboxId,
							successCount: result.successCount,
							failedCount: result.failedCount,
							errors: result.errors,
						},
						"Flag sync completed",
					);

					if (result.failedCount > 0) {
						log.error({ errors: result.errors }, "Some flag operations failed");
					}
				})
				.finally(() => scope.disconnect());
		},
	);
};
