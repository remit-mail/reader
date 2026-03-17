import { randomUUID } from "node:crypto";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import {
	type AccountService,
	type OutboxMessageItem,
	type OutboxMessageService,
} from "@remit/remit-electrodb-service";
import { OutboxMessageStatus } from "@remit/domain-enums";

interface SendMessageEvent {
	type: "SEND_MESSAGE";
	eventId: string;
	timestamp: number;
	accountId: string;
	outboxMessageId: string;
}

export interface OutboxQueueLogger {
	info(obj: Record<string, unknown>, msg: string): void;
	error(obj: Record<string, unknown>, msg: string): void;
}

const noopLogger: OutboxQueueLogger = {
	info: () => {},
	error: () => {},
};

export interface OutboxQueueConfig {
	outboxMessageService: OutboxMessageService;
	accountService: AccountService;
	sqsSmtpQueueUrl: string;
	sqsEndpoint?: string;
	logger?: OutboxQueueLogger;
}

export interface CreateDraftInput {
	accountId: string;
	accountConfigId: string;
	fromAddress: string;
	fromName?: string;
	toAddresses: string[];
	ccAddresses?: string[];
	bccAddresses?: string[];
	subject?: string;
	textBody?: string;
	htmlBody?: string;
	inReplyTo?: string;
	references?: string[];
}

export interface UpdateDraftInput {
	toAddresses?: string[];
	ccAddresses?: string[];
	bccAddresses?: string[];
	subject?: string;
	textBody?: string;
	htmlBody?: string;
	inReplyTo?: string;
	references?: string[];
}

const generateMessageId = (domain: string): string => {
	const timestamp = Date.now();
	const random = randomUUID().replace(/-/g, "").slice(0, 16);
	return `${timestamp}.${random}@${domain}`;
};

const extractDomain = (email: string): string => {
	const atIndex = email.lastIndexOf("@");
	if (atIndex === -1) return "localhost";
	return email.slice(atIndex + 1);
};

export class OutboxQueueService {
	private outboxMessageService: OutboxMessageService;
	private accountService: AccountService;
	private sqs: SQSClient;
	private queueUrl: string;
	private log: OutboxQueueLogger;

	constructor(config: OutboxQueueConfig) {
		const {
			outboxMessageService,
			accountService,
			sqsSmtpQueueUrl,
			sqsEndpoint,
		} = config;
		this.outboxMessageService = outboxMessageService;
		this.accountService = accountService;
		this.queueUrl = sqsSmtpQueueUrl;
		this.log = config.logger ?? noopLogger;

		this.sqs = new SQSClient({
			endpoint: sqsEndpoint ?? this.deriveEndpoint(sqsSmtpQueueUrl),
		});
	}

	private deriveEndpoint(queueUrl: string): string | undefined {
		if (queueUrl.startsWith("http://localhost")) {
			return new URL(queueUrl).origin;
		}
		return undefined;
	}

	createDraft = async (input: CreateDraftInput): Promise<OutboxMessageItem> => {
		const domain = extractDomain(input.fromAddress);
		const messageIdValue = generateMessageId(domain);

		const outbox = await this.outboxMessageService.create({
			accountId: input.accountId,
			accountConfigId: input.accountConfigId,
			fromAddress: input.fromAddress,
			fromName: input.fromName,
			toAddresses: input.toAddresses,
			ccAddresses: input.ccAddresses,
			bccAddresses: input.bccAddresses,
			subject: input.subject,
			textBody: input.textBody,
			htmlBody: input.htmlBody,
			inReplyTo: input.inReplyTo,
			references: input.references,
			messageIdValue,
			status: OutboxMessageStatus.draft,
		});

		this.log.info(
			{ outboxMessageId: outbox.outboxMessageId, accountId: input.accountId },
			"Created draft outbox message",
		);

		return outbox;
	};

	updateDraft = async (
		outboxMessageId: string,
		input: UpdateDraftInput,
	): Promise<OutboxMessageItem> => {
		const existing = await this.outboxMessageService.get(outboxMessageId);
		if (existing.status !== OutboxMessageStatus.draft) {
			throw new Error(
				`Cannot update outbox message with status: ${existing.status}`,
			);
		}

		const updated = await this.outboxMessageService.update(outboxMessageId, {
			...(input.toAddresses !== undefined && {
				toAddresses: input.toAddresses,
			}),
			...(input.ccAddresses !== undefined && {
				ccAddresses: input.ccAddresses,
			}),
			...(input.bccAddresses !== undefined && {
				bccAddresses: input.bccAddresses,
			}),
			...(input.subject !== undefined && { subject: input.subject }),
			...(input.textBody !== undefined && { textBody: input.textBody }),
			...(input.htmlBody !== undefined && { htmlBody: input.htmlBody }),
			...(input.inReplyTo !== undefined && { inReplyTo: input.inReplyTo }),
			...(input.references !== undefined && {
				references: input.references,
			}),
		});

		this.log.info({ outboxMessageId }, "Updated draft outbox message");

		return updated;
	};

	send = async (outboxMessageId: string): Promise<OutboxMessageItem> => {
		const existing = await this.outboxMessageService.get(outboxMessageId);
		if (
			existing.status !== OutboxMessageStatus.draft &&
			existing.status !== OutboxMessageStatus.failed
		) {
			throw new Error(
				`Cannot send outbox message with status: ${existing.status}`,
			);
		}

		const updated = await this.outboxMessageService.updateStatus(
			outboxMessageId,
			OutboxMessageStatus.queued,
		);

		await this.enqueueSend(existing.accountId, outboxMessageId);

		this.log.info(
			{ outboxMessageId, accountId: existing.accountId },
			"Queued outbox message for sending",
		);

		return updated;
	};

	createAndSend = async (
		input: CreateDraftInput,
	): Promise<OutboxMessageItem> => {
		const domain = extractDomain(input.fromAddress);
		const messageIdValue = generateMessageId(domain);

		const outbox = await this.outboxMessageService.create({
			accountId: input.accountId,
			accountConfigId: input.accountConfigId,
			fromAddress: input.fromAddress,
			fromName: input.fromName,
			toAddresses: input.toAddresses,
			ccAddresses: input.ccAddresses,
			bccAddresses: input.bccAddresses,
			subject: input.subject,
			textBody: input.textBody,
			htmlBody: input.htmlBody,
			inReplyTo: input.inReplyTo,
			references: input.references,
			messageIdValue,
			status: OutboxMessageStatus.queued,
		});

		await this.enqueueSend(input.accountId, outbox.outboxMessageId);

		this.log.info(
			{ outboxMessageId: outbox.outboxMessageId, accountId: input.accountId },
			"Created and queued outbox message for sending",
		);

		return outbox;
	};

	deleteDraft = async (outboxMessageId: string): Promise<void> => {
		const existing = await this.outboxMessageService.get(outboxMessageId);
		if (
			existing.status !== OutboxMessageStatus.draft &&
			existing.status !== OutboxMessageStatus.failed
		) {
			throw new Error(
				`Cannot delete outbox message with status: ${existing.status}`,
			);
		}

		await this.outboxMessageService.delete(outboxMessageId);

		this.log.info({ outboxMessageId }, "Deleted outbox message");
	};

	private enqueueSend = async (
		accountId: string,
		outboxMessageId: string,
	): Promise<void> => {
		const event: SendMessageEvent = {
			type: "SEND_MESSAGE",
			eventId: randomUUID(),
			timestamp: Date.now(),
			accountId,
			outboxMessageId,
		};

		await this.sqs.send(
			new SendMessageCommand({
				QueueUrl: this.queueUrl,
				MessageBody: JSON.stringify(event),
			}),
		);

		this.log.info(
			{ eventId: event.eventId, accountId, outboxMessageId },
			"Enqueued SEND_MESSAGE event",
		);
	};
}
