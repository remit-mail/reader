import { randomUUID } from "node:crypto";
import { SendMessageCommand, type SQSClient } from "@aws-sdk/client-sqs";
import type {
	IMessagePlacementMoveRepository,
	IMessageRepository,
	IThreadMessageRepository,
} from "@remit/data-ports";
import { MessageStatus, MessageSyncStatus } from "@remit/domain-enums";
import { createQueueProducer } from "@remit/sqs-client/producer";

/**
 * Event the reconciler (imap-worker `handlePlacementMovePush`) drains. Carries
 * ONLY our own message id — never a UID (epic #1281 invariant 1). The UID is
 * resolved fresh from the Message row at push time, so the event stays valid
 * across any amount of queue delay or an unrelated UIDVALIDITY rebuild
 * (#1272).
 */
export interface PlacementMovePushEvent {
	type: "PLACEMENT_MOVE_PUSH";
	eventId: string;
	timestamp: number;
	accountId: string;
	accountConfigId: string;
	messageId: string;
}

export interface PlacementMoveLogger {
	info(obj: Record<string, unknown>, msg: string): void;
	error(obj: Record<string, unknown>, msg: string): void;
}

const noopLogger: PlacementMoveLogger = {
	info: () => {},
	error: () => {},
};

export interface PlacementMoveConfig {
	messageService: IMessageRepository;
	threadMessageService: IThreadMessageRepository;
	markerService: IMessagePlacementMoveRepository;
	sqsQueueUrl: string;
	sqsEndpoint?: string;
	logger?: PlacementMoveLogger;
}

/**
 * Local-first mover for a classification-driven placement move (issue #1271,
 * epic #1281). Distinct from {@link MessageMoveService} (user-initiated
 * moves/deletes/copies), which is untouched by this fix — the epic's UID
 * staleness invariant (1) only applies to the NEW reconciler this class
 * feeds; generalizing it to every move type is out of scope here.
 *
 * `moveMessage` matches {@link MessageMoveService.moveMessage}'s signature so
 * `BodySyncService`'s existing rescue/demote call site and its tests need no
 * shape changes beyond the dependency's name.
 *
 * Ordering is the fix: every step below (marker, ThreadMessage, Message row,
 * SQS enqueue) completes — or the whole call rejects — BEFORE the caller
 * (`BodySyncService.storeStreamedBody`) writes `bodyStorageKey`. A rejection
 * here therefore always happens before the body-sync skip-guard can trip, so
 * a retry reprocesses the message from scratch. Nothing here is swallowed —
 * let it crash, same as any other infra failure (an SQS enqueue failure is a
 * serious operational failure, not a routine blip: it propagates so a
 * repeated failure reaches the alarmed message-mgmt DLQ, never absorbed).
 *
 * Recovery is driven by the marker's explicit state engine (`pending ->
 * queued -> processing -> processed`, `MessagePlacementMoveState`), not by
 * comparing the message's current location against the requested
 * destination — that comparison alone cannot tell "already confirmed" apart
 * from "local move landed but the enqueue never did" (the defect this issue
 * originally fixes). A retry always re-fetches the marker and drives it
 * forward from whichever state it is actually in.
 */
export class PlacementMoveService {
	private messageService: IMessageRepository;
	private threadMessageService: IThreadMessageRepository;
	private markerService: IMessagePlacementMoveRepository;
	private sqs: SQSClient;
	private queueUrl: string;
	private log: PlacementMoveLogger;

	constructor(config: PlacementMoveConfig) {
		this.messageService = config.messageService;
		this.threadMessageService = config.threadMessageService;
		this.markerService = config.markerService;
		this.queueUrl = config.sqsQueueUrl;
		this.log = config.logger ?? noopLogger;
		this.sqs = createQueueProducer({
			queueUrl: config.sqsQueueUrl,
			endpoint: config.sqsEndpoint,
		});
	}

	moveMessage = async (
		accountConfigId: string,
		messageId: string,
		destinationMailboxId: string,
		accountId: string,
	): Promise<void> => {
		const message = await this.messageService.get(messageId);
		const sourceMailboxId = message.mailboxId;

		// Recovery: a marker already exists for THIS message and destination —
		// from an earlier (possibly partially-failed) call. The marker's STATE,
		// not a comparison against the message's current location, decides what
		// happens next (PR #1289 review finding 1 + design amendment: an
		// explicit pending -> queued -> processing -> processed engine).
		const existingMarker = await this.markerService.find(messageId);
		if (
			existingMarker &&
			existingMarker.destinationMailboxId === destinationMailboxId
		) {
			if (existingMarker.state === "pending") {
				// Local move + marker already committed; only the enqueue is
				// missing (or a further retry after the enqueue itself failed
				// again). Drive the SAME marker forward — never re-derive the
				// local move, which already happened.
				await this.enqueuePush({ accountId, accountConfigId, messageId });
				await this.markerService.updateState(messageId, "queued");
				this.log.info(
					{ messageId, accountId, destinationMailboxId },
					"Pending marker survived an earlier enqueue failure; re-enqueued and advanced to queued",
				);
			}
			// queued / processing / processed already has its own driver in
			// flight (the SQS message, or the reconciler currently running) —
			// nothing to do here either way.
			return;
		}

		// Genuine no-op: nothing pending for this destination, and the message
		// is already there (a duplicate verdict recomputed after a confirmed
		// move).
		if (sourceMailboxId === destinationMailboxId) return;

		// Fresh move. Strictly sequential — nothing here is parallel: the local
		// move (marker + ThreadMessage + Message row) fully commits BEFORE the
		// queue kick runs. `put` is idempotent and always resets `state` back to
		// `pending`, since a fresh decision starts a new lifecycle regardless of
		// what a stale row (different destination) held.
		await this.markerService.put({
			messageId,
			accountId,
			accountConfigId,
			sourceMailboxId,
			destinationMailboxId,
		});

		await this.updateThreadMessageMailbox(
			accountConfigId,
			messageId,
			destinationMailboxId,
		);

		await this.messageService.updateForMove(messageId, {
			mailboxId: destinationMailboxId,
			status: MessageStatus.moving,
			syncStatus: MessageSyncStatus.pending,
			originalMailboxId: sourceMailboxId,
			originalUid: message.uid,
		});

		// The queue kick is a serious operational step, not a routine one — a
		// failure here MUST propagate (never swallowed): the marker stays
		// `pending`, the surrounding body-sync call fails, SQS redelivers, and
		// a repeated failure reaches the alarmed message-mgmt DLQ. The state
		// engine makes this *recoverable* (the recovery branch above drives a
		// surviving `pending` marker forward on the next call) — it must never
		// make it *quiet*.
		await this.enqueuePush({ accountId, accountConfigId, messageId });
		await this.markerService.updateState(messageId, "queued");

		this.log.info(
			{ messageId, accountId, sourceMailboxId, destinationMailboxId },
			"Placement move applied locally; pending marker queued for IMAP push",
		);
	};

	private updateThreadMessageMailbox = async (
		accountConfigId: string,
		messageId: string,
		destinationMailboxId: string,
	): Promise<void> => {
		const threadMessage = await this.threadMessageService.getByMessageId(
			accountConfigId,
			messageId,
		);

		await this.threadMessageService.update(
			threadMessage.accountConfigId,
			threadMessage.threadMessageId,
			{ mailboxId: destinationMailboxId },
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
	};

	private enqueuePush = async (params: {
		accountId: string;
		accountConfigId: string;
		messageId: string;
	}): Promise<void> => {
		const event: PlacementMovePushEvent = {
			type: "PLACEMENT_MOVE_PUSH",
			eventId: randomUUID(),
			timestamp: Date.now(),
			...params,
		};
		await this.sqs.send(
			new SendMessageCommand({
				QueueUrl: this.queueUrl,
				MessageBody: JSON.stringify(event),
			}),
		);
	};
}
