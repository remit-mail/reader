import { randomUUID } from "node:crypto";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import {
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
		const threadMessage =
			await this.threadMessageService.findByMessageId(messageId);
		if (!threadMessage) {
			this.log.info(
				{ messageId },
				"ThreadMessage not found for messageId - skipping isRead update",
			);
			return;
		}

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
				return;
			}
			throw err;
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
		}

		// Handle isStarred -> \Flagged flag and ThreadMessage.hasStars/star
		if (input.isStarred !== undefined || input.starColor !== undefined) {
			const threadMessage =
				await this.threadMessageService.findByMessageId(messageId);

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

			// Update ThreadMessage hasStars and star color
			if (threadMessage) {
				const updates: { hasStars?: boolean; star?: StarColorValue } = {};
				if (input.isStarred !== undefined) {
					updates.hasStars = input.isStarred;
				}
				if (input.starColor !== undefined) {
					updates.star = input.starColor;
				}

				if (Object.keys(updates).length > 0) {
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
				}
			}
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
