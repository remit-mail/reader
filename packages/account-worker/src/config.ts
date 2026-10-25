import { getClient } from "@remit/backend/client";
import type { GroupedQueueProducer, QueueProducer } from "@remit/data-ports";
import {
	createGroupedQueueProducer,
	createStandardQueueProducer,
} from "@remit/sqs-client/producer";
import type { StorageService } from "@remit/storage-service";
import { createStorageService } from "@remit/storage-service/s3";
import { env } from "expect-env";
import type { CascadeServices } from "./cascade.js";
import type {
	AccountDataPurgeFinalizeEvent,
	AccountFinalizeEvent,
} from "./events.js";

// SQS env vars are lazy-evaluated. The fanout worker needs them at handler time;
// the finalize worker imports `getCascadeServices` from this module but talks to
// no queue, so its Lambda doesn't carry the env vars. Eager evaluation here would
// crash finalize at module load — getters defer the read to the fanout-only call
// sites.
export const getAccountFinalizeQueueUrl = (): string =>
	env.SQS_QUEUE_URL_ACCOUNT_FINALIZE;
export const getAccountPurgeDeleteQueueUrl = (): string =>
	env.SQS_QUEUE_URL_ACCOUNT_PURGE_DELETE;

export interface FanoutQueues {
	accountFinalize: QueueProducer<AccountFinalizeEvent>;
	accountPurgeDelete: GroupedQueueProducer<AccountDataPurgeFinalizeEvent>;
}

export const sqsFanoutQueues = (): FanoutQueues => ({
	accountFinalize: createStandardQueueProducer({
		queueUrl: getAccountFinalizeQueueUrl(),
	}),
	accountPurgeDelete: createGroupedQueueProducer({
		queueUrl: getAccountPurgeDeleteQueueUrl(),
	}),
});

// The RemitClient is resolved lazily and cached, not at module load: the
// DynamoDB backend is injected by the composition root before the first cascade
// runs, so building at import time would race the registration.
let cascadeServicesPromise: Promise<CascadeServices> | null = null;

// Every cascade service is a `RemitClient` repository, so the whole enumeration
// runs on whatever backend `getClient()` resolved — DynamoDB (ElectroDB) or
// SQLite (Drizzle). Filter/Label/MessageLabel (Smart Organize,
// RFC 034) are present on both via the client, so they need no
// backend-specific wiring here.
export const getCascadeServices = (): Promise<CascadeServices> => {
	if (!cascadeServicesPromise) {
		cascadeServicesPromise = getClient().then((remitClient) => ({
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
			labelService: remitClient.label,
			messageLabelService: remitClient.messageLabel,
		}));
	}
	return cascadeServicesPromise;
};

let storageService: StorageService | null = null;
export const getStorageService = (): StorageService => {
	if (!storageService) {
		storageService = createStorageService();
	}
	return storageService;
};
