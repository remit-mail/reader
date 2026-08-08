import { randomUUID } from "node:crypto";
import { SendMessageCommand, type SQSClient } from "@aws-sdk/client-sqs";
import type {
	IAccountRepository,
	IOutboxMessageRepository,
	OutboxMessageItem,
} from "@remit/data-ports";
import { ConflictError } from "@remit/data-ports/errors";
import { OutboxMessageStatus } from "@remit/domain-enums";
import { createQueueProducer } from "@remit/sqs-client/producer";
import type { OutboxAttachmentService } from "./outbox-attachment.js";

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
	outboxMessageService: IOutboxMessageRepository;
	outboxAttachmentService: OutboxAttachmentService;
	accountService: IAccountRepository;
	sqsSmtpQueueUrl: string;
	sqsEndpoint?: string;
	sqsClient?: SQSClient;
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
	private outboxMessageService: IOutboxMessageRepository;
	private outboxAttachmentService: OutboxAttachmentService;
	private accountService: IAccountRepository;
	private sqs: SQSClient;
	private queueUrl: string;
	private log: OutboxQueueLogger;

	constructor(config: OutboxQueueConfig) {
		const {
			outboxMessageService,
			outboxAttachmentService,
			accountService,
			sqsSmtpQueueUrl,
			sqsEndpoint,
		} = config;
		this.outboxMessageService = outboxMessageService;
		this.outboxAttachmentService = outboxAttachmentService;
		this.accountService = accountService;
		this.queueUrl = sqsSmtpQueueUrl;
		this.log = config.logger ?? noopLogger;

		this.sqs =
			config.sqsClient ??
			createQueueProducer({
				queueUrl: sqsSmtpQueueUrl,
				endpoint: sqsEndpoint,
			});
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
		accountConfigId: string,
		outboxMessageId: string,
		input: UpdateDraftInput,
	): Promise<OutboxMessageItem> => {
		const existing = await this.outboxMessageService.get(
			accountConfigId,
			outboxMessageId,
			"act",
		);
		if (existing.status !== OutboxMessageStatus.draft) {
			throw new ConflictError(
				`This message is already ${existing.status} and can no longer be edited as a draft. Start a new message to change it.`,
			);
		}

		const updated = await this.outboxMessageService.update(
			accountConfigId,
			outboxMessageId,
			{
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
			},
		);

		this.log.info({ outboxMessageId }, "Updated draft outbox message");

		return updated;
	};

	send = async (
		accountConfigId: string,
		outboxMessageId: string,
	): Promise<OutboxMessageItem> => {
		const existing = await this.outboxMessageService.get(
			accountConfigId,
			outboxMessageId,
			"act",
		);
		if (
			existing.status !== OutboxMessageStatus.draft &&
			existing.status !== OutboxMessageStatus.failed &&
			existing.status !== OutboxMessageStatus.blocked
		) {
			throw new ConflictError(
				`This message is already ${existing.status} and cannot be sent again. Open the Outbox to see where it stands.`,
			);
		}

		const updated = await this.outboxMessageService.updateStatus(
			accountConfigId,
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

	deleteDraft = async (
		accountConfigId: string,
		outboxMessageId: string,
	): Promise<void> => {
		const existing = await this.outboxMessageService.get(
			accountConfigId,
			outboxMessageId,
			"act",
		);
		if (
			existing.status !== OutboxMessageStatus.draft &&
			existing.status !== OutboxMessageStatus.failed &&
			existing.status !== OutboxMessageStatus.blocked
		) {
			throw new ConflictError(
				`This message is already ${existing.status} and can no longer be discarded. Open the Outbox to see where it stands.`,
			);
		}

		// Files first, row second. Nothing but this row points at those objects,
		// so a row deleted ahead of a sweep that then fails leaves bytes no one
		// can reach; the other order leaves a draft whose files are gone, which
		// is at least visible. A storage failure aborts the discard outright.
		await this.outboxAttachmentService.discardAll(
			accountConfigId,
			existing.accountId,
			outboxMessageId,
		);

		await this.outboxMessageService.delete(accountConfigId, outboxMessageId);

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

		const useFifo = this.queueUrl.endsWith(".fifo");
		await this.sqs.send(
			new SendMessageCommand({
				QueueUrl: this.queueUrl,
				MessageBody: JSON.stringify(event),
				...(useFifo && {
					MessageGroupId: accountId,
					MessageDeduplicationId: event.eventId,
				}),
			}),
		);

		this.log.info(
			{ eventId: event.eventId, accountId, outboxMessageId },
			"Enqueued SEND_MESSAGE event",
		);
	};
}
