import {
	AccountService,
	AddressService,
	EnvelopeService,
	getClient,
	MailboxService,
	MailboxSpecialUseService,
	MessageService,
	ThreadMessageService,
} from "@remit/remit-electrodb-service";
import type { Logger } from "@remit/logger-lambda";
import {
	BodySyncService,
	MessageMoveService,
} from "@remit/mailbox-service";
import {
	createKmsDataKeyProvider,
	createSecretsService,
} from "@remit/secrets-service";
import { createStorageService } from "@remit/storage-service";
import { env } from "expect-env";
import { isAccountDeleted } from "../account-check.js";
import { isBodySyncEnabled } from "../body-sync-gate.js";
import { createConnectionScopeWithCredentials } from "../connection-scope.js";
import { emitEvent } from "../emit.js";
import type { SyncMessageBodyEvent } from "../events.js";
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
const mailboxSpecialUseService = new MailboxSpecialUseService({
	client,
	table: env.DYNAMODB_TABLE_NAME,
});
const messageService = new MessageService({
	client,
	table: env.DYNAMODB_TABLE_NAME,
});
const threadMessageService = new ThreadMessageService({
	client,
	table: env.DYNAMODB_TABLE_NAME,
});
const addressService = new AddressService({
	client,
	table: env.DYNAMODB_TABLE_NAME,
});
const envelopeService = new EnvelopeService({
	client,
	table: env.DYNAMODB_TABLE_NAME,
});

const bodySyncEnabledParameterName = env.BODY_SYNC_ENABLED_PARAMETER_NAME;

const messageMgmtQueueUrl = process.env.SQS_QUEUE_URL_MESSAGE_MGMT;
const messageMoveService = messageMgmtQueueUrl
	? new MessageMoveService({
			messageService,
			mailboxService,
			mailboxSpecialUseService,
			threadMessageService,
			sqsQueueUrl: messageMgmtQueueUrl,
		})
	: undefined;

export const syncMessageBody = async (
	event: SyncMessageBodyEvent,
	log: Logger,
): Promise<void> => {
	const { accountId, mailboxId, messageIds } = event;

	log.info(
		{
			event: event.type,
			accountId,
			mailboxId,
			messageCount: messageIds.length,
		},
		"Handling event",
	);

	if (!(await isBodySyncEnabled(bodySyncEnabledParameterName, log))) {
		log.info(
			{
				event: event.type,
				accountId,
				mailboxId,
				messageCount: messageIds.length,
			},
			"Body sync paused via SSM toggle, acking and skipping",
		);
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
			const storage = createStorageService();

			const rescueConfig = messageMoveService
				? { mailboxSpecialUseService, messageMoveService }
				: undefined;

			const bodySyncService = new BodySyncService(
				messageService,
				storage,
				threadMessageService,
				addressService,
				envelopeService,
				log,
				rescueConfig,
			);

			const result = await bodySyncService
				.syncBodies(
					messageIds,
					accountId,
					account.accountConfigId,
					mailbox.fullPath,
					scope.getConnection,
				)
				.finally(() => scope.disconnect());

			// Re-enqueue failed messages for retry with jittered delay to avoid thundering herd
			if (result.failedMessageIds.length > 0) {
				const retryDelaySeconds = 20 + Math.floor(Math.random() * 21); // 20-40 seconds
				log.info(
					{ failedCount: result.failedMessageIds.length, retryDelaySeconds },
					"Re-enqueueing failed body syncs with delay",
				);

				const retryEvent: Omit<SyncMessageBodyEvent, "eventId" | "timestamp"> =
					{
						type: "SYNC_MESSAGE_BODY",
						accountId,
						mailboxId,
						messageIds: result.failedMessageIds,
					};
				await emitEvent(retryEvent, { delaySeconds: retryDelaySeconds });
			}
		},
	);
};
