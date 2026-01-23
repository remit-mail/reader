import { randomUUID } from "node:crypto";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import type {
	MessageFlagService,
	MessageService,
	ThreadMessageService,
} from "@remit/remit-electrodb-service";
import { MessageSystemFlag } from "@remit/domain-enums";

/**
 * Flag operation for SQS event
 */
interface FlagOperation {
	messageId: string;
	flagName: string;
	operation: "add" | "remove";
}

/**
 * SYNC_FLAGS event structure (matches remit-imap-worker/events.ts)
 */
interface SyncFlagsEvent {
	type: "SYNC_FLAGS";
	eventId: string;
	timestamp: number;
	accountId: string;
	mailboxId: string;
	operations: FlagOperation[];
}

/**
 * Logger interface
 */
export interface FlagQueueLogger {
	info(obj: Record<string, unknown>, msg: string): void;
	error(obj: Record<string, unknown>, msg: string): void;
}

const noopLogger: FlagQueueLogger = {
	info: () => {},
	error: () => {},
};

/**
 * Configuration for FlagQueueService
 */
export interface FlagQueueConfig {
	messageFlagService: MessageFlagService;
	messageService: MessageService;
	threadMessageService: ThreadMessageService;
	sqsQueueUrl: string;
	sqsEndpoint?: string;
	logger?: FlagQueueLogger;
}

/**
 * Service for marking messages as read/unread with automatic IMAP sync queueing.
 *
 * Implements optimistic local-first pattern:
 * 1. Updates local DynamoDB state immediately (MessageFlag + ThreadMessage)
 * 2. Enqueues SYNC_FLAGS event to SQS for worker to sync to IMAP
 *
 * The service updates BOTH entities:
 * - MessageFlag: The canonical flag record
 * - ThreadMessage.isRead: Denormalized for efficient queries
 */
export class FlagQueueService {
	private messageFlagService: MessageFlagService;
	private messageService: MessageService;
	private threadMessageService: ThreadMessageService;
	private sqs: SQSClient;
	private queueUrl: string;
	private log: FlagQueueLogger;

	constructor(config: FlagQueueConfig) {
		const {
			messageFlagService,
			messageService,
			threadMessageService,
			sqsQueueUrl,
			sqsEndpoint,
		} = config;
		this.messageFlagService = messageFlagService;
		this.messageService = messageService;
		this.threadMessageService = threadMessageService;
		this.queueUrl = sqsQueueUrl;
		this.log = config.logger ?? noopLogger;

		this.sqs = new SQSClient({
			endpoint: sqsEndpoint ?? this.deriveEndpoint(sqsQueueUrl),
		});
	}

	/**
	 * Derive SQS endpoint from queue URL for local development.
	 */
	private deriveEndpoint(queueUrl: string): string | undefined {
		if (queueUrl.startsWith("http://localhost")) {
			return new URL(queueUrl).origin;
		}
		return undefined;
	}

	/**
	 * Update ThreadMessage.isRead using the byMessageId index.
	 */
	private updateThreadMessageIsRead = async (
		messageId: string,
		isRead: boolean,
	): Promise<void> => {
		const threadMessage =
			await this.threadMessageService.findByMessageId(messageId);
		if (threadMessage) {
			await this.threadMessageService.update(
				threadMessage.accountConfigId,
				threadMessage.threadMessageId,
				{ isRead },
			);
			this.log.info(
				{ messageId, threadMessageId: threadMessage.threadMessageId, isRead },
				"Updated ThreadMessage.isRead",
			);
		} else {
			this.log.error(
				{ messageId },
				"ThreadMessage not found for messageId - cannot update isRead",
			);
		}
	};

	/**
	 * Mark a message as read (add \Seen flag).
	 * Updates MessageFlag, ThreadMessage.isRead, and enqueues IMAP sync.
	 *
	 * @param messageId - The message to mark as read
	 * @param accountId - The account ID for the IMAP sync event
	 */
	markAsRead = async (messageId: string, accountId: string): Promise<void> => {
		const message = await this.messageService.get(messageId);

		// Update MessageFlag
		await this.messageFlagService.addFlag(messageId, MessageSystemFlag.Seen);

		// Update ThreadMessage.isRead (denormalized)
		await this.updateThreadMessageIsRead(messageId, true);

		this.log.info({ messageId }, "Marked message as read (local)");

		// Enqueue IMAP sync
		await this.enqueueSync(accountId, message.mailboxId, [
			{
				messageId,
				flagName: MessageSystemFlag.Seen,
				operation: "add",
			},
		]);
	};

	/**
	 * Mark a message as unread (remove \Seen flag).
	 * Updates MessageFlag, ThreadMessage.isRead, and enqueues IMAP sync.
	 *
	 * @param messageId - The message to mark as unread
	 * @param accountId - The account ID for the IMAP sync event
	 */
	markAsUnread = async (
		messageId: string,
		accountId: string,
	): Promise<void> => {
		const message = await this.messageService.get(messageId);

		// Update MessageFlag
		await this.messageFlagService.removeFlag(messageId, MessageSystemFlag.Seen);

		// Update ThreadMessage.isRead (denormalized)
		await this.updateThreadMessageIsRead(messageId, false);

		this.log.info({ messageId }, "Marked message as unread (local)");

		// Enqueue IMAP sync
		await this.enqueueSync(accountId, message.mailboxId, [
			{
				messageId,
				flagName: MessageSystemFlag.Seen,
				operation: "remove",
			},
		]);
	};

	/**
	 * Toggle the starred/flagged status of a message.
	 * Updates local state and enqueues IMAP sync.
	 *
	 * @param messageId - The message to toggle
	 * @param accountId - The account ID for the IMAP sync event
	 * @returns true if flag was added, false if removed
	 */
	toggleFlagged = async (
		messageId: string,
		accountId: string,
	): Promise<boolean> => {
		const message = await this.messageService.get(messageId);

		const hasFlag = await this.messageFlagService.hasFlag(
			messageId,
			MessageSystemFlag.Flagged,
		);

		const operation = hasFlag ? "remove" : "add";

		if (hasFlag) {
			await this.messageFlagService.removeFlag(
				messageId,
				MessageSystemFlag.Flagged,
			);
			this.log.info({ messageId }, "Removed flagged status (local)");
		} else {
			await this.messageFlagService.addFlag(
				messageId,
				MessageSystemFlag.Flagged,
			);
			this.log.info({ messageId }, "Added flagged status (local)");
		}

		// Enqueue IMAP sync
		await this.enqueueSync(accountId, message.mailboxId, [
			{
				messageId,
				flagName: MessageSystemFlag.Flagged,
				operation,
			},
		]);

		return !hasFlag;
	};

	/**
	 * Enqueue a SYNC_FLAGS event to SQS.
	 */
	private enqueueSync = async (
		accountId: string,
		mailboxId: string,
		operations: FlagOperation[],
	): Promise<void> => {
		const event: SyncFlagsEvent = {
			type: "SYNC_FLAGS",
			eventId: randomUUID(),
			timestamp: Date.now(),
			accountId,
			mailboxId,
			operations,
		};

		await this.sqs.send(
			new SendMessageCommand({
				QueueUrl: this.queueUrl,
				MessageBody: JSON.stringify(event),
			}),
		);

		this.log.info(
			{ eventId: event.eventId, accountId, mailboxId, operations },
			"Enqueued SYNC_FLAGS event",
		);
	};
}
