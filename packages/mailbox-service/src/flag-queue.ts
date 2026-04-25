import { randomUUID } from "node:crypto";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import {
	type MailboxService,
	type MessageFlagService,
	type MessageService,
	NotFoundError,
	type ThreadMessageService,
} from "@remit/remit-electrodb-service";
import { MessageSystemFlag, StarColor } from "@remit/domain-enums";

/**
 * StarColor type derived from the StarColor const object
 */
type StarColorValue = (typeof StarColor)[keyof typeof StarColor];

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
 * Input for updateFlags API method
 */
export interface UpdateFlagsInput {
	isRead?: boolean;
	isStarred?: boolean;
	starColor?: StarColorValue;
}

/**
 * Result of updateFlags API method
 */
export interface UpdateFlagsResult {
	messageId: string;
	isRead: boolean;
	isStarred: boolean;
}

/**
 * Configuration for FlagQueueService
 */
export interface FlagQueueConfig {
	messageFlagService: MessageFlagService;
	messageService: MessageService;
	threadMessageService: ThreadMessageService;
	mailboxService: MailboxService;
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
	private mailboxService: MailboxService;
	private sqs: SQSClient;
	private queueUrl: string;
	private log: FlagQueueLogger;

	constructor(config: FlagQueueConfig) {
		const {
			messageFlagService,
			messageService,
			threadMessageService,
			mailboxService,
			sqsQueueUrl,
			sqsEndpoint,
		} = config;
		this.messageFlagService = messageFlagService;
		this.messageService = messageService;
		this.threadMessageService = threadMessageService;
		this.mailboxService = mailboxService;
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
	 * Update ThreadMessage.isRead for ALL ThreadMessages matching this messageId.
	 *
	 * A message can exist in multiple mailboxes (e.g., inbox and archive), so we
	 * must update all instances to keep the isRead status consistent.
	 *
	 * Provides composite attributes (sentDate, mailboxId) required by ElectroDB
	 * to update the GSI/LSI keys when isRead changes.
	 *
	 * Handles race condition where ThreadMessage may be deleted between find and update.
	 */
	private updateThreadMessageIsRead = async (
		messageId: string,
		isRead: boolean,
	): Promise<void> => {
		const threadMessages =
			await this.threadMessageService.findAllByMessageId(messageId);
		if (threadMessages.length === 0) {
			this.log.info(
				{ messageId },
				"ThreadMessage not found for messageId - skipping isRead update",
			);
			return;
		}

		for (const threadMessage of threadMessages) {
			try {
				await this.threadMessageService.update(
					threadMessage.accountConfigId,
					threadMessage.threadMessageId,
					{ isRead },
					{
						composites: {
							sentDate: threadMessage.sentDate,
							mailboxId: threadMessage.mailboxId,
							isRead,
							isDeleted: threadMessage.isDeleted,
							hasStars: threadMessage.hasStars,
							hasAttachment: threadMessage.hasAttachment,
						},
					},
				);
				this.log.info(
					{ messageId, threadMessageId: threadMessage.threadMessageId, isRead },
					"Updated ThreadMessage.isRead",
				);
			} catch (err) {
				if (err instanceof NotFoundError) {
					this.log.info(
						{ messageId, threadMessageId: threadMessage.threadMessageId },
						"ThreadMessage deleted during update - skipping isRead update",
					);
					continue;
				}
				throw err;
			}
		}
	};

	/**
	 * Update ThreadMessage.hasStars and star color for ALL ThreadMessages matching this messageId.
	 *
	 * A message can exist in multiple mailboxes (e.g., inbox and archive), so we
	 * must update all instances to keep the star status consistent.
	 *
	 * Handles race condition where ThreadMessage may be deleted between find and update.
	 */
	private updateThreadMessageStars = async (
		messageId: string,
		updates: { hasStars?: boolean; star?: StarColorValue },
	): Promise<void> => {
		if (Object.keys(updates).length === 0) return;

		const threadMessages =
			await this.threadMessageService.findAllByMessageId(messageId);
		if (threadMessages.length === 0) {
			this.log.info(
				{ messageId },
				"ThreadMessage not found for messageId - skipping star update",
			);
			return;
		}

		for (const threadMessage of threadMessages) {
			try {
				await this.threadMessageService.update(
					threadMessage.accountConfigId,
					threadMessage.threadMessageId,
					updates,
					{
						composites: {
							sentDate: threadMessage.sentDate,
							mailboxId: threadMessage.mailboxId,
							isRead: threadMessage.isRead,
							isDeleted: threadMessage.isDeleted,
							hasStars: updates.hasStars ?? threadMessage.hasStars,
							hasAttachment: threadMessage.hasAttachment,
						},
					},
				);
				this.log.info(
					{
						messageId,
						threadMessageId: threadMessage.threadMessageId,
						updates,
					},
					"Updated ThreadMessage stars",
				);
			} catch (err) {
				if (err instanceof NotFoundError) {
					this.log.info(
						{ messageId, threadMessageId: threadMessage.threadMessageId },
						"ThreadMessage deleted during update - skipping star update",
					);
					continue;
				}
				throw err;
			}
		}
	};

	/**
	 * Adjust the parent mailbox `unseenCount` to reflect a flip of the
	 * `\Seen` flag.
	 *
	 * Decrements when going unread -> read, increments when going read ->
	 * unread, and is a no-op when state is unchanged. The adjustment is
	 * delegated to `MailboxService.adjustUnseenCount`, which uses an atomic
	 * DDB `ADD` plus a conditional check to stay race-safe and clamp at zero.
	 * The IMAP sync path remains the periodic safety net that recomputes the
	 * count from scratch, so any drift is self-healing.
	 */
	private adjustUnseenForReadFlip = async (
		mailboxId: string,
		wasRead: boolean,
		isRead: boolean,
	): Promise<void> => {
		if (wasRead === isRead) return;
		const delta = isRead ? -1 : 1;
		await this.mailboxService.adjustUnseenCount(mailboxId, delta);
		this.log.info(
			{ mailboxId, delta, wasRead, isRead },
			"Adjusted mailbox unseenCount",
		);
	};

	/**
	 * Mark a message as read (add \Seen flag).
	 * Updates MessageFlag, ThreadMessage.isRead, mailbox unseenCount, and
	 * enqueues IMAP sync.
	 *
	 * @param messageId - The message to mark as read
	 * @param accountId - The account ID for the IMAP sync event
	 */
	markAsRead = async (messageId: string, accountId: string): Promise<void> => {
		const message = await this.messageService.get(messageId);
		const wasRead = await this.messageFlagService.hasFlag(
			messageId,
			MessageSystemFlag.Seen,
		);

		// Update MessageFlag
		await this.messageFlagService.addFlag(messageId, MessageSystemFlag.Seen);

		// Update ThreadMessage.isRead (denormalized)
		await this.updateThreadMessageIsRead(messageId, true);

		// Adjust parent mailbox unseenCount (atomic, clamped at 0)
		await this.adjustUnseenForReadFlip(message.mailboxId, wasRead, true);

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
	 * Updates MessageFlag, ThreadMessage.isRead, mailbox unseenCount, and
	 * enqueues IMAP sync.
	 *
	 * @param messageId - The message to mark as unread
	 * @param accountId - The account ID for the IMAP sync event
	 */
	markAsUnread = async (
		messageId: string,
		accountId: string,
	): Promise<void> => {
		const message = await this.messageService.get(messageId);
		const wasRead = await this.messageFlagService.hasFlag(
			messageId,
			MessageSystemFlag.Seen,
		);

		// Update MessageFlag
		await this.messageFlagService.removeFlag(messageId, MessageSystemFlag.Seen);

		// Update ThreadMessage.isRead (denormalized)
		await this.updateThreadMessageIsRead(messageId, false);

		// Adjust parent mailbox unseenCount (atomic, clamped at 0)
		await this.adjustUnseenForReadFlip(message.mailboxId, wasRead, false);

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
	 * Update message flags using API-friendly input format.
	 * Maps isRead/isStarred to IMAP flags and updates ThreadMessage accordingly.
	 *
	 * @param messageId - The message to update
	 * @param accountId - The account ID for the IMAP sync event
	 * @param input - The flag updates to apply
	 * @returns The current flag state after updates
	 */
	updateFlags = async (
		messageId: string,
		accountId: string,
		input: UpdateFlagsInput,
	): Promise<UpdateFlagsResult> => {
		const message = await this.messageService.get(messageId);
		const operations: FlagOperation[] = [];

		// Handle isRead -> \Seen flag
		if (input.isRead !== undefined) {
			const wasRead = await this.messageFlagService.hasFlag(
				messageId,
				MessageSystemFlag.Seen,
			);
			if (input.isRead) {
				await this.messageFlagService.addFlag(
					messageId,
					MessageSystemFlag.Seen,
				);
				operations.push({
					messageId,
					flagName: MessageSystemFlag.Seen,
					operation: "add",
				});
			} else {
				await this.messageFlagService.removeFlag(
					messageId,
					MessageSystemFlag.Seen,
				);
				operations.push({
					messageId,
					flagName: MessageSystemFlag.Seen,
					operation: "remove",
				});
			}
			await this.updateThreadMessageIsRead(messageId, input.isRead);
			await this.adjustUnseenForReadFlip(
				message.mailboxId,
				wasRead,
				input.isRead,
			);
		}

		// Handle isStarred -> \Flagged flag and ThreadMessage.hasStars/star
		if (input.isStarred !== undefined || input.starColor !== undefined) {
			if (input.isStarred !== undefined) {
				if (input.isStarred) {
					await this.messageFlagService.addFlag(
						messageId,
						MessageSystemFlag.Flagged,
					);
					operations.push({
						messageId,
						flagName: MessageSystemFlag.Flagged,
						operation: "add",
					});
				} else {
					await this.messageFlagService.removeFlag(
						messageId,
						MessageSystemFlag.Flagged,
					);
					operations.push({
						messageId,
						flagName: MessageSystemFlag.Flagged,
						operation: "remove",
					});
				}
			}

			// Update ThreadMessage hasStars and star color for ALL instances
			const starUpdates: { hasStars?: boolean; star?: StarColorValue } = {};
			if (input.isStarred !== undefined) {
				starUpdates.hasStars = input.isStarred;
			}
			if (input.starColor !== undefined) {
				starUpdates.star = input.starColor;
			}
			await this.updateThreadMessageStars(messageId, starUpdates);
		}

		// Enqueue IMAP sync if there are flag operations
		if (operations.length > 0) {
			await this.enqueueSync(accountId, message.mailboxId, operations);
		}

		// Return current state
		const isRead = await this.messageFlagService.hasFlag(
			messageId,
			MessageSystemFlag.Seen,
		);
		const isStarred = await this.messageFlagService.hasFlag(
			messageId,
			MessageSystemFlag.Flagged,
		);

		this.log.info(
			{ messageId, isRead, isStarred, input },
			"Updated message flags",
		);

		return { messageId, isRead, isStarred };
	};

	/**
	 * Enqueue a SYNC_FLAGS event to SQS.
	 *
	 * FIFO queues require MessageGroupId; standard queues reject it. We detect
	 * FIFO queues by the `.fifo` suffix and group by accountId so independent
	 * accounts can be processed concurrently while preserving per-account order.
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
			{ eventId: event.eventId, accountId, mailboxId, operations },
			"Enqueued SYNC_FLAGS event",
		);
	};
}
