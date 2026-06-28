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
		const services = getServices();
		return processBatch(event.Records, services, log);
	},
);

export const processBatch = async (
	records: SQSRecord[],
	services: Services,
	log: Logger,
): Promise<SQSBatchResponse> => {
	const batchItemFailures: { itemIdentifier: string }[] = [];
	const processingStart = Date.now();

	for (const record of records) {
		let message: ParsedQueueMessage;
		try {
			message = parseQueueMessage(record.body);
		} catch (error) {
			log.error("Failed to parse message", {
				error: inspect(error),
				messageId: record.messageId,
			});
			batchItemFailures.push({ itemIdentifier: record.messageId });
			continue;
		}

		if (message.kind === "delete") {
			try {
				await services.searchService.delete(message.messageId);
				log.info("Deleted search vectors", { messageId: message.messageId });
				metrics.addMetric("searchIndexProcessed", MetricUnit.Count, 1);
			} catch (error) {
				log.error("Delete failed", {
					error: inspect(error),
					messageId: message.messageId,
				});
				metrics.addMetric("searchIndexFailures", MetricUnit.Count, 1);
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
			continue;
		}

		// One SQS message = one email's chunks = one upsert. Isolating the
		// upsert per message means a record S3 Vectors rejects (e.g. a metadata
		// ValidationException) dead-letters on its own — its siblings in the
		// batch still index instead of retrying forever behind a poison record.
		try {
			const vectorRecords = await prepareUpsert(
				message.accountId,
				message.messageId,
				services,
				log,
			);
			if (vectorRecords === null) continue;
			if (vectorRecords.length === 0) {
				log.info("No indexable content, skipping", {
					messageId: message.messageId,
				});
				continue;
			}

			// Dedup by chunkId within this single message. The same email can
			// emit a repeated chunkId (deterministic keys); duplicate keys in one
			// PutVectors call are rejected by S3 Vectors.
			const deduped = new Map<string, VectorRecord>();
			for (const vectorRecord of vectorRecords) {
				deduped.set(vectorRecord.chunkId, vectorRecord);
			}
			const upsertRecords = [...deduped.values()];

			await services.searchService.upsertVectors(upsertRecords);
			log.info("Upsert complete", {
				accountId: message.accountId,
				messageId: message.messageId,
				count: upsertRecords.length,
			});
			metrics.addMetric(
				"searchIndexProcessed",
				MetricUnit.Count,
				upsertRecords.length,
			);
		} catch (error) {
			// Name the messageId so the dead-letter is diagnosable per message
			// (#910); a transient/whole-call error retries this message alone.
			log.error("Upsert failed", {
				error: inspect(error),
				accountId: message.accountId,
				messageId: message.messageId,
			});
			metrics.addMetric("searchIndexFailures", MetricUnit.Count, 1);
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

const prepareUpsert = async (
	accountId: string,
	messageId: string,
	services: Services,
	log: Logger,
): Promise<VectorRecord[] | null> => {
	const {
		accountService,
		threadMessageService,
		storageService,
		searchService,
	} = services;

	try {
		const account = await accountService.get(accountId);
		if (account.deletedAt) {
			log.info("Account deleted, skipping", {
				accountId,
				messageId,
				deletedAt: account.deletedAt,
			});
			return null;
		}
	} catch (error) {
		// Only a genuine missing account is skippable. AccessDenied, throttling,
		// and network errors must surface so the record retries (and reaches the
		// DLQ) instead of being silently dropped as if it were a 404.
		if (error instanceof NotFoundError) {
			log.info("Account not found, skipping", { accountId, messageId });
			return null;
		}
		throw error;
	}

	const threadMessage = await threadMessageService.findByMessageId(messageId);
	if (!threadMessage) {
		log.info("ThreadMessage not found, skipping", { messageId });
		return null;
	}

	const parsedBody = await storageService.retrieveParsedBody(
		threadMessage.accountConfigId,
		accountId,
		messageId,
	);
	if (!parsedBody) {
		log.info("Parsed body not found in S3, skipping", { messageId });
		return null;
	}

	await searchService.delete(messageId);

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
		},
	});
};
