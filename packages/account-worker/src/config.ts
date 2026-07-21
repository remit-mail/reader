import type { SQSClient } from "@aws-sdk/client-sqs";
import { getClient } from "@remit/backend/client";
import { createQueueProducer } from "@remit/sqs-client/producer";
import type { StorageService } from "@remit/storage-service";
import { createStorageService } from "@remit/storage-service/s3";
import { env } from "expect-env";
import type { CascadeServices } from "./cascade.js";

// A client per queue URL, resolved at send time rather than at import. The
// endpoint and wire protocol are derived from the URL, so a self-hosted stack
// (http://queue:9324/...) gets the query protocol its queue server speaks while
// real SQS keeps the default. Building at import is not an option: the queue
// URLs are read lazily for the reason given below.
const sqsClients = new Map<string, SQSClient>();

export const getSqsClient = (queueUrl: string): SQSClient => {
	const existing = sqsClients.get(queueUrl);
	if (existing) return existing;
	const client = createQueueProducer({ queueUrl });
	sqsClients.set(queueUrl, client);
	return client;
};

// SQS env vars are lazy-evaluated. The fanout worker needs them at handler time;
// the finalize worker imports `getCascadeServices` from this module but talks to
// no queue, so its Lambda doesn't carry the env vars. Eager evaluation here would
// crash finalize at module load — getters defer the read to the fanout-only call
// sites.
export const getSearchIndexQueueUrl = (): string =>
	env.SQS_QUEUE_URL_SEARCH_INDEX;
// Optional, and read through `process.env` rather than expect-env so an unset
// var yields undefined instead of throwing. IMAP_WORKER_STOP is a no-op
// acknowledgement in the cascade contract — the account tombstone fence is what
// actually halts the worker — so a deployment that never provisions a dedicated
// imap-worker stop queue (the self-host compose stacks) skips the signal rather
// than failing the whole fanout. AWS sets the var and keeps sending it.
export const getImapWorkerQueueUrl = (): string | undefined =>
	process.env.SQS_QUEUE_URL_IMAP_WORKER;
export const getAccountFinalizeQueueUrl = (): string =>
	env.SQS_QUEUE_URL_ACCOUNT_FINALIZE;
export const getAccountPurgeDeleteQueueUrl = (): string =>
	env.SQS_QUEUE_URL_ACCOUNT_PURGE_DELETE;

const graceSecondsRaw = process.env.ACCOUNT_DELETION_GRACE_SECONDS;
export const graceSeconds = graceSecondsRaw
	? Number.parseInt(graceSecondsRaw, 10)
	: 60;

// The RemitClient is resolved lazily and cached, not at module load: the
// DynamoDB backend is injected by the composition root before the first cascade
// runs, so building at import time would race the registration.
let cascadeServicesPromise: Promise<CascadeServices> | null = null;

// Every cascade service is a `RemitClient` repository, so the whole enumeration
// runs on whatever backend `getClient()` selected — DynamoDB (ElectroDB),
// Postgres, or SQLite (Drizzle). Filter/FilterAnchor/Label/MessageLabel (Smart
// Organize, RFC 034) are present on all three backends via the client, so they
// need no backend-specific wiring here.
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
			filterAnchorService: remitClient.filterAnchor,
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

export const dataBackend = process.env.DATA_BACKEND;
