import { randomUUID } from "node:crypto";
import { SendMessageCommand, type SQSClient } from "@aws-sdk/client-sqs";
import type {
	CreateMailboxInput,
	IMailboxRepository,
	MailboxItem,
} from "@remit/data-ports";
import { NotFoundError } from "@remit/data-ports/errors";
import { rebaseMailboxPath } from "@remit/data-ports/mailbox-name";
import { MailboxSyncStatus } from "@remit/domain-enums";
import { createQueueProducer } from "@remit/sqs-client/producer";
import {
	INTENT_RECORDABLE_FROM,
	recordedByRename,
	refuseContestedIntent,
} from "./mailbox-intent.js";
import { EVERY_MAILBOX_STATE } from "./mailbox-presence.js";

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
 * 1. Updates local state immediately
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
	 * Record a rename intent over the folder and every descendant, then enqueue
	 * IMAP RENAME.
	 *
	 * The target is recorded, not the path (D2): every row keeps the `fullPath`
	 * the server holds and takes its own rewritten target in `pendingPath`, so a
	 * rename that never lands needs no unwinding — dropping `pendingPath` is the
	 * whole revert — and nothing that resolves a folder path from a row can
	 * resolve one the server does not have.
	 *
	 * @param mailboxId - The mailbox to rename
	 * @param newPath - The path the rename is aiming at
	 * @param accountId - The account ID for the IMAP sync event
	 * @returns The folder that was named, carrying its recorded target
	 */
	renameMailbox = async (
		mailboxId: string,
		newPath: string,
		accountId: string,
	): Promise<MailboxItem> => {
		// Get current mailbox to capture old path
		const mailbox = await this.mailboxService.get(accountId, mailboxId);
		const oldPath = mailbox.fullPath;

		// One intent over the folder and every descendant, in one transaction:
		// IMAP RENAME moves the subtree in one command, so a partially recorded
		// rename is the state that produced today's phantom rows (D6). A
		// descendant already mid-mutation refuses the whole rename.
		const written = await this.mailboxService.transitionSubtree(
			accountId,
			mailboxId,
			{
				from: INTENT_RECORDABLE_FROM,
				to: MailboxSyncStatus.pending,
				rowSet: (row) => {
					const target = rebaseMailboxPath(
						row.fullPath,
						oldPath,
						newPath,
						mailbox.hierarchyDelimiter,
					);
					// The subtree is the folder and the rows under its own prefix, so
					// every one of them rebases. A row that does not is a resolution
					// bug, and recording an intent with no target for it would strand
					// it `pending` with nothing able to settle it.
					if (target === undefined) {
						throw new Error(
							`Mailbox ${row.mailboxId} at "${row.fullPath}" is not under "${oldPath}"`,
						);
					}
					return { pendingPath: target };
				},
			},
		);
		if (!written) {
			return refuseContestedIntent(
				this.mailboxService,
				accountId,
				mailboxId,
				"subtree",
			);
		}
		const updated = written.find((row) => row.mailboxId === mailboxId);
		if (!updated) throw new NotFoundError(`Mailbox not found: ${mailboxId}`);

		this.log.info(
			{
				accountId,
				mailboxId,
				intent: "rename",
				from: mailbox.syncStatus,
				to: MailboxSyncStatus.pending,
				oldPath,
				newPath,
				subtreeSize: written.length,
			},
			"Recorded rename intent",
		);

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
	 * The route out of a failed rename or a failed delete that keeps the folder
	 * as it is (T10, T11): the recorded target is dropped and the row settles
	 * back to `synced`. Nothing is enqueued — `fullPath` was never written, so
	 * the server has nothing to undo.
	 *
	 * Reached without new API surface, from a PATCH whose `fullPath` equals the
	 * row's confirmed one. From `synced` it is a no-op; from a state with a
	 * mutation in flight it is a 409, because dismissing an intent that is still
	 * running would leave the settle with no row to write.
	 */
	dismissMailboxIntent = async (
		mailboxId: string,
		accountId: string,
	): Promise<MailboxItem> => {
		const current = await this.mailboxService.get(accountId, mailboxId);
		if (current.syncStatus === MailboxSyncStatus.synced) return current;
		if (current.syncStatus !== MailboxSyncStatus.failed) {
			return refuseContestedIntent(
				this.mailboxService,
				accountId,
				mailboxId,
				"folder",
			);
		}

		// A failed rename was recorded over a subtree, so it is dismissed over the
		// same one. A failed delete carries no target and was recorded on the
		// folder alone, so there is nothing else to clear.
		const target = current.pendingPath;
		const alsoRecorded =
			target === undefined
				? []
				: (
						await this.mailboxService.findBySyncStatus(
							accountId,
							MailboxSyncStatus.failed,
						)
					).filter(
						(row) =>
							row.mailboxId !== mailboxId &&
							recordedByRename(
								row,
								current.fullPath,
								target,
								current.hierarchyDelimiter,
							),
					);

		let dismissed: MailboxItem | undefined;
		// The named folder first, so a caller always gets back the row it asked
		// about. Each write carries its own predicate, so a row somebody else
		// moved between the read and the write is skipped, not overwritten (D3).
		for (const row of [current, ...alsoRecorded]) {
			const written = await this.mailboxService.transition(
				accountId,
				row.mailboxId,
				{
					from: [MailboxSyncStatus.failed],
					wherePendingPath: row.pendingPath ?? null,
					to: MailboxSyncStatus.synced,
				},
			);
			if (row.mailboxId === mailboxId) dismissed = written ?? undefined;
			this.log.info(
				{
					accountId,
					mailboxId: row.mailboxId,
					intent: "dismiss",
					from: MailboxSyncStatus.failed,
					to: MailboxSyncStatus.synced,
					outcome: written ? "settled" : "superseded",
				},
				"Dismissed folder intent",
			);
		}

		if (dismissed) return dismissed;
		// The row moved between the read and its write. Re-read rather than
		// reporting a dismissal that did not happen.
		return this.mailboxService.get(accountId, mailboxId);
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
		const recorded = await this.mailboxService.transition(
			accountId,
			mailboxId,
			{ from: EVERY_MAILBOX_STATE, to: MailboxSyncStatus.deleting },
		);
		if (!recorded) throw new NotFoundError(`Mailbox not found: ${mailboxId}`);

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
