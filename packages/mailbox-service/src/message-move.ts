import { randomUUID } from "node:crypto";
import {
	SendMessageBatchCommand,
	SendMessageCommand,
	SQSClient,
} from "@aws-sdk/client-sqs";
import type {
	MailboxService,
	MailboxSpecialUseService,
	MessageService,
	ThreadMessageService,
} from "@remit/remit-electrodb-service";
import { base36uuid } from "@remit/remit-electrodb-service";
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

interface MessageCopyEvent {
	type: "MESSAGE_COPY";
	eventId: string;
	timestamp: number;
	accountId: string;
	sourceMessageId: string;
	newMessageId: string;
	sourceMailboxId: string;
	sourceMailboxPath: string;
	destinationMailboxId: string;
	destinationMailboxPath: string;
	uid: number;
}

type MessageMoveQueueEvent =
	| MessageDeleteEvent
	| MessageMoveEvent
	| EmptyTrashEvent
	| MessageCopyEvent;

/**
 * Logger interface
 */
export interface MessageMoveLogger {
	info(obj: Record<string, unknown>, msg: string): void;
	error(obj: Record<string, unknown>, msg: string): void;
	warn?(obj: Record<string, unknown>, msg: string): void;
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
		await this.deleteMessages([messageId], accountId, options);
	};

	/**
	 * Delete multiple messages using batch operations.
	 * By default moves to Trash, unless permanent is specified or already in Trash.
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
		if (messageIds.length === 0) return;

		// Batch get all messages
		const messages = await this.messageService.get(messageIds);
		if (messages.length === 0) return;

		// Get unique mailbox IDs and batch fetch mailboxes
		const uniqueMailboxIds = [...new Set(messages.map((m) => m.mailboxId))];
		const mailboxes = await this.mailboxService.get(uniqueMailboxIds);
		const mailboxMap = new Map(mailboxes.map((m) => [m.mailboxId, m]));

		// Find trash mailbox once
		const trashMailbox =
			await this.mailboxSpecialUseService.findTrashMailbox(accountId);

		// Group messages by operation type
		const moveToTrashMessages: Array<{
			messageId: string;
			message: { mailboxId: string; uid: number };
			sourceMailbox: { mailboxId: string; fullPath: string };
		}> = [];
		const permanentDeleteMessages: Array<{
			messageId: string;
			message: { mailboxId: string; uid: number };
			sourceMailbox: { mailboxId: string; fullPath: string };
		}> = [];

		for (const message of messages) {
			const sourceMailbox = mailboxMap.get(message.mailboxId);
			if (!sourceMailbox) continue;

			const isInTrash =
				trashMailbox && message.mailboxId === trashMailbox.mailboxId;
			const shouldMoveToTrash =
				options.toTrash !== false &&
				!options.permanent &&
				!isInTrash &&
				trashMailbox;

			const entry = {
				messageId: message.messageId,
				message: { mailboxId: message.mailboxId, uid: message.uid },
				sourceMailbox: {
					mailboxId: sourceMailbox.mailboxId,
					fullPath: sourceMailbox.fullPath,
				},
			};

			if (shouldMoveToTrash && trashMailbox) {
				moveToTrashMessages.push(entry);
			} else {
				permanentDeleteMessages.push(entry);
			}
		}

		// Collect all events for batch SQS send
		const events: MessageDeleteEvent[] = [];

		// Process move to trash
		if (trashMailbox && moveToTrashMessages.length > 0) {
			for (const { messageId, message, sourceMailbox } of moveToTrashMessages) {
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

				events.push({
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
				});
			}

			this.log.info(
				{
					count: moveToTrashMessages.length,
					trashMailboxId: trashMailbox.mailboxId,
				},
				"Moved messages to trash (local)",
			);
		}

		// Process permanent deletes
		for (const {
			messageId,
			message,
			sourceMailbox,
		} of permanentDeleteMessages) {
			// Update local state optimistically
			await this.messageService.update(messageId, {
				status: MessageStatus.deleting,
				syncStatus: MessageSyncStatus.pending,
			});

			// Delete ThreadMessage rows up-front (one row per mailbox copy).
			// The IMAP worker also deletes them once the IMAP DELETE succeeds —
			// doing it eagerly here closes the visibility window where the inbox
			// list shows a row whose backing Message is being deleted, leading
			// to "Message not found: <id>" on click. See issue #212.
			await this.deleteThreadMessagesForMessage(messageId);

			events.push({
				type: "MESSAGE_DELETE",
				eventId: randomUUID(),
				timestamp: Date.now(),
				accountId,
				messageId,
				mailboxId: sourceMailbox.mailboxId,
				mailboxPath: sourceMailbox.fullPath,
				uid: message.uid,
				operation: "permanent_delete",
			});
		}

		if (permanentDeleteMessages.length > 0) {
			this.log.info(
				{ count: permanentDeleteMessages.length },
				"Marked messages for permanent deletion (local)",
			);
		}

		// Batch send events to SQS
		await this.enqueueEventsBatch(events);
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
	 * Copy a message to another mailbox.
	 * Creates a new message record locally and enqueues IMAP COPY.
	 *
	 * @param messageId - Message to copy
	 * @param destinationMailboxId - Destination mailbox ID
	 * @param accountId - Account ID
	 * @returns The new message ID for the copy
	 */
	copyMessage = async (
		messageId: string,
		destinationMailboxId: string,
		accountId: string,
	): Promise<string> => {
		const sourceMessage = await this.messageService.get(messageId);
		const sourceMailbox = await this.mailboxService.get(
			sourceMessage.mailboxId,
		);
		const destinationMailbox =
			await this.mailboxService.get(destinationMailboxId);

		// Generate new ID for the copy
		const newMessageId = base36uuid();

		// Create local copy with moving status (uid=0 until IMAP confirms)
		await this.messageService.create({
			messageId: newMessageId,
			mailboxId: destinationMailboxId,
			uid: 0, // Will be updated by worker after IMAP COPY
			sequenceNumber: 0, // Will be updated by worker
			rfc822Size: sourceMessage.rfc822Size,
			internalDate: sourceMessage.internalDate,
			messageIdHeader: sourceMessage.messageIdHeader,
			envelopeId: sourceMessage.envelopeId, // Share envelope with source
			rootBodyPartId: sourceMessage.rootBodyPartId, // Share body parts with source
			status: MessageStatus.moving,
			syncStatus: MessageSyncStatus.pending,
			bodyStorageKey: sourceMessage.bodyStorageKey,
		});

		// Copy ThreadMessage entry
		const sourceThreadMessage =
			await this.threadMessageService.getByMessageId(messageId);

		await this.threadMessageService.create({
			accountConfigId: sourceThreadMessage.accountConfigId,
			threadId: sourceThreadMessage.threadId,
			messageId: newMessageId,
			mailboxId: destinationMailboxId,
			uid: 0, // Will be updated by worker
			messageIdHeader: sourceThreadMessage.messageIdHeader,
			inReplyTo: sourceThreadMessage.inReplyTo,
			referenceOrder: sourceThreadMessage.referenceOrder,
			fromEmail: sourceThreadMessage.fromEmail,
			fromName: sourceThreadMessage.fromName,
			subject: sourceThreadMessage.subject,
			internalDate: sourceThreadMessage.internalDate,
			sentDate: sourceThreadMessage.sentDate,
			isRead: sourceThreadMessage.isRead,
			hasAttachment: sourceThreadMessage.hasAttachment,
			star: sourceThreadMessage.star,
			hasStars: sourceThreadMessage.hasStars,
			isDeleted: false,
			snippet: sourceThreadMessage.snippet,
		});

		this.log.info(
			{
				sourceMessageId: messageId,
				newMessageId,
				from: sourceMailbox.fullPath,
				to: destinationMailbox.fullPath,
			},
			"Created message copy (local)",
		);

		// Enqueue IMAP sync
		const event: MessageCopyEvent = {
			type: "MESSAGE_COPY",
			eventId: randomUUID(),
			timestamp: Date.now(),
			accountId,
			sourceMessageId: messageId,
			newMessageId,
			sourceMailboxId: sourceMailbox.mailboxId,
			sourceMailboxPath: sourceMailbox.fullPath,
			destinationMailboxId,
			destinationMailboxPath: destinationMailbox.fullPath,
			uid: sourceMessage.uid,
		};

		await this.enqueueEvent(event);

		return newMessageId;
	};

	/**
	 * Copy multiple messages to another mailbox.
	 *
	 * @param messageIds - Messages to copy
	 * @param destinationMailboxId - Destination mailbox ID
	 * @param accountId - Account ID
	 * @returns Array of new message IDs for the copies
	 */
	copyMessages = async (
		messageIds: string[],
		destinationMailboxId: string,
		accountId: string,
	): Promise<string[]> => {
		const newMessageIds: string[] = [];
		for (const messageId of messageIds) {
			const newId = await this.copyMessage(
				messageId,
				destinationMailboxId,
				accountId,
			);
			newMessageIds.push(newId);
		}
		return newMessageIds;
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
	 * Delete every ThreadMessage row that points at this messageId.
	 *
	 * A single Message can have multiple ThreadMessage rows — one per mailbox
	 * the message exists in (e.g. INBOX + a label/folder copy). Deleting them
	 * up-front in the permanent-delete optimistic step prevents stale rows from
	 * leaking into mailbox listings while IMAP catches up. See issue #212.
	 */
	private deleteThreadMessagesForMessage = async (
		messageId: string,
	): Promise<void> => {
		const rows = await this.threadMessageService.findAllByMessageId(messageId);
		for (const row of rows) {
			await this.threadMessageService.delete(
				row.accountConfigId,
				row.threadMessageId,
			);
		}
		this.log.info(
			{ messageId, deletedRows: rows.length },
			"Deleted ThreadMessage rows for permanent-delete",
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
	 *
	 * FIFO queues require MessageGroupId; standard queues reject it. We detect
	 * FIFO queues by the `.fifo` suffix and group by accountId so events for
	 * different accounts can be processed in parallel.
	 */
	private enqueueEvent = async (
		event: MessageMoveQueueEvent,
	): Promise<void> => {
		const useFifo = this.queueUrl.endsWith(".fifo");
		await this.sqs.send(
			new SendMessageCommand({
				QueueUrl: this.queueUrl,
				MessageBody: JSON.stringify(event),
				...(useFifo && {
					MessageGroupId: event.accountId,
					MessageDeduplicationId: event.eventId,
				}),
			}),
		);

		this.log.info(
			{ eventId: event.eventId, type: event.type },
			"Enqueued message event",
		);
	};

	/**
	 * Enqueue multiple events to SQS using batch send.
	 * SQS batch limit is 10 messages, so we chunk if needed.
	 *
	 * FIFO queues require MessageGroupId on each batch entry; standard queues
	 * reject it. We detect FIFO queues by the `.fifo` suffix.
	 */
	private enqueueEventsBatch = async (
		events: MessageMoveQueueEvent[],
	): Promise<void> => {
		if (events.length === 0) return;

		const SQS_BATCH_SIZE = 10;
		const useFifo = this.queueUrl.endsWith(".fifo");

		for (let i = 0; i < events.length; i += SQS_BATCH_SIZE) {
			const batch = events.slice(i, i + SQS_BATCH_SIZE);
			await this.sqs.send(
				new SendMessageBatchCommand({
					QueueUrl: this.queueUrl,
					Entries: batch.map((event, idx) => ({
						Id: `${i + idx}`,
						MessageBody: JSON.stringify(event),
						...(useFifo && {
							MessageGroupId: event.accountId,
							MessageDeduplicationId: event.eventId,
						}),
					})),
				}),
			);
		}

		this.log.info({ count: events.length }, "Enqueued message events batch");
	};
}
