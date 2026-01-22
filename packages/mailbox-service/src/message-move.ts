import { randomUUID } from "node:crypto";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import type {
	MailboxService,
	MailboxSpecialUseService,
	MessageService,
	ThreadMessageService,
} from "@remit/remit-electrodb-service";
import { MessageStatus, MessageSyncStatus } from "@remit/domain-enums";

/**
 * Event types for message move/delete operations.
 * These match the worker event types in remit-imap-worker/events.ts.
 */
interface MessageDeleteEvent {
	type: "MESSAGE_DELETE";
	eventId: string;
	timestamp: number;
	accountId: string;
	messageId: string;
	mailboxId: string;
	mailboxPath: string;
	uid: number;
	operation: "move_to_trash" | "permanent_delete";
	destinationMailboxId?: string;
	destinationMailboxPath?: string;
}

interface MessageMoveEvent {
	type: "MESSAGE_MOVE";
	eventId: string;
	timestamp: number;
	accountId: string;
	messageId: string;
	sourceMailboxId: string;
	sourceMailboxPath: string;
	destinationMailboxId: string;
	destinationMailboxPath: string;
	uid: number;
}

interface EmptyTrashEvent {
	type: "EMPTY_TRASH";
	eventId: string;
	timestamp: number;
	accountId: string;
	trashMailboxId: string;
	trashMailboxPath: string;
}

type MessageMoveQueueEvent =
	| MessageDeleteEvent
	| MessageMoveEvent
	| EmptyTrashEvent;

/**
 * Logger interface
 */
export interface MessageMoveLogger {
	info(obj: Record<string, unknown>, msg: string): void;
	error(obj: Record<string, unknown>, msg: string): void;
}

const noopLogger: MessageMoveLogger = {
	info: () => {},
	error: () => {},
};

/**
 * Configuration for MessageMoveService
 */
export interface MessageMoveConfig {
	messageService: MessageService;
	mailboxService: MailboxService;
	mailboxSpecialUseService: MailboxSpecialUseService;
	threadMessageService: ThreadMessageService;
	sqsQueueUrl: string;
	sqsEndpoint?: string;
	logger?: MessageMoveLogger;
}

/**
 * Options for delete operations
 */
export interface DeleteOptions {
	/** Move to Trash instead of permanent delete. Default: true */
	toTrash?: boolean;
	/** Permanently delete even if in Trash. Default: false */
	permanent?: boolean;
}

/**
 * Service for moving, copying, and deleting messages.
 *
 * Implements optimistic local-first pattern:
 * 1. Updates local DynamoDB state immediately (Message + ThreadMessage)
 * 2. Enqueues event to SQS for worker to sync to IMAP
 *
 * Following RFC 016 for message deletion and moving.
 */
export class MessageMoveService {
	private messageService: MessageService;
	private mailboxService: MailboxService;
	private mailboxSpecialUseService: MailboxSpecialUseService;
	private threadMessageService: ThreadMessageService;
	private sqs: SQSClient;
	private queueUrl: string;
	private log: MessageMoveLogger;

	constructor(config: MessageMoveConfig) {
		this.messageService = config.messageService;
		this.mailboxService = config.mailboxService;
		this.mailboxSpecialUseService = config.mailboxSpecialUseService;
		this.threadMessageService = config.threadMessageService;
		this.queueUrl = config.sqsQueueUrl;
		this.log = config.logger ?? noopLogger;

		this.sqs = new SQSClient({
			endpoint: config.sqsEndpoint ?? this.deriveEndpoint(config.sqsQueueUrl),
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
	 * Delete a message. By default moves to Trash.
	 *
	 * @param messageId - Message to delete
	 * @param accountId - Account ID
	 * @param options - Delete options (toTrash, permanent)
	 */
	deleteMessage = async (
		messageId: string,
		accountId: string,
		options: DeleteOptions = { toTrash: true },
	): Promise<void> => {
		const message = await this.messageService.get(messageId);
		const sourceMailbox = await this.mailboxService.get(message.mailboxId);

		// Check if already in Trash
		const trashMailbox =
			await this.mailboxSpecialUseService.findTrashMailbox(accountId);
		const isInTrash =
			trashMailbox && message.mailboxId === trashMailbox.mailboxId;

		// Determine operation type
		const shouldMoveToTrash =
			options.toTrash !== false &&
			!options.permanent &&
			!isInTrash &&
			trashMailbox;

		if (shouldMoveToTrash && trashMailbox) {
			// Move to Trash (soft delete)
			await this.moveToTrash(
				messageId,
				message,
				sourceMailbox,
				trashMailbox,
				accountId,
			);
		} else {
			// Permanent delete
			await this.permanentDelete(messageId, message, sourceMailbox, accountId);
		}
	};

	/**
	 * Delete multiple messages.
	 *
	 * @param messageIds - Messages to delete
	 * @param accountId - Account ID
	 * @param options - Delete options (toTrash, permanent)
	 */
	deleteMessages = async (
		messageIds: string[],
		accountId: string,
		options: DeleteOptions = { toTrash: true },
	): Promise<void> => {
		for (const messageId of messageIds) {
			await this.deleteMessage(messageId, accountId, options);
		}
	};

	private moveToTrash = async (
		messageId: string,
		message: { mailboxId: string; uid: number },
		sourceMailbox: { mailboxId: string; fullPath: string },
		trashMailbox: { mailboxId: string; fullPath: string },
		accountId: string,
	): Promise<void> => {
		// Update local state optimistically
		await this.messageService.updateForMove(messageId, {
			mailboxId: trashMailbox.mailboxId,
			status: MessageStatus.moving,
			syncStatus: MessageSyncStatus.pending,
			originalMailboxId: sourceMailbox.mailboxId,
			originalUid: message.uid,
		});

		// Update ThreadMessage
		await this.updateThreadMessageForMove(
			messageId,
			trashMailbox.mailboxId,
			true,
		);

		this.log.info(
			{ messageId, trashMailboxId: trashMailbox.mailboxId },
			"Moved message to trash (local)",
		);

		// Enqueue IMAP sync
		const event: MessageDeleteEvent = {
			type: "MESSAGE_DELETE",
			eventId: randomUUID(),
			timestamp: Date.now(),
			accountId,
			messageId,
			mailboxId: sourceMailbox.mailboxId,
			mailboxPath: sourceMailbox.fullPath,
			uid: message.uid,
			operation: "move_to_trash",
			destinationMailboxId: trashMailbox.mailboxId,
			destinationMailboxPath: trashMailbox.fullPath,
		};

		await this.enqueueEvent(event);
	};

	private permanentDelete = async (
		messageId: string,
		message: { mailboxId: string; uid: number },
		sourceMailbox: { mailboxId: string; fullPath: string },
		accountId: string,
	): Promise<void> => {
		// Update local state optimistically
		await this.messageService.update(messageId, {
			status: MessageStatus.deleting,
			syncStatus: MessageSyncStatus.pending,
		});

		// Update ThreadMessage
		await this.updateThreadMessageDeleted(messageId, true);

		this.log.info(
			{ messageId },
			"Marked message for permanent deletion (local)",
		);

		// Enqueue IMAP sync
		const event: MessageDeleteEvent = {
			type: "MESSAGE_DELETE",
			eventId: randomUUID(),
			timestamp: Date.now(),
			accountId,
			messageId,
			mailboxId: sourceMailbox.mailboxId,
			mailboxPath: sourceMailbox.fullPath,
			uid: message.uid,
			operation: "permanent_delete",
		};

		await this.enqueueEvent(event);
	};

	/**
	 * Move a message to another mailbox.
	 *
	 * @param messageId - Message to move
	 * @param destinationMailboxId - Destination mailbox ID
	 * @param accountId - Account ID
	 */
	moveMessage = async (
		messageId: string,
		destinationMailboxId: string,
		accountId: string,
	): Promise<void> => {
		const message = await this.messageService.get(messageId);
		const sourceMailbox = await this.mailboxService.get(message.mailboxId);
		const destinationMailbox =
			await this.mailboxService.get(destinationMailboxId);

		// Check if moving to/from Trash
		const trashMailbox =
			await this.mailboxSpecialUseService.findTrashMailbox(accountId);
		const isMovingToTrash = Boolean(
			trashMailbox && destinationMailboxId === trashMailbox.mailboxId,
		);
		const isMovingFromTrash = Boolean(
			trashMailbox && message.mailboxId === trashMailbox.mailboxId,
		);

		// Update local state optimistically
		await this.messageService.updateForMove(messageId, {
			mailboxId: destinationMailboxId,
			status: MessageStatus.moving,
			syncStatus: MessageSyncStatus.pending,
			originalMailboxId: sourceMailbox.mailboxId,
			originalUid: message.uid,
		});

		// Update ThreadMessage
		await this.updateThreadMessageForMove(
			messageId,
			destinationMailboxId,
			isMovingToTrash,
		);

		// If moving FROM Trash, clear isDeleted
		if (isMovingFromTrash) {
			await this.updateThreadMessageDeleted(messageId, false);
		}

		this.log.info(
			{
				messageId,
				from: sourceMailbox.fullPath,
				to: destinationMailbox.fullPath,
			},
			"Moved message (local)",
		);

		// Enqueue IMAP sync
		const event: MessageMoveEvent = {
			type: "MESSAGE_MOVE",
			eventId: randomUUID(),
			timestamp: Date.now(),
			accountId,
			messageId,
			sourceMailboxId: sourceMailbox.mailboxId,
			sourceMailboxPath: sourceMailbox.fullPath,
			destinationMailboxId,
			destinationMailboxPath: destinationMailbox.fullPath,
			uid: message.uid,
		};

		await this.enqueueEvent(event);
	};

	/**
	 * Move multiple messages to another mailbox.
	 *
	 * @param messageIds - Messages to move
	 * @param destinationMailboxId - Destination mailbox ID
	 * @param accountId - Account ID
	 */
	moveMessages = async (
		messageIds: string[],
		destinationMailboxId: string,
		accountId: string,
	): Promise<void> => {
		for (const messageId of messageIds) {
			await this.moveMessage(messageId, destinationMailboxId, accountId);
		}
	};

	/**
	 * Restore a message from Trash to its original mailbox.
	 *
	 * @param messageId - Message to restore
	 * @param accountId - Account ID
	 */
	restoreMessage = async (
		messageId: string,
		accountId: string,
	): Promise<void> => {
		const message = await this.messageService.get(messageId);

		if (!message.originalMailboxId) {
			throw new Error("Message has no original mailbox to restore to");
		}

		await this.moveMessage(messageId, message.originalMailboxId, accountId);
	};

	/**
	 * Empty the Trash mailbox (permanent delete all).
	 *
	 * @param accountId - Account ID
	 */
	emptyTrash = async (accountId: string): Promise<void> => {
		const trashMailbox =
			await this.mailboxSpecialUseService.findTrashMailbox(accountId);

		if (!trashMailbox) {
			throw new Error("No Trash mailbox found for account");
		}

		// Get all messages in Trash
		const messages = await this.messageService.listAllByMailbox(
			trashMailbox.mailboxId,
		);

		// Mark all as deleting locally
		for (const message of messages) {
			await this.messageService.update(message.messageId, {
				status: MessageStatus.deleting,
				syncStatus: MessageSyncStatus.pending,
			});
			await this.updateThreadMessageDeleted(message.messageId, true);
		}

		this.log.info(
			{
				accountId,
				trashMailboxId: trashMailbox.mailboxId,
				count: messages.length,
			},
			"Marked all trash messages for deletion (local)",
		);

		// Enqueue single event for worker to handle batch
		const event: EmptyTrashEvent = {
			type: "EMPTY_TRASH",
			eventId: randomUUID(),
			timestamp: Date.now(),
			accountId,
			trashMailboxId: trashMailbox.mailboxId,
			trashMailboxPath: trashMailbox.fullPath,
		};

		await this.enqueueEvent(event);
	};

	/**
	 * Update ThreadMessage for move operations.
	 * Updates mailboxId and optionally isDeleted.
	 */
	private updateThreadMessageForMove = async (
		messageId: string,
		newMailboxId: string,
		isDeleted: boolean,
	): Promise<void> => {
		const threadMessage =
			await this.threadMessageService.getByMessageId(messageId);

		this.log.info(
			{
				messageId,
				accountConfigId: threadMessage.accountConfigId,
				threadMessageId: threadMessage.threadMessageId,
				sentDate: threadMessage.sentDate,
				newMailboxId,
				isDeleted,
			},
			"Updating ThreadMessage for move",
		);

		await this.threadMessageService.update(
			threadMessage.accountConfigId,
			threadMessage.threadMessageId,
			{ mailboxId: newMailboxId, isDeleted },
			{
				// Composites contain CURRENT values for condition checking
				// ElectroDB uses these to verify the item state before updating
				composites: {
					mailboxId: threadMessage.mailboxId,
					sentDate: threadMessage.sentDate,
					isRead: threadMessage.isRead,
					isDeleted: threadMessage.isDeleted,
					hasStars: threadMessage.hasStars,
					hasAttachment: threadMessage.hasAttachment,
				},
			},
		);

		this.log.info(
			{
				messageId,
				threadMessageId: threadMessage.threadMessageId,
				newMailboxId,
				isDeleted,
			},
			"Updated ThreadMessage for move",
		);
	};

	/**
	 * Update ThreadMessage.isDeleted flag only.
	 */
	private updateThreadMessageDeleted = async (
		messageId: string,
		isDeleted: boolean,
	): Promise<void> => {
		const threadMessage =
			await this.threadMessageService.getByMessageId(messageId);

		await this.threadMessageService.update(
			threadMessage.accountConfigId,
			threadMessage.threadMessageId,
			{ isDeleted },
			{
				// Composites contain CURRENT values for condition checking
				composites: {
					sentDate: threadMessage.sentDate,
					mailboxId: threadMessage.mailboxId,
					isRead: threadMessage.isRead,
					isDeleted: threadMessage.isDeleted,
					hasStars: threadMessage.hasStars,
					hasAttachment: threadMessage.hasAttachment,
				},
			},
		);

		this.log.info(
			{
				messageId,
				threadMessageId: threadMessage.threadMessageId,
				isDeleted,
			},
			"Updated ThreadMessage.isDeleted",
		);
	};

	/**
	 * Enqueue a message move/delete event to SQS.
	 */
	private enqueueEvent = async (
		event: MessageMoveQueueEvent,
	): Promise<void> => {
		await this.sqs.send(
			new SendMessageCommand({
				QueueUrl: this.queueUrl,
				MessageBody: JSON.stringify(event),
			}),
		);

		this.log.info(
			{ eventId: event.eventId, type: event.type },
			"Enqueued message event",
		);
	};
}
