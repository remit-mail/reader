import { inspect } from "node:util";
import { createLogger, type Logger } from "@remit/remit-logger-lambda";
import type { VectorRecord } from "@remit/search-service";
import type {
	Context,
	SQSBatchResponse,
	SQSEvent,
	SQSHandler,
	SQSRecord,
} from "aws-lambda";
import { type ParsedQueueMessage, parseQueueMessage } from "./parse.js";
import { getServices, type Services } from "./services.js";

export const handler: SQSHandler = async (
	event: SQSEvent,
	context: Context,
): Promise<SQSBatchResponse> => {
	const log = createLogger(context);
	const services = getServices();
	return processBatch(event.Records, services, log);
};

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
			log.error(
				{ error: inspect(error), messageId: record.messageId },
				"Failed to parse message",
			);
			batchItemFailures.push({ itemIdentifier: record.messageId });
			continue;
		}

		if (message.kind === "delete") {
			try {
				await services.searchService.delete(message.messageId);
				log.info({ messageId: message.messageId }, "Deleted search vectors");
			} catch (error) {
				log.error(
					{ error: inspect(error), messageId: message.messageId },
					"Delete failed",
				);
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
			continue;
		}

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
			log.error(
				{ error: inspect(error), messageId: message.messageId },
				"Preparation failed",
			);
			batchItemFailures.push({ itemIdentifier: record.messageId });
		}
	}

	for (const [accountId, group] of accountGroups) {
		try {
			await services.searchService.upsertVectors(group.records);
			log.info(
				{ accountId, count: group.records.length },
				"Bulk upsert complete",
			);
		} catch (error) {
			log.error({ error: inspect(error), accountId }, "Bulk upsert failed");
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
			log.info(
				{ accountId, messageId, deletedAt: account.deletedAt },
				"Account deleted, skipping",
			);
			return null;
		}
	} catch {
		log.info({ accountId, messageId }, "Account not found, skipping");
		return null;
	}

	const threadMessage = await threadMessageService.findByMessageId(messageId);
	if (!threadMessage) {
		log.info({ messageId }, "ThreadMessage not found, skipping");
		return null;
	}

	const parsedBody = await storageService.retrieveParsedBody(
		threadMessage.accountConfigId,
		accountId,
		messageId,
	);
	if (!parsedBody) {
		log.info({ messageId }, "Parsed body not found in S3, skipping");
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
