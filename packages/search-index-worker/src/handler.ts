import { inspect } from "node:util";
import { NotFoundError } from "@remit/remit-electrodb-service";
import {
	createLogger,
	type Logger,
	MetricUnit,
	metrics,
	withTelemetry,
} from "@remit/logger-lambda";
import type { VectorRecord } from "@remit/search-service";
import type { SQSBatchResponse, SQSEvent, SQSRecord } from "aws-lambda";
import { type ParsedQueueMessage, parseQueueMessage } from "./parse.js";
import { getServices, type Services } from "./services.js";

const log = createLogger();

export const handler = withTelemetry(
	async (event: SQSEvent): Promise<SQSBatchResponse> => {
		const services = await getServices();
		return processBatch(event.Records, services, log);
	},
);

/**
 * A single message's indexing outcome — the pg-only work-summary signal
 * (`remit-search-index-worker/consumer.ts`'s periodic noop/deferred/dropped
 * log) hooks in via `Services.onIndexOutcome`, which is `undefined` on the
 * Lambda path and so never fires there. Purely observational: nothing here
 * feeds back into what gets logged, metriced, or returned to SQS.
 */
export type IndexOutcome =
	| { status: "indexed"; upserted: number; skipped: number }
	| { status: "skipped"; reason: string; retryable: boolean };

export const processBatch = async (
	records: SQSRecord[],
	services: Services,
	log: Logger,
): Promise<SQSBatchResponse> => {
	const batchItemFailures: { itemIdentifier: string }[] = [];
	const processingStart = Date.now();

	for (const record of records) {
		const message = parseQueueMessage(record.body);

		const failed =
			message.kind === "delete"
				? await deleteMessage(message, services, log)
				: await upsertMessage(message, services, log);

		if (failed) {
			batchItemFailures.push({ itemIdentifier: record.messageId });
		}
	}

	metrics.addMetric(
		"searchIndexProcessingDuration",
		MetricUnit.Milliseconds,
		Date.now() - processingStart,
	);

	return { batchItemFailures };
};

const deleteMessage = async (
	message: Extract<ParsedQueueMessage, { kind: "delete" }>,
	services: Services,
	log: Logger,
): Promise<boolean> =>
	services.searchService
		.delete(message.messageId)
		.then(() => {
			log.info("Deleted search vectors", { messageId: message.messageId });
			metrics.addMetric("searchIndexProcessed", MetricUnit.Count, 1);
			return false;
		})
		.catch((error) => {
			log.error("Delete failed", {
				error: inspect(error),
				messageId: message.messageId,
			});
			metrics.addMetric("searchIndexFailures", MetricUnit.Count, 1);
			return true;
		});

// One SQS message = one email's chunks = one upsert. Isolating the
// upsert per message means a record S3 Vectors rejects (e.g. a metadata
// ValidationException) dead-letters on its own — its siblings in the
// batch still index instead of retrying forever behind a poison record.
// Exported so the long-running Postgres consumer (`consumer.ts`) and the
// bulk reindex script (`reindex.ts`) can process one message at a time
// outside the Lambda batch shape, reusing this exact logic.
export const upsertMessage = async (
	message: Extract<ParsedQueueMessage, { kind: "upsert" }>,
	services: Services,
	log: Logger,
): Promise<boolean> =>
	indexMessage(message, services, log)
		.then(() => false)
		.catch((error) => {
			// Name the messageId so the dead-letter is diagnosable per message
			// (#910); a transient/whole-call error retries this message alone.
			log.error("Upsert failed", {
				error: inspect(error),
				accountId: message.accountId,
				messageId: message.messageId,
			});
			metrics.addMetric("searchIndexFailures", MetricUnit.Count, 1);
			return true;
		});

const indexMessage = async (
	message: Extract<ParsedQueueMessage, { kind: "upsert" }>,
	services: Services,
	log: Logger,
): Promise<void> => {
	const vectorRecords = await prepareUpsert(
		message.accountId,
		message.messageId,
		services,
		log,
	);
	if (vectorRecords === null) return;
	if (vectorRecords.length === 0) {
		log.info("No indexable content, skipping", {
			messageId: message.messageId,
		});
		services.onIndexOutcome?.({
			status: "skipped",
			reason: "no-indexable-content",
			retryable: false,
		});
		return;
	}

	// Dedup by chunkId within this single message. The same email can
	// emit a repeated chunkId (deterministic keys); duplicate keys in one
	// PutVectors call are rejected by S3 Vectors.
	const deduped = new Map<string, VectorRecord>();
	for (const vectorRecord of vectorRecords) {
		deduped.set(vectorRecord.chunkId, vectorRecord);
	}
	const upsertRecords = [...deduped.values()];

	const { upserted, skipped } = await services.searchService.upsertVectors(
		upsertRecords,
		{ force: message.force },
	);
	log.info("Upsert complete", {
		accountId: message.accountId,
		messageId: message.messageId,
		upserted,
		skipped,
	});
	metrics.addMetric("searchIndexProcessed", MetricUnit.Count, upserted);
	metrics.addMetric("searchIndexSkipped", MetricUnit.Count, skipped);
	services.onIndexOutcome?.({ status: "indexed", upserted, skipped });
};

const prepareUpsert = async (
	accountIdFromMessage: string,
	messageId: string,
	services: Services,
	log: Logger,
): Promise<VectorRecord[] | null> => {
	const {
		accountService,
		threadMessageService,
		storageService,
		searchService,
		resolveAccountId,
	} = services;

	// On DynamoDB `resolveAccountId` is undefined (the stream bridge already
	// resolved and attached a real accountId to the queue message), so this is
	// exactly `accountIdFromMessage` — unchanged from before this hook existed.
	// On Postgres the queue message carries no real accountId (the outbox
	// trigger fires from a bare message id), so this derives it from the
	// message's mailbox instead (see `data-ports.ts`).
	const accountId = resolveAccountId
		? await resolveAccountId(messageId)
		: accountIdFromMessage;
	if (!accountId) {
		log.info("Account not found for message, skipping", { messageId });
		services.onIndexOutcome?.({
			status: "skipped",
			reason: "account-not-found",
			retryable: false,
		});
		return null;
	}

	let accountConfigId: string;
	try {
		const account = await accountService.get(accountId);
		if (account.deletedAt) {
			log.info("Account deleted, skipping", {
				accountId,
				messageId,
				deletedAt: account.deletedAt,
			});
			services.onIndexOutcome?.({
				status: "skipped",
				reason: "account-deleted",
				retryable: false,
			});
			return null;
		}
		accountConfigId = account.accountConfigId;
	} catch (error) {
		// Only a genuine missing account is skippable. AccessDenied, throttling,
		// and network errors must surface so the record retries (and reaches the
		// DLQ) instead of being silently dropped as if it were a 404.
		if (error instanceof NotFoundError) {
			log.info("Account not found, skipping", { accountId, messageId });
			services.onIndexOutcome?.({
				status: "skipped",
				reason: "account-not-found",
				retryable: false,
			});
			return null;
		}
		throw error;
	}

	const threadMessage = await threadMessageService.findByMessageId(
		accountConfigId,
		messageId,
	);
	if (!threadMessage) {
		log.info("ThreadMessage not found, skipping", { messageId });
		services.onIndexOutcome?.({
			status: "skipped",
			reason: "thread-message-not-found",
			retryable: true,
		});
		return null;
	}

	const parsedBody = await storageService.retrieveParsedBody(
		threadMessage.accountConfigId,
		accountId,
		messageId,
	);
	if (!parsedBody) {
		log.info("Parsed body not found in S3, skipping", { messageId });
		services.onIndexOutcome?.({
			status: "skipped",
			reason: "parsed-body-not-found",
			retryable: true,
		});
		return null;
	}

	return searchService.prepareVectors({
		envelope: {
			from: {
				name: threadMessage.fromName ?? null,
				email: threadMessage.fromEmail ?? "",
			},
			to: [],
			cc: [],
			bcc: [],
			subject: threadMessage.subject ?? "",
			attachments: [],
		},
		parsedBody: {
			text: parsedBody.text,
			html: parsedBody.html,
		},
		metadata: {
			messageId,
			threadId: threadMessage.threadId,
			accountConfigId: threadMessage.accountConfigId,
			mailboxIds: [threadMessage.mailboxId],
			sentDate: threadMessage.sentDate,
			isRead: threadMessage.isRead,
			hasAttachment: threadMessage.hasAttachment,
			hasStars: threadMessage.hasStars,
			fromName: threadMessage.fromName ?? null,
			subject: threadMessage.subject ?? "",
			category: threadMessage.category,
		},
	});
};
