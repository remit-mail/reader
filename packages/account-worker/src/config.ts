import { SQSClient } from "@aws-sdk/client-sqs";
import { getClient } from "@remit/backend/client";
import { resolveSqsCredentials } from "@remit/sqs-client";
import type { StorageService } from "@remit/storage-service";
import { createStorageService } from "@remit/storage-service/s3";
import { env } from "expect-env";
import type { CascadeServices } from "./cascade.js";

const remitClient = await getClient();

export const sqsClient = new SQSClient({
	credentials: resolveSqsCredentials(),
});

// SQS env vars are lazy-evaluated. The fanout worker needs them at handler time;
// the finalize worker imports `cascadeServices` from this module but talks to no
// queue, so its Lambda doesn't carry the env vars. Eager evaluation here would
// crash finalize at module load — getters defer the read to the fanout-only call
// sites.
export const getSearchIndexQueueUrl = (): string =>
	env.SQS_QUEUE_URL_SEARCH_INDEX;
export const getImapWorkerQueueUrl = (): string =>
	env.SQS_QUEUE_URL_IMAP_WORKER;
export const getAccountFinalizeQueueUrl = (): string =>
	env.SQS_QUEUE_URL_ACCOUNT_FINALIZE;
export const getAccountPurgeDeleteQueueUrl = (): string =>
	env.SQS_QUEUE_URL_ACCOUNT_PURGE_DELETE;

const graceSecondsRaw = process.env.ACCOUNT_DELETION_GRACE_SECONDS;
export const graceSeconds = graceSecondsRaw
	? Number.parseInt(graceSecondsRaw, 10)
	: 60;

// Every cascade service is a `RemitClient` repository, so the whole enumeration
// runs on whatever backend `getClient()` selected — DynamoDB (ElectroDB),
// Postgres, or SQLite (Drizzle). Filter/FilterAnchor/Label/MessageLabel (Smart
// Organize, RFC 034) are present on all three backends via the client, so they
// need no backend-specific wiring here.
export const cascadeServices: CascadeServices = {
	accountConfigService: remitClient.accountConfig,
	accountService: remitClient.account,
	addressService: remitClient.address,
	mailboxService: remitClient.mailbox,
	messageService: remitClient.message,
	messageFlagService: remitClient.messageFlag,
	envelopeService: remitClient.envelope,
	outboxMessageService: remitClient.outboxMessage,
	threadMessageService: remitClient.threadMessage,
	mailboxLockService: remitClient.mailboxLock,
	messagePlacementMoveService: remitClient.placementMove,
	messageFlagPushService: remitClient.flagPush,
	accountExportRequestService: remitClient.accountExportRequest,
	accountSettingService: remitClient.accountSetting,
	filterService: remitClient.filter,
	filterAnchorService: remitClient.filterAnchor,
	labelService: remitClient.label,
	messageLabelService: remitClient.messageLabel,
};

export const accountConfigService = cascadeServices.accountConfigService;

let storageService: StorageService | null = null;
export const getStorageService = (): StorageService => {
	if (!storageService) {
		storageService = createStorageService();
	}
	return storageService;
};

export const dataBackend = process.env.DATA_BACKEND;
