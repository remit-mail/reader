import { inspect } from "node:util";
import { createLogger, type Logger } from "@remit/logger-lambda";
import type {
	Context,
	SQSBatchResponse,
	SQSEvent,
	SQSHandler,
	SQSRecord,
} from "aws-lambda";
import type { IndexEvent, UpsertEvent } from "./events.js";
import { getServices, type Services } from "./services.js";

export const handler: SQSHandler = async (
	event: SQSEvent,
	context: Context,
): Promise<SQSBatchResponse> => {
	const log = createLogger(context);
	const services = getServices();
	return processBatch(event.Records, services, log);
};

export const processBatch = async (
	records: SQSRecord[],
	services: Services,
	log: Logger,
): Promise<SQSBatchResponse> => {
	const batchItemFailures: { itemIdentifier: string }[] = [];

	const parsed: { record: SQSRecord; event: IndexEvent }[] = [];
	for (const record of records) {
		try {
			const event: IndexEvent = JSON.parse(record.body);
			parsed.push({ record, event });
		} catch (error) {
			log.error(
				{ error: inspect(error), messageId: record.messageId },
				"Failed to parse event",
			);
			batchItemFailures.push({ itemIdentifier: record.messageId });
		}
	}

	const deletes = parsed.filter((p) => p.event.type === "delete");
	const upserts = parsed.filter((p) => p.event.type === "upsert");

	for (const { record, event } of deletes) {
		try {
			await services.searchService.delete(event.messageId);
			log.info({ messageId: event.messageId }, "Deleted search vectors");
		} catch (error) {
			log.error(
				{ error: inspect(error), messageId: event.messageId },
				"Delete failed",
			);
			batchItemFailures.push({ itemIdentifier: record.messageId });
		}
	}

	if (upserts.length > 0) {
		const upsertFailures = await processUpserts(
			upserts.map((u) => ({
				sqsMessageId: u.record.messageId,
				event: u.event as UpsertEvent,
			})),
			services,
			log,
		);
		batchItemFailures.push(...upsertFailures);
	}

	return { batchItemFailures };
};

const processUpserts = async (
	items: { sqsMessageId: string; event: UpsertEvent }[],
	services: Services,
	log: Logger,
): Promise<{ itemIdentifier: string }[]> => {
	const failures: { itemIdentifier: string }[] = [];

	for (const item of items) {
		try {
			await processOneUpsert(item.event, services, log);
		} catch (error) {
			log.error(
				{ error: inspect(error), messageId: item.event.messageId },
				"Upsert failed",
			);
			failures.push({ itemIdentifier: item.sqsMessageId });
		}
	}

	return failures;
};

const processOneUpsert = async (
	event: UpsertEvent,
	services: Services,
	log: Logger,
): Promise<void> => {
	const { messageId, accountId, accountConfigId, mailboxIds } = event;
	const {
		accountService,
		threadMessageService,
		storageService,
		searchService,
	} = services;

	// Tombstone fence: skip indexing for deleted accounts (#228)
	try {
		const account = await accountService.get(accountId);
		if (account.deletedAt) {
			log.info(
				{ accountId, messageId, deletedAt: account.deletedAt },
				"Account deleted, skipping upsert",
			);
			return;
		}
	} catch {
		// Account not found — likely already purged, skip indexing
		log.info({ accountId, messageId }, "Account not found, skipping upsert");
		return;
	}

	const threadMessage = await threadMessageService.findByMessageId(messageId);
	if (!threadMessage) {
		log.info(
			{ messageId },
			"ThreadMessage not found, skipping (likely deleted)",
		);
		return;
	}

	const parsedBody = await storageService.retrieveParsedBody(
		accountConfigId,
		accountId,
		messageId,
	);
	if (!parsedBody) {
		log.info({ messageId }, "Parsed body not found in S3, skipping");
		return;
	}

	await searchService.delete(messageId);

	await searchService.index({
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
			accountConfigId,
			mailboxIds,
			sentDate: threadMessage.sentDate,
			isRead: threadMessage.isRead,
			hasAttachment: threadMessage.hasAttachment,
			hasStars: threadMessage.hasStars,
			fromName: threadMessage.fromName ?? null,
			subject: threadMessage.subject ?? "",
		},
	});

	log.info({ messageId }, "Indexed message for search");
};
