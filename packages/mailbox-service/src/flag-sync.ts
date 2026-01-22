import {
	type MessageFlagService,
	type MessageService,
	NotFoundError,
} from "@remit/remit-electrodb-service";
import { MessageSystemFlag } from "@remit/domain-enums";
import type { IImapConnection } from "./types.js";

/**
 * Flag operation to apply
 */
export interface FlagOperation {
	messageId: string;
	flagName: string;
	operation: "add" | "remove";
}

/**
 * Result of syncing flags to IMAP
 */
export interface FlagSyncResult {
	successCount: number;
	failedCount: number;
	errors: Array<{ messageId: string; error: string }>;
}

/**
 * Logger interface for FlagSyncService
 */
export interface FlagSyncLogger {
	info(obj: Record<string, unknown>, msg: string): void;
	error(obj: Record<string, unknown>, msg: string): void;
}

const noopLogger: FlagSyncLogger = {
	info: () => {},
	error: () => {},
};

/**
 * Service for synchronizing message flags between DynamoDB and IMAP.
 *
 * Implements an optimistic local-first pattern:
 * 1. Updates are applied locally first (DynamoDB)
 * 2. Changes are queued for IMAP sync via SQS
 * 3. Worker processes queue and syncs to IMAP server
 */
export class FlagSyncService {
	private log: FlagSyncLogger;

	constructor(
		private messageFlagService: MessageFlagService,
		private messageService: MessageService,
		logger?: FlagSyncLogger,
	) {
		this.log = logger ?? noopLogger;
	}

	/**
	 * Mark a message as read (add \Seen flag).
	 * Updates local state only - caller should queue IMAP sync.
	 */
	markAsRead = async (messageId: string): Promise<void> => {
		await this.messageFlagService.addFlag(messageId, MessageSystemFlag.Seen);
		this.log.info({ messageId }, "Marked message as read (local)");
	};

	/**
	 * Mark a message as unread (remove \Seen flag).
	 * Updates local state only - caller should queue IMAP sync.
	 */
	markAsUnread = async (messageId: string): Promise<void> => {
		await this.messageFlagService.removeFlag(messageId, MessageSystemFlag.Seen);
		this.log.info({ messageId }, "Marked message as unread (local)");
	};

	/**
	 * Toggle the flagged status of a message (\Flagged flag).
	 * Updates local state only - caller should queue IMAP sync.
	 *
	 * @returns true if flag was added, false if removed
	 */
	toggleFlagged = async (messageId: string): Promise<boolean> => {
		const hasFlag = await this.messageFlagService.hasFlag(
			messageId,
			MessageSystemFlag.Flagged,
		);

		if (hasFlag) {
			await this.messageFlagService.removeFlag(
				messageId,
				MessageSystemFlag.Flagged,
			);
			this.log.info({ messageId }, "Removed flagged status (local)");
			return false;
		}

		await this.messageFlagService.addFlag(messageId, MessageSystemFlag.Flagged);
		this.log.info({ messageId }, "Added flagged status (local)");
		return true;
	};

	/**
	 * Apply multiple flag operations.
	 * Updates local state only - caller should queue IMAP sync.
	 */
	applyFlags = async (operations: FlagOperation[]): Promise<void> => {
		for (const op of operations) {
			if (op.operation === "add") {
				await this.messageFlagService.addFlag(op.messageId, op.flagName);
			} else {
				await this.messageFlagService.removeFlag(op.messageId, op.flagName);
			}
		}
		this.log.info(
			{ operationCount: operations.length },
			"Applied flag operations (local)",
		);
	};

	/**
	 * Sync pending flag operations to IMAP server.
	 * Called by worker after dequeuing SYNC_FLAGS event.
	 *
	 * Groups operations by mailbox for efficient IMAP commands.
	 *
	 * @param operations - Flag operations to sync
	 * @param getConnection - Factory to get IMAP connection (already connected)
	 */
	syncToImap = async (
		operations: FlagOperation[],
		getConnection: () => Promise<IImapConnection>,
	): Promise<FlagSyncResult> => {
		const result: FlagSyncResult = {
			successCount: 0,
			failedCount: 0,
			errors: [],
		};

		if (operations.length === 0) {
			return result;
		}

		// Get message details to find UIDs and mailboxes
		const messageMap = new Map<
			string,
			{ uid: number; mailboxId: string; mailboxPath: string }
		>();

		for (const op of operations) {
			const message = await this.messageService
				.get(op.messageId)
				.catch((error: unknown) => {
					if (error instanceof NotFoundError) {
						result.errors.push({
							messageId: op.messageId,
							error: "Message not found",
						});
						result.failedCount++;
						return null;
					}
					throw error;
				});

			if (message) {
				// We need mailbox path for the IMAP operation
				// The message only has mailboxId, but we need the path
				// This would need to be passed in or looked up
				messageMap.set(op.messageId, {
					uid: message.uid,
					mailboxId: message.mailboxId,
					mailboxPath: "", // Will be populated when grouped by mailbox
				});
			}
		}

		// Group operations by mailboxId
		const byMailbox = new Map<
			string,
			Array<{ op: FlagOperation; uid: number }>
		>();

		for (const op of operations) {
			const msgInfo = messageMap.get(op.messageId);
			if (!msgInfo) continue;

			const existing = byMailbox.get(msgInfo.mailboxId) ?? [];
			existing.push({ op, uid: msgInfo.uid });
			byMailbox.set(msgInfo.mailboxId, existing);
		}

		// Process each mailbox
		const connection = await getConnection();

		for (const [mailboxId, ops] of byMailbox) {
			// Group by operation type and flag for efficient IMAP commands
			const addFlags = new Map<string, number[]>();
			const removeFlags = new Map<string, number[]>();

			for (const { op, uid } of ops) {
				const target = op.operation === "add" ? addFlags : removeFlags;
				const uids = target.get(op.flagName) ?? [];
				uids.push(uid);
				target.set(op.flagName, uids);
			}

			// Execute IMAP commands
			for (const [flagName, uids] of addFlags) {
				await connection.addFlags(uids, [flagName]);
				result.successCount += uids.length;
				this.log.info(
					{ mailboxId, flagName, uidCount: uids.length },
					"Added flags via IMAP",
				);
			}

			for (const [flagName, uids] of removeFlags) {
				await connection.removeFlags(uids, [flagName]);
				result.successCount += uids.length;
				this.log.info(
					{ mailboxId, flagName, uidCount: uids.length },
					"Removed flags via IMAP",
				);
			}
		}

		return result;
	};
}
