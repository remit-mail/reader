import { inspect } from "node:util";
import {
	createLogger,
	type Logger,
	MetricUnit,
	metrics,
	withTelemetry,
} from "@remit/remit-logger-lambda";
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

type AccountGroup = {
	records: VectorRecord[];
	sqsMessageIds: string[];
};

export const processBatch = async (
	records: SQSRecord[],
	services: Services,
	log: Logger,
): Promise<SQSBatchResponse> => {
	const batchItemFailures: { itemIdentifier: string }[] = [];
	const accountGroups = new Map<string, AccountGroup>();

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

		const lagMs = Date.now() - message.eventTimestamp;
		metrics.addMetric("searchIndexLag", MetricUnit.Milliseconds, lagMs);

		try {
			const vectorRecords = await prepareUpsert(
				message.accountId,
				message.messageId,
				services,
				log,
			);
			if (vectorRecords === null) continue;
			if (vectorRecords.length === 0) continue;

			const group = accountGroups.get(message.accountId) ?? {
				records: [],
				sqsMessageIds: [],
			};
			group.records.push(...vectorRecords);
			group.sqsMessageIds.push(record.messageId);
			accountGroups.set(message.accountId, group);
		} catch (error) {
			log.error("Preparation failed", {
				error: inspect(error),
				messageId: message.messageId,
			});
			metrics.addMetric("searchIndexFailures", MetricUnit.Count, 1);
			batchItemFailures.push({ itemIdentifier: record.messageId });
		}
	}

	for (const [accountId, group] of accountGroups) {
		try {
			await services.searchService.upsertVectors(group.records);
			log.info("Bulk upsert complete", {
				accountId,
				count: group.records.length,
			});
			metrics.addMetric(
				"searchIndexProcessed",
				MetricUnit.Count,
				group.records.length,
			);
		} catch (error) {
			log.error("Bulk upsert failed", { error: inspect(error), accountId });
			metrics.addMetric("searchIndexFailures", MetricUnit.Count, 1);
			for (const sqsMessageId of group.sqsMessageIds) {
				batchItemFailures.push({ itemIdentifier: sqsMessageId });
			}
		}
	}

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
	} catch {
		log.info("Account not found, skipping", { accountId, messageId });
		return null;
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
