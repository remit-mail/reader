import type {
	IMessageFlagRepository,
	IMessageRepository,
	IThreadMessageRepository,
} from "@remit/data-ports";
import { MessageSystemFlag, type StarColor } from "@remit/domain-enums";
import { NotFoundError } from "@remit/remit-electrodb-service";
import type { FlagPushOperationValue, FlagPushService } from "./flag-push.js";

/**
 * StarColor type derived from the StarColor const object
 */
type StarColorValue = (typeof StarColor)[keyof typeof StarColor];

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
	messageFlagService: IMessageFlagRepository;
	messageService: IMessageRepository;
	threadMessageService: IThreadMessageRepository;
	flagPushService: FlagPushService;
	logger?: FlagQueueLogger;
}

/**
 * Service for marking messages as read/unread/starred, local-first with a
 * durable pending-flag marker (issue #1273, epic #1281).
 *
 * Every flip below follows the SAME sequence: persist the pending marker
 * FIRST via {@link FlagPushService.flip} (the durable record IMAP still owes
 * this push, and best-effort enqueues a wake-up hint), THEN apply locally
 * (MessageFlag + ThreadMessage). The marker write is what makes the user's
 * intent durable — not the enqueue, which may fail freely (see
 * `FlagPushService`'s own doc) — and writing it first means a crash before
 * the local write leaves an unapplied local flip behind an already-durable
 * marker, never a flipped flag with no marker (review finding on #1292;
 * mirrors #1289's `PlacementMoveService.moveMessage` ordering). This class
 * therefore no longer touches
 * `Mailbox.unseenCount` at all: that field is a pure projection, recomputed
 * only from IMAP (`doc/rules/data-flow.md`); the displayed count is adjusted
 * at READ TIME from pending markers (`applyPendingMoveCountPrediction`,
 * `packages/remit-backend/src/derive/pendingMoveCounts.ts`).
 *
 * The service updates BOTH entities locally:
 * - MessageFlag: The canonical flag record
 * - ThreadMessage.isRead / hasStars / star: Denormalized for efficient queries
 */
export class FlagQueueService {
	private messageFlagService: IMessageFlagRepository;
	private messageService: IMessageRepository;
	private threadMessageService: IThreadMessageRepository;
	private flagPushService: FlagPushService;
	private log: FlagQueueLogger;

	constructor(config: FlagQueueConfig) {
		const {
			messageFlagService,
			messageService,
			threadMessageService,
			flagPushService,
		} = config;
		this.messageFlagService = messageFlagService;
		this.messageService = messageService;
		this.threadMessageService = threadMessageService;
		this.flagPushService = flagPushService;
		this.log = config.logger ?? noopLogger;
	}

	/**
	 * Update ThreadMessage.isRead for ALL ThreadMessages matching this messageId.
	 *
	 * A message can exist in multiple mailboxes (e.g., inbox and archive), so we
	 * must update all instances to keep the isRead status consistent.
	 *
	 * The `composites` map carries the CURRENT values of every attribute that
	 * participates in a sort key. ElectroDB uses them for the conditional check
	 * on the existing row and combines them with `set()` to recompute the new
	 * sort keys. Passing the NEW `isRead` value here would make the conditional
	 * check fail (existing row still has the old value) and the patch would be
	 * misreported as NotFoundError, silently dropping the update.
	 *
	 * Handles race condition where ThreadMessage may be deleted between find and update.
	 */
	private updateThreadMessageIsRead = async (
		accountConfigId: string,
		messageId: string,
		isRead: boolean,
	): Promise<void> => {
		const threadMessages = await this.threadMessageService.findAllByMessageId(
			accountConfigId,
			messageId,
		);
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
							isRead: threadMessage.isRead,
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
		accountConfigId: string,
		messageId: string,
		updates: { hasStars?: boolean; star?: StarColorValue },
	): Promise<void> => {
		if (Object.keys(updates).length === 0) return;

		const threadMessages = await this.threadMessageService.findAllByMessageId(
			accountConfigId,
			messageId,
		);
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
							hasStars: threadMessage.hasStars,
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
	 * Flip one flag field: persist the pending marker FIRST, then apply
	 * locally. Every caller in this class routes through here so the marker
	 * write is never skipped. Returns whether a change actually happened —
	 * `false` for a redundant flip (already in the desired state), which
	 * every caller uses to skip the (otherwise redundant) ThreadMessage
	 * update too.
	 *
	 * Ordering matters (review finding on #1292): a marker written AFTER the
	 * local `MessageFlag` flip means a crash between the two awaits strands a
	 * flipped flag with no marker — no hint was ever sent, the pending-only
	 * drain never finds it (no marker to find), and message-sync never
	 * rewrites `MessageFlag` from IMAP for an existing row, so nothing else
	 * reconciles it either. That is a permanent, silent divergence — exactly
	 * the defect #1273 exists to kill. Writing the marker first (matching
	 * #1289's `PlacementMoveService.moveMessage` ordering) makes that
	 * scenario impossible: the marker's existence is the record of how far
	 * the sequence got, so a crash after it can strand at worst an
	 * un-applied LOCAL write behind an already-durable marker — recoverable
	 * (the caller's natural retry re-applies both steps; `put` and
	 * `addFlag`/`removeFlag` are both idempotent) — never the reverse.
	 *
	 * The current-state check (review finding on #1292) matters for a
	 * different reason: `markAsRead`/`markAsUnread`/`updateFlags` take the
	 * DESIRED boolean from the caller rather than deriving it from current
	 * state (unlike `toggleFlagged`, which already reads `hasFlag` first and
	 * so can never generate a redundant marker). A redundant "mark as read"
	 * on an already-read message would otherwise still write a fresh `add
	 * \Seen` marker; the read-time unseenCount prediction
	 * (`applyPendingMoveCountPrediction`) would then subtract one for a
	 * message IMAP already counts as seen, transiently under-counting the
	 * badge until the marker clears. Skipping the marker (and the local
	 * write) entirely when the flag already matches removes the false
	 * prediction at the source, not just its symptom.
	 */
	private flipFlag = async (
		accountId: string,
		accountConfigId: string,
		messageId: string,
		mailboxId: string,
		flagName: string,
		operation: FlagPushOperationValue,
	): Promise<boolean> => {
		const alreadyInState = await this.messageFlagService.hasFlag(
			messageId,
			flagName,
		);
		if (
			(operation === "add" && alreadyInState) ||
			(operation === "remove" && !alreadyInState)
		) {
			this.log.info(
				{ messageId, flagName, operation },
				"Flag already in the desired state — skipping redundant marker + local write",
			);
			return false;
		}

		await this.flagPushService.flip({
			accountId,
			accountConfigId,
			messageId,
			mailboxId,
			flagName,
			operation,
		});

		if (operation === "add") {
			await this.messageFlagService.addFlag(messageId, flagName);
		} else {
			await this.messageFlagService.removeFlag(messageId, flagName);
		}

		return true;
	};

	/**
	 * Mark a message as read (add \Seen flag).
	 * Updates MessageFlag, ThreadMessage.isRead, and persists a pending
	 * flag-push marker for IMAP sync.
	 *
	 * @param accountConfigId - The owning account config (tenant scope)
	 * @param messageId - The message to mark as read
	 * @param accountId - The account ID for the IMAP sync event
	 */
	markAsRead = async (
		accountConfigId: string,
		messageId: string,
		accountId: string,
	): Promise<void> => {
		const message = await this.messageService.get(messageId);

		const changed = await this.flipFlag(
			accountId,
			accountConfigId,
			messageId,
			message.mailboxId,
			MessageSystemFlag.Seen,
			"add",
		);

		if (changed) {
			await this.updateThreadMessageIsRead(accountConfigId, messageId, true);
		}

		this.log.info(
			{ messageId, changed },
			"Marked message as read (local, push pending)",
		);
	};

	/**
	 * Mark a message as unread (remove \Seen flag).
	 * Updates MessageFlag, ThreadMessage.isRead, and persists a pending
	 * flag-push marker for IMAP sync.
	 *
	 * @param accountConfigId - The owning account config (tenant scope)
	 * @param messageId - The message to mark as unread
	 * @param accountId - The account ID for the IMAP sync event
	 */
	markAsUnread = async (
		accountConfigId: string,
		messageId: string,
		accountId: string,
	): Promise<void> => {
		const message = await this.messageService.get(messageId);

		const changed = await this.flipFlag(
			accountId,
			accountConfigId,
			messageId,
			message.mailboxId,
			MessageSystemFlag.Seen,
			"remove",
		);

		if (changed) {
			await this.updateThreadMessageIsRead(accountConfigId, messageId, false);
		}

		this.log.info(
			{ messageId, changed },
			"Marked message as unread (local, push pending)",
		);
	};

	/**
	 * Toggle the starred/flagged status of a message.
	 * Updates local state and persists a pending flag-push marker for IMAP
	 * sync.
	 *
	 * @param accountConfigId - The owning account config (tenant scope)
	 * @param messageId - The message to toggle
	 * @param accountId - The account ID for the IMAP sync event
	 * @returns true if flag was added, false if removed
	 */
	toggleFlagged = async (
		accountConfigId: string,
		messageId: string,
		accountId: string,
	): Promise<boolean> => {
		const message = await this.messageService.get(messageId);

		const hasFlag = await this.messageFlagService.hasFlag(
			messageId,
			MessageSystemFlag.Flagged,
		);
		const operation: FlagPushOperationValue = hasFlag ? "remove" : "add";

		await this.flipFlag(
			accountId,
			accountConfigId,
			messageId,
			message.mailboxId,
			MessageSystemFlag.Flagged,
			operation,
		);

		this.log.info(
			{ messageId, operation },
			"Toggled flagged status (local, push pending)",
		);

		return operation === "add";
	};

	/**
	 * Update message flags using API-friendly input format.
	 * Maps isRead/isStarred to IMAP flags and updates ThreadMessage accordingly.
	 *
	 * @param accountConfigId - The owning account config (tenant scope)
	 * @param messageId - The message to update
	 * @param accountId - The account ID for the IMAP sync event
	 * @param input - The flag updates to apply
	 * @returns The current flag state after updates
	 */
	updateFlags = async (
		accountConfigId: string,
		messageId: string,
		accountId: string,
		input: UpdateFlagsInput,
	): Promise<UpdateFlagsResult> => {
		const message = await this.messageService.get(messageId);

		// Handle isRead -> \Seen flag
		if (input.isRead !== undefined) {
			const changed = await this.flipFlag(
				accountId,
				accountConfigId,
				messageId,
				message.mailboxId,
				MessageSystemFlag.Seen,
				input.isRead ? "add" : "remove",
			);
			if (changed) {
				await this.updateThreadMessageIsRead(
					accountConfigId,
					messageId,
					input.isRead,
				);
			}
		}

		// Handle isStarred -> \Flagged flag and ThreadMessage.hasStars/star
		if (input.isStarred !== undefined || input.starColor !== undefined) {
			if (input.isStarred !== undefined) {
				await this.flipFlag(
					accountId,
					accountConfigId,
					messageId,
					message.mailboxId,
					MessageSystemFlag.Flagged,
					input.isStarred ? "add" : "remove",
				);
			}

			// Update ThreadMessage hasStars and star color for ALL instances
			const starUpdates: { hasStars?: boolean; star?: StarColorValue } = {};
			if (input.isStarred !== undefined) {
				starUpdates.hasStars = input.isStarred;
			}
			if (input.starColor !== undefined) {
				starUpdates.star = input.starColor;
			}
			await this.updateThreadMessageStars(
				accountConfigId,
				messageId,
				starUpdates,
			);
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
}
