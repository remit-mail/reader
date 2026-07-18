import { randomUUID } from "node:crypto";
import { SendMessageCommand, type SQSClient } from "@aws-sdk/client-sqs";
import type {
	CreateMailboxInput,
	IMailboxRepository,
	MailboxItem,
} from "@remit/data-ports";
import { MailboxSyncStatus } from "@remit/domain-enums";
import { createQueueProducer } from "@remit/sqs-client/producer";

/**
 * MAILBOX_CREATE event structure (matches remit-imap-worker/events.ts)
 */
interface MailboxCreateEvent {
	type: "MAILBOX_CREATE";
	eventId: string;
	timestamp: number;
	accountId: string;
	mailboxId: string;
	path: string;
	subscribe?: boolean;
}

/**
 * MAILBOX_RENAME event structure (matches remit-imap-worker/events.ts)
 */
interface MailboxRenameEvent {
	type: "MAILBOX_RENAME";
	eventId: string;
	timestamp: number;
	accountId: string;
	mailboxId: string;
	oldPath: string;
	newPath: string;
}

/**
 * MAILBOX_DELETE event structure (matches remit-imap-worker/events.ts)
 */
interface MailboxDeleteEvent {
	type: "MAILBOX_DELETE";
	eventId: string;
	timestamp: number;
	accountId: string;
	mailboxId: string;
	path: string;
}

type MailboxManagementEvent =
	| MailboxCreateEvent
	| MailboxRenameEvent
	| MailboxDeleteEvent;

/**
 * Logger interface
 */
export interface MailboxQueueLogger {
	info(obj: Record<string, unknown>, msg: string): void;
	error(obj: Record<string, unknown>, msg: string): void;
}

const noopLogger: MailboxQueueLogger = {
	info: () => {},
	error: () => {},
};

/**
 * Input for creating a mailbox via the queue service
 */
export type CreateMailboxQueueInput = Omit<CreateMailboxInput, "syncStatus">;

/**
 * Configuration for MailboxQueueService
 */
export interface MailboxQueueConfig {
	mailboxService: IMailboxRepository;
	sqsQueueUrl: string;
	sqsEndpoint?: string;
	logger?: MailboxQueueLogger;
}

/**
 * Service for mailbox management with automatic IMAP sync queueing.
 *
 * Implements optimistic local-first pattern:
 * 1. Updates local DynamoDB state immediately
 * 2. Enqueues mailbox management event to SQS for worker to sync to IMAP
 *
 * This follows the same pattern as FlagQueueService (RFC 014).
 */
export class MailboxQueueService {
	private mailboxService: IMailboxRepository;
	private sqs: SQSClient;
	private queueUrl: string;
	private log: MailboxQueueLogger;

	constructor(config: MailboxQueueConfig) {
		const { mailboxService, sqsQueueUrl, sqsEndpoint } = config;
		this.mailboxService = mailboxService;
		this.queueUrl = sqsQueueUrl;
		this.log = config.logger ?? noopLogger;

		this.sqs = createQueueProducer({
			queueUrl: sqsQueueUrl,
			endpoint: sqsEndpoint,
		});
	}

	/**
	 * Create a new mailbox.
	 * Updates local state (with syncStatus=pending) and enqueues IMAP CREATE.
	 *
	 * @param input - The mailbox creation input (without syncStatus)
	 * @param accountId - The account ID for the IMAP sync event
	 * @param subscribe - Whether to subscribe to the mailbox after creation
	 * @returns The created mailbox
	 */
	createMailbox = async (
		input: CreateMailboxQueueInput,
		accountId: string,
		subscribe?: boolean,
	): Promise<MailboxItem> => {
		// Create local mailbox with pending status
		const mailbox = await this.mailboxService.create({
			...input,
			syncStatus: MailboxSyncStatus.pending,
		});

		this.log.info(
			{ mailboxId: mailbox.mailboxId, path: mailbox.fullPath },
			"Created mailbox (local)",
		);

		// Enqueue IMAP sync
		await this.enqueueEvent({
			type: "MAILBOX_CREATE",
			eventId: randomUUID(),
			timestamp: Date.now(),
			accountId,
			mailboxId: mailbox.mailboxId,
			path: mailbox.fullPath,
			subscribe,
		});

		return mailbox;
	};

	/**
	 * Rename a mailbox.
	 * Updates local state (including children) and enqueues IMAP RENAME.
	 *
	 * @param mailboxId - The mailbox to rename
	 * @param newPath - The new path for the mailbox
	 * @param accountId - The account ID for the IMAP sync event
	 * @returns The updated mailbox
	 */
	renameMailbox = async (
		mailboxId: string,
		newPath: string,
		accountId: string,
	): Promise<MailboxItem> => {
		// Get current mailbox to capture old path
		const mailbox = await this.mailboxService.get(accountId, mailboxId);
		const oldPath = mailbox.fullPath;

		// Update the mailbox path and set syncStatus to pending
		const updated = await this.mailboxService.update(accountId, mailboxId, {
			fullPath: newPath,
			syncStatus: MailboxSyncStatus.pending,
		});

		// Update child mailbox paths
		await this.mailboxService.renameChildPaths(
			mailbox.accountId,
			oldPath,
			newPath,
			mailbox.hierarchyDelimiter,
		);

		this.log.info({ mailboxId, oldPath, newPath }, "Renamed mailbox (local)");

		// Enqueue IMAP sync
		await this.enqueueEvent({
			type: "MAILBOX_RENAME",
			eventId: randomUUID(),
			timestamp: Date.now(),
			accountId,
			mailboxId,
			oldPath,
			newPath,
		});

		return updated;
	};

	/**
	 * Delete a mailbox.
	 * Marks for deletion (syncStatus=deleting) and enqueues IMAP DELETE.
	 *
	 * @param mailboxId - The mailbox to delete
	 * @param accountId - The account ID for the IMAP sync event
	 */
	deleteMailbox = async (
		mailboxId: string,
		accountId: string,
	): Promise<void> => {
		// Get current mailbox to capture path
		const mailbox = await this.mailboxService.get(accountId, mailboxId);

		// Mark as deleting (soft delete - worker will do actual delete after IMAP sync)
		await this.mailboxService.update(accountId, mailboxId, {
			syncStatus: MailboxSyncStatus.deleting,
		});

		this.log.info(
			{ mailboxId, path: mailbox.fullPath },
			"Marked mailbox for deletion (local)",
		);

		// Enqueue IMAP sync
		await this.enqueueEvent({
			type: "MAILBOX_DELETE",
			eventId: randomUUID(),
			timestamp: Date.now(),
			accountId,
			mailboxId,
			path: mailbox.fullPath,
		});
	};

	/**
	 * Enqueue a mailbox management event to SQS.
	 *
	 * FIFO queues require MessageGroupId; standard queues reject it. We detect
	 * FIFO queues by the `.fifo` suffix on the queue URL and scope ordering to
	 * the account so events for different accounts can be processed in parallel.
	 */
	private enqueueEvent = async (
		event: MailboxManagementEvent,
	): Promise<void> => {
		const useFifo = this.queueUrl.endsWith(".fifo");
		await this.sqs.send(
			new SendMessageCommand({
				QueueUrl: this.queueUrl,
				MessageBody: JSON.stringify(event),
				...(useFifo && {
					MessageGroupId: event.accountId,
					MessageDeduplicationId: `${event.type}:${event.mailboxId}:${event.eventId}`,
				}),
			}),
		);

		this.log.info(
			{ eventId: event.eventId, type: event.type, mailboxId: event.mailboxId },
			`Enqueued ${event.type} event`,
		);
	};
}
