import type {
	BodyPartUpsertInput,
	IAddressRepository,
	IEnvelopeRepository,
	IMailboxRepository,
	IMessageRepository,
	IThreadMessageRepository,
	IUnitOfWork,
	MailboxItem,
} from "@remit/data-ports";
import { AddressRole, MailboxCursorState } from "@remit/domain-enums";
import {
	AddressService,
	deriveBodyPartId,
	EnvelopeService,
	MessageService,
	ThreadMessageService,
} from "@remit/remit-electrodb-service";
import pMap from "p-map";
import type { ManagedConnectionFactory } from "./connection-factory.js";
import { guardMailboxCursor, isCursorRebuildNeeded } from "./mailbox-cursor.js";
import {
	type CursorRebuildRow,
	type CursorRebuildSnapshot,
	matchCursorRebuild,
} from "./mailbox-cursor-rebuild.js";
import { ROOT_PART_PATH, walkMimeStructure } from "./mime-walker.js";
import { PassThroughUnitOfWork } from "./pass-through-unit-of-work.js";
import { reconcileStaleMessage } from "./stale-message-reconcile.js";
import type {
	ImapAddress,
	ImapBodyStructure,
	ImapEnvelope,
	ImapMessage,
} from "./types.js";

const MESSAGE_SAVE_CONCURRENCY = 10;

// Some IMAP servers (e.g. Hostnet) emit these literal placeholders in the
// ENVELOPE when they cannot parse a From header, instead of leaving the
// address parts empty.
const HOSTNET_MISSING_MAILBOX = "missing_mailbox";
const HOSTNET_MISSING_DOMAIN = "missing_domain";

/**
 * A From address is only usable when it looks like a real mailbox: both parts
 * present, neither is a known "could not parse" sentinel, and the host carries
 * an actual domain (at least one dot). Detect this structurally so a fabricated
 * string like `missing_mailbox@missing_domain` is never persisted as a sender.
 */
export const isParseableEmailAddress = (
	address: ImapAddress | undefined,
): boolean => {
	if (!address) return false;
	const mailbox = address.mailbox?.trim();
	const host = address.host?.trim();
	if (!mailbox || !host) return false;
	if (mailbox === HOSTNET_MISSING_MAILBOX || host === HOSTNET_MISSING_DOMAIN) {
		return false;
	}
	return host.includes(".");
};

/**
 * Parse an external `Date:` header into an epoch-millisecond integer.
 *
 * The IMAP envelope `date` is a raw RFC 2822 header copied verbatim from the
 * message. It can be missing, malformed, or in a format `Date` cannot parse —
 * `new Date(raw).getTime()` then yields `NaN`. `NaN` is not a valid integer
 * and ElectroDB rejects it, which previously threw on the envelope upsert and
 * (because the batch aborted on the first rejection) stalled the whole mailbox.
 *
 * When the header is unparseable we fall back to `fallbackMs` — the IMAP
 * server's own INTERNALDATE receive time, always a valid integer. The raw
 * header is preserved separately in `dateRaw`, so nothing is lost.
 */
export const parseHeaderDate = (
	raw: string | undefined,
	fallbackMs: number,
): { value: number; usedFallback: boolean } => {
	if (raw !== undefined && raw !== "") {
		const parsed = new Date(raw).getTime();
		if (Number.isFinite(parsed)) {
			return { value: parsed, usedFallback: false };
		}
	}
	return { value: fallbackMs, usedFallback: true };
};

/**
 * @deprecated Use ManagedConnectionFactory instead
 */
export type ImapConnectionFactory = () => {
	connect(): Promise<void>;
	disconnect(): Promise<void>;
};

export interface SyncLogger {
	info(obj: Record<string, unknown>, msg: string): void;
	warn(obj: Record<string, unknown>, msg: string): void;
}

const noopLogger: SyncLogger = {
	info: () => {},
	warn: () => {},
};

export interface SyncedMessage {
	messageId: string;
	uid: number;
}

/**
 * Per-message save outcome. `owned` is true when the row was created by this
 * sync or already belongs to the current mailbox; false for a residual
 * cross-mailbox collision whose stored row points at a different mailbox.
 */
interface SaveMessageResult extends SyncedMessage {
	owned: boolean;
}

/**
 * Wrapper outcome for a single message in the batch. A `failed` outcome means
 * the save threw (and was caught) — its UID must NOT advance the watermark, so
 * the message is re-fetched and retried on the next cycle. `null` means the
 * message carried no envelope and was intentionally skipped (nothing to retry).
 */
type BatchOutcome =
	| { kind: "saved"; uid: number; result: SaveMessageResult | null }
	| { kind: "failed"; uid: number };

export interface SyncMessagesResult {
	syncedCount: number;
	syncedMessageIds: string[];
	syncedMessages: SyncedMessage[];
	hasMore: boolean;
	remainingCount: number;
}

export class MessageSyncService {
	private log: SyncLogger;
	private unitOfWork: IUnitOfWork;

	constructor(
		private connectionFactory: ManagedConnectionFactory,
		private mailboxService: IMailboxRepository,
		messageService: IMessageRepository,
		envelopeService: IEnvelopeRepository,
		addressService: IAddressRepository,
		private threadMessageService: IThreadMessageRepository,
		logger?: SyncLogger,
		unitOfWork?: IUnitOfWork,
	) {
		this.log = logger ?? noopLogger;
		this.unitOfWork =
			unitOfWork ??
			new PassThroughUnitOfWork({
				message: messageService,
				envelope: envelopeService,
				address: addressService,
				threadMessage: threadMessageService,
			});
	}

	/**
	 * Sync ONE batch of messages for a mailbox using newest-first strategy.
	 *
	 * Uses dual-watermark tracking:
	 * - highWaterMarkUid: highest UID ever seen (detects new messages)
	 * - lastSyncUid: lowest UID processed (tracks backfill progress)
	 *
	 * Returns hasMore=true if there are more messages to sync. The caller
	 * should re-enqueue another sync event to continue processing.
	 *
	 * @param mailboxId - The database mailbox ID
	 * @param accountId - The account ID (scopes message/thread identity)
	 * @param accountConfigId - The account config ID (used for address linking)
	 * @param batchSize - Number of messages to process per batch
	 */
	async syncMessages(
		mailboxId: string,
		accountId: string,
		accountConfigId: string,
		batchSize = 50,
	): Promise<SyncMessagesResult> {
		const mailbox = await this.mailboxService.get(accountId, mailboxId);
		const mailboxPath = mailbox.fullPath;

		// A mailbox whose cursor is already invalid (or a rebuild that crashed
		// mid-way, #1272) never falls through to the normal watermark-based sync
		// below — stored UIDs on that axis are not trustworthy. The rebuild is a
		// variant of sync, not a special wipe path, so it runs here under the
		// same mailbox lock the caller already holds.
		if (isCursorRebuildNeeded(mailbox.cursorState)) {
			return this.rebuildCursor(mailbox, accountId, accountConfigId, mailboxId);
		}

		const lastSyncUid = mailbox.lastSyncUid || 0;
		const highWaterMarkUid = mailbox.highWaterMarkUid || 0;

		const { box, unseenCount, deletedCount, uids } = await this.fetchUidsToSync(
			mailboxPath,
			lastSyncUid,
			highWaterMarkUid,
		);

		// Detection: the served UIDVALIDITY may have changed since it was last
		// stored, even though this mailbox was `normal` a moment ago. Trip the
		// cursor and pause — the watermarks just used to filter `uids` may
		// already be meaningless on the new axis, so nothing below may be acted
		// on this round (epic #1281 invariants 3 and 5).
		const cursorCheck = await guardMailboxCursor(
			{ mailboxService: this.mailboxService },
			accountId,
			mailbox,
			box.uidvalidity,
		);
		if (!cursorCheck.ok) {
			this.log.warn(
				{ mailboxId, mailboxPath, cursorState: cursorCheck.state },
				"UIDVALIDITY changed; mailbox cursor tripped, pausing outbound sync this round",
			);
			return {
				syncedCount: 0,
				syncedMessageIds: [],
				syncedMessages: [],
				hasMore: false,
				remainingCount: 0,
			};
		}

		if (uids.length === 0) {
			// Still update counts even if no new messages to sync
			await this.mailboxService.update(accountId, mailboxId, {
				lastMessageSyncAt: Date.now(),
				uidValidity: box.uidvalidity,
				messageCount: box.messageCount,
				unseenCount,
				deletedCount,
			});

			this.log.info(
				{
					mailboxId,
					mailboxPath,
					total: 0,
					messageCount: box.messageCount,
					unseenCount,
				},
				"No new messages to sync",
			);
			return {
				syncedCount: 0,
				syncedMessageIds: [],
				syncedMessages: [],
				hasMore: false,
				remainingCount: 0,
			};
		}

		const totalBatches = Math.ceil(uids.length / batchSize);
		this.log.info(
			{ mailboxId, mailboxPath, total: uids.length, batches: totalBatches },
			"Starting message sync batch (newest first)",
		);

		// Process only the first batch
		const batchUids = uids.slice(0, batchSize);
		const messages = await this.fetchMessageBatch(batchUids);

		// Process messages in parallel with concurrency limit. `stopOnError` stays
		// at its default — but each message is saved through `trySaveMessage`,
		// which catches its own error and reports a `failed` outcome instead of
		// rejecting. So one bad message can no longer abort the whole batch (the
		// poison pill that previously froze the mailbox, #817).
		const outcomes = await pMap(
			messages,
			(msg) => this.trySaveMessage(mailboxId, accountId, accountConfigId, msg),
			{ concurrency: MESSAGE_SAVE_CONCURRENCY },
		);

		// Body-sync set: only rows created or owned by THIS mailbox. A residual
		// cross-mailbox collision (same deterministic messageId already owned by a
		// different mailbox) must not push a foreign-owned messageId into
		// syncedMessageIds, or body-sync would FETCH against the wrong mailbox's UID.
		const ownedResults = outcomes.flatMap((o) =>
			o.kind === "saved" && o.result !== null && o.result.owned
				? [o.result]
				: [],
		);
		const syncedMessages: SyncedMessage[] = ownedResults.map(
			({ messageId, uid }) => ({ messageId, uid }),
		);
		const syncedMessageIds = syncedMessages.map((m) => m.messageId);

		// UIDs whose save threw. They must stay inside the next cycle's fetch
		// window, so the watermark may not advance past them (no silent loss).
		const failedUids = new Set(
			outcomes.flatMap((o) => (o.kind === "failed" ? [o.uid] : [])),
		);
		if (failedUids.size > 0) {
			this.log.warn(
				{ mailboxId, mailboxPath, failedUids: [...failedUids] },
				"Some messages failed to save; holding watermark below them for retry",
			);
		}

		// Watermarks advance over every SUCCESSFULLY-consumed UID in the batch,
		// independent of ownership. `fetchUidsToSync` reselects work purely by UID
		// vs watermark (there is no per-UID processed set), so a foreign-owned UID
		// that did not advance the watermark would be re-fetched every cycle
		// forever. The same Message-ID legitimately appears in several of one
		// account's mailboxes (Gmail All Mail + INBOX/labels), so cross-mailbox
		// conflicts are routine; excluding them from body-sync is correct, stalling
		// forward sync is not.
		//
		// Failures are different: the watermark range [batchMin, batchMax] jumps
		// over any interior UID, so a failed UID inside the range would be lost.
		// We therefore advance the forward watermark only past the top contiguous
		// run of successes, and the backfill watermark only past the bottom
		// contiguous run — clamping at the first failure from each end so every
		// failed UID stays selectable next cycle.
		const ascendingUids = [...batchUids].sort((a, b) => a - b);

		// Top contiguous run of successes → the highest UID safe to mark "seen".
		let forwardMax = highWaterMarkUid;
		for (let i = ascendingUids.length - 1; i >= 0; i--) {
			const uid = ascendingUids[i];
			if (failedUids.has(uid)) break;
			forwardMax = Math.max(forwardMax, uid);
		}
		const newHighWaterMark = forwardMax;

		// Bottom contiguous run of successes → the lowest UID safe to backfill
		// past. The first (lowest) UID that succeeded defines it; if the very
		// lowest UID failed there is nothing safe to backfill past.
		const backfillMin: number | undefined = failedUids.has(ascendingUids[0])
			? undefined
			: ascendingUids[0];

		// Update lastSyncUid only for backfill UIDs (below current lastSyncUid or
		// fresh sync). When the lowest UID failed there is nothing safe to backfill
		// past, so leave lastSyncUid untouched.
		const newLastSyncUid =
			backfillMin !== undefined &&
			(lastSyncUid === 0 || backfillMin < lastSyncUid)
				? backfillMin
				: lastSyncUid;

		await this.mailboxService.update(accountId, mailboxId, {
			lastSyncUid: newLastSyncUid,
			highWaterMarkUid: newHighWaterMark,
			lastMessageSyncAt: Date.now(),
			uidValidity: box.uidvalidity,
			messageCount: box.messageCount,
			unseenCount,
			deletedCount,
		});

		const remainingCount = uids.length - batchUids.length;
		const hasMore = remainingCount > 0;

		this.log.info(
			{
				batch: 1,
				totalBatches,
				batchSize: messages.length,
				synced: syncedMessageIds.length,
				total: uids.length,
				remaining: remainingCount,
				hasMore,
				highWaterMarkUid: newHighWaterMark,
				lastSyncUid: newLastSyncUid,
			},
			"Batch complete",
		);

		return {
			syncedCount: syncedMessageIds.length,
			syncedMessageIds,
			syncedMessages,
			hasMore,
			remainingCount,
		};
	}

	/**
	 * Re-key a mailbox's stored UIDs against a new UIDVALIDITY axis (#1272).
	 *
	 * One envelope-level pass (UID + Message-ID + INTERNALDATE, no body
	 * fetches — {@link matchCursorRebuild}) matched against the rows already
	 * stored for this mailbox:
	 * - Match → rewrite the row's UID mapping in place; bodies and threads are
	 *   untouched.
	 * - Server message with no row → normal new-message sync (the same
	 *   `trySaveMessage` pipeline the regular batch sync uses).
	 * - Row with no counterpart → expunged; reconcile via {@link
	 *   reconcileStaleMessage} (#1283 — the exact same "gone upstream" outcome
	 *   as a body-sync retry exhaustion finding a stale row).
	 *
	 * Idempotent by construction: re-entering mid-rebuild (crash recovery —
	 * the mailbox was left `rebuilding`) simply redoes the same match/rewrite
	 * pass, which converges on the same result. `cursorState` is stamped
	 * `rebuilding` before any write and only cleared to `normal` after the
	 * watermarks are rebuilt, so a crash anywhere in between leaves the
	 * mailbox paused rather than falling back to the stale axis.
	 */
	private async rebuildCursor(
		mailbox: MailboxItem,
		accountId: string,
		accountConfigId: string,
		mailboxId: string,
	): Promise<SyncMessagesResult> {
		const mailboxPath = mailbox.fullPath;

		await this.mailboxService.update(accountId, mailboxId, {
			cursorState: MailboxCursorState.rebuilding,
		});

		const connection = this.connectionFactory.getConnection();
		const box = await connection.openBox(mailboxPath);
		const allUids = await connection.search(["ALL"]);
		const snapshots = await connection.fetchEnvelopeSnapshots(allUids);
		const serverSnapshots: CursorRebuildSnapshot[] = snapshots.map((s) => ({
			uid: s.uid,
			messageId: s.messageId,
			internalDate: s.internalDate.getTime(),
		}));

		const existingRows = await this.listExistingCursorRows(
			accountConfigId,
			mailboxId,
		);

		const { matched, newUids, staleMessageIds } = matchCursorRebuild(
			serverSnapshots,
			existingRows,
		);

		// Bounded concurrency (mirrors MESSAGE_SAVE_CONCURRENCY below) — a
		// sequential loop over a large mailbox's full match set risked the
		// Lambda timeout on its own, independent of the fetch-size question
		// (#1272 review, non-blocking finding).
		await pMap(
			matched,
			async ({ messageId, newUid, threadMessage }) => {
				await this.unitOfWork.transaction((repos) =>
					repos.message.updateUid(messageId, newUid, mailboxId),
				);
				// Rewrite the denormalized ThreadMessage.uid alongside Message.uid —
				// a normal move keeps both in sync (see buildThreadMessageMoveUpdate
				// in message-move.ts), and the rebuild must too, or a resumed
				// rebuild re-emits a no-op rewrite forever (listExistingCursorRows
				// reads uid from ThreadMessage) and any reader of the list
				// projection sees a stale UID.
				if (threadMessage) {
					await this.unitOfWork.transaction((repos) =>
						repos.threadMessage.update(
							threadMessage.accountConfigId,
							threadMessage.threadMessageId,
							{ uid: newUid },
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
						),
					);
				}
			},
			{ concurrency: MESSAGE_SAVE_CONCURRENCY },
		);

		await pMap(
			staleMessageIds,
			(messageId) =>
				this.unitOfWork.transaction((repos) =>
					reconcileStaleMessage(
						{
							messageService: repos.message,
							threadMessageService: repos.threadMessage,
						},
						accountConfigId,
						messageId,
					),
				),
			{ concurrency: MESSAGE_SAVE_CONCURRENCY },
		);

		const newMessages =
			newUids.length > 0 ? await this.fetchMessageBatch(newUids) : [];
		const outcomes = await pMap(
			newMessages,
			(msg) => this.trySaveMessage(mailboxId, accountId, accountConfigId, msg),
			{ concurrency: MESSAGE_SAVE_CONCURRENCY },
		);
		const syncedMessages: SyncedMessage[] = outcomes.flatMap((o) =>
			o.kind === "saved" && o.result !== null && o.result.owned
				? [{ messageId: o.result.messageId, uid: o.result.uid }]
				: [],
		);

		const serverUids = serverSnapshots.map((s) => s.uid);
		const status = await connection.getMailboxStatus(mailboxPath);

		await this.mailboxService.update(accountId, mailboxId, {
			cursorState: MailboxCursorState.normal,
			uidValidity: box.uidvalidity,
			highWaterMarkUid: serverUids.length > 0 ? Math.max(...serverUids) : 0,
			lastSyncUid: serverUids.length > 0 ? Math.min(...serverUids) : 0,
			highestModseq: status.highestModseq,
			lastMessageSyncAt: Date.now(),
			messageCount: status.messages,
			unseenCount: status.unseen,
			deletedCount: status.deletedCount,
		});

		this.log.info(
			{
				mailboxId,
				mailboxPath,
				matched: matched.length,
				newMessages: syncedMessages.length,
				stale: staleMessageIds.length,
			},
			"Mailbox cursor rebuild complete; returned to normal",
		);

		return {
			syncedCount: syncedMessages.length,
			syncedMessageIds: syncedMessages.map((m) => m.messageId),
			syncedMessages,
			hasMore: false,
			remainingCount: 0,
		};
	}

	/**
	 * Page through every ThreadMessage row for this mailbox, projecting just
	 * the fields {@link matchCursorRebuild} needs. ThreadMessage (not
	 * Message) is the read source: it already denormalizes `messageIdHeader`
	 * and `internalDate` alongside `uid`, so this needs no per-row Envelope
	 * lookup.
	 */
	private async listExistingCursorRows(
		accountConfigId: string,
		mailboxId: string,
	): Promise<CursorRebuildRow[]> {
		const rows: CursorRebuildRow[] = [];
		let continuationToken: string | undefined;

		do {
			const result = await this.threadMessageService.listByMailbox(
				accountConfigId,
				mailboxId,
				{
					continuationToken,
					attributes: [
						"messageId",
						"messageIdHeader",
						"internalDate",
						"uid",
						"accountConfigId",
						"threadMessageId",
						"sentDate",
						"mailboxId",
						"isRead",
						"isDeleted",
						"hasStars",
						"hasAttachment",
					],
				},
			);
			for (const row of result.items) {
				rows.push({
					messageId: row.messageId,
					messageIdHeader: row.messageIdHeader ?? "",
					internalDate: row.internalDate,
					uid: row.uid,
					// Carried so a match can also rewrite ThreadMessage.uid (a normal
					// move keeps both in sync — the rebuild must too, or #1271's
					// push-time UID resolution can read a stale projection).
					threadMessage: {
						accountConfigId: row.accountConfigId,
						threadMessageId: row.threadMessageId,
						sentDate: row.sentDate,
						mailboxId: row.mailboxId,
						isRead: row.isRead,
						isDeleted: row.isDeleted,
						hasStars: row.hasStars,
						hasAttachment: row.hasAttachment,
					},
				});
			}
			continuationToken = result.continuationToken;
		} while (continuationToken);

		return rows;
	}

	/**
	 * Fetch UIDs to sync using dual-watermark strategy.
	 *
	 * Returns UIDs sorted descending (newest first):
	 * 1. New messages: UIDs > highWaterMarkUid
	 * 2. Backfill: UIDs < lastSyncUid (if lastSyncUid > 1)
	 */
	private async fetchUidsToSync(
		mailboxPath: string,
		lastSyncUid: number,
		highWaterMarkUid: number,
	): Promise<{
		box: { uidvalidity: number; uidnext: number; messageCount: number };
		unseenCount: number;
		deletedCount: number;
		uids: number[];
	}> {
		const connection = this.connectionFactory.getConnection();
		const box = await connection.openBox(mailboxPath);

		// Get mailbox status including unseen count
		const status = await connection.getMailboxStatus(mailboxPath);

		const allUids = await connection.search(["ALL"]);

		// New messages: UIDs greater than what we've seen
		const newUids = allUids.filter((uid) => uid > highWaterMarkUid);

		// Backfill: UIDs below our lowest synced point (if sync started)
		const backfillUids =
			lastSyncUid > 1 ? allUids.filter((uid) => uid < lastSyncUid) : [];

		// Fresh sync: if no watermarks, sync everything
		const isFreshSync = highWaterMarkUid === 0 && lastSyncUid === 0;
		const uidsToSync = isFreshSync ? allUids : [...newUids, ...backfillUids];

		// Sort descending (newest first)
		uidsToSync.sort((a, b) => b - a);

		return {
			box: {
				uidvalidity: box.uidvalidity,
				uidnext: box.uidnext,
				messageCount: status.messages,
			},
			unseenCount: status.unseen,
			deletedCount: status.deletedCount,
			uids: uidsToSync,
		};
	}

	/**
	 * Fetch a batch of messages using the managed connection.
	 * Assumes mailbox is already open from fetchUidsToSync.
	 */
	private async fetchMessageBatch(uids: number[]): Promise<ImapMessage[]> {
		const connection = this.connectionFactory.getConnection();
		return await connection.fetchMessages(uids);
	}

	/**
	 * Save a single message without ever rejecting. Any error is caught and
	 * reported as a `failed` outcome so it cannot abort the surrounding `pMap`
	 * batch — the failed UID is held back from the watermark and retried next
	 * cycle. This is the guardrail that stops a single unsaveable message from
	 * permanently freezing the mailbox (#817).
	 */
	private async trySaveMessage(
		mailboxId: string,
		accountId: string,
		accountConfigId: string,
		msg: ImapMessage,
	): Promise<BatchOutcome> {
		return this.saveMessage(mailboxId, accountId, accountConfigId, msg)
			.then((result): BatchOutcome => ({ kind: "saved", uid: msg.uid, result }))
			.catch((error): BatchOutcome => {
				this.log.warn(
					{
						mailboxId,
						uid: msg.uid,
						messageId: msg.envelope?.messageId,
						error: error instanceof Error ? error.message : String(error),
					},
					"Failed to save message; will retry on next sync",
				);
				return { kind: "failed", uid: msg.uid };
			});
	}

	private async saveMessage(
		mailboxId: string,
		accountId: string,
		accountConfigId: string,
		msg: ImapMessage,
	): Promise<SaveMessageResult | null> {
		if (!msg.envelope) return null;

		// Store envelope to preserve narrowing in closures
		const envelope = msg.envelope;

		const messageId = MessageService.generateIdFromSource(accountId, {
			messageId: envelope.messageId,
			uid: msg.uid,
			mailboxId,
			date: envelope.date,
			subject: envelope.subject,
			fromMailbox: envelope.from?.[0]?.mailbox,
			fromHost: envelope.from?.[0]?.host,
		});
		const envelopeId = EnvelopeService.generateId(messageId);
		const rootBodyPartId = deriveBodyPartId(messageId, ROOT_PART_PATH);

		const internalDateMs = msg.internalDate.getTime();
		const { value: sentDate, usedFallback: dateFellBack } = parseHeaderDate(
			envelope.date,
			internalDateMs,
		);
		if (dateFellBack) {
			this.log.warn(
				{
					mailboxId,
					messageId,
					uid: msg.uid,
					dateRaw: envelope.date,
				},
				"Unparseable Date header; fell back to IMAP internalDate",
			);
		}

		// Prepare all address save operations
		const addressOps: Array<{
			addresses: ImapAddress[] | undefined;
			role: (typeof AddressRole)[keyof typeof AddressRole];
		}> = [
			{ addresses: envelope.from, role: AddressRole.From },
			{ addresses: envelope.sender, role: AddressRole.Sender },
			{ addresses: envelope.replyTo, role: AddressRole.ReplyTo },
			{ addresses: envelope.to, role: AddressRole.To },
			{ addresses: envelope.cc, role: AddressRole.Cc },
			{ addresses: envelope.bcc, role: AddressRole.Bcc },
		];

		const bodyParts = buildBodyPartUpserts(msg.bodyStructure);
		const hasAttachment = bodyParts.some(
			(p) => !p.isMultipart && p.disposition === "attachment",
		);

		// Ownership of this messageId by the current mailbox: the row was created
		// by this call, or an existing row already belongs to this mailbox. A
		// conflict whose stored row points at a different mailbox is foreign-owned
		// and must not feed this mailbox's watermark / body-sync (#634).
		let owned = false;

		// One unit of work for the whole message: on Postgres these repos are
		// transaction-bound, so the Envelope, addresses, Message, BodyParts and
		// ThreadMessage — and the transactional-outbox rows the Message write
		// appends — all commit together. A throw anywhere rolls the whole set
		// back, so a failed save never strands a Message without its Envelope
		// (#1072). Writes run in sequence: a single transaction serialises on one
		// connection, and it lets the Envelope land before the Message, with the
		// ThreadMessage written last so the list path never anchors on a
		// ThreadMessage whose Message does not yet exist (#1209).
		await this.unitOfWork.transaction(async (repos) => {
			await repos.envelope.upsertEnvelope({
				envelopeId,
				messageId,
				dateValue: sentDate,
				dateRaw: envelope.date,
				subject: envelope.subject,
				messageIdValue: envelope.messageId,
			});

			for (const { addresses, role } of addressOps) {
				await this.saveAddresses(
					repos.address,
					messageId,
					accountConfigId,
					addresses,
					role,
				);
			}

			// IMAP returns BODYSTRUCTURE in the same FETCH that returns the
			// envelope, so persisting BodyParts here is "free" — no extra round-trip.
			if (bodyParts.length > 0) {
				await repos.envelope.upsertBodyParts(messageId, bodyParts);
			}

			const { item, created } = await repos.message.upsertWithStatus({
				messageId,
				mailboxId,
				uid: msg.uid,
				sequenceNumber: msg.seq,
				rfc822Size: msg.size ?? 0,
				internalDate: msg.internalDate.getTime(),
				envelopeId,
				rootBodyPartId,
			});
			owned = created || item.mailboxId === mailboxId;

			await this.createThreadForMessage(
				repos.threadMessage,
				messageId,
				mailboxId,
				accountId,
				accountConfigId,
				msg.uid,
				msg.internalDate.getTime(),
				sentDate,
				envelope,
				msg.flags,
				msg.references,
				hasAttachment,
			);
		});

		return { messageId, uid: msg.uid, owned };
	}

	private async saveAddresses(
		addressService: IAddressRepository,
		messageId: string,
		accountConfigId: string,
		addresses: ImapAddress[] | undefined,
		role: (typeof AddressRole)[keyof typeof AddressRole],
	) {
		if (!addresses) return;

		// Pre-compute address data with order indices, filtering valid addresses
		const addressData: Array<{
			localPart: string;
			domain: string;
			displayName: string;
			order: number;
		}> = [];

		for (let i = 0; i < addresses.length; i++) {
			const addr = addresses[i];
			if (!isParseableEmailAddress(addr)) continue;
			addressData.push({
				localPart: addr.mailbox,
				domain: addr.host,
				displayName: addr.name || "",
				order: i,
			});
		}

		for (const { localPart, domain, displayName, order } of addressData) {
			const normalizedEmail = `${localPart}@${domain}`.toLowerCase();
			const normalizedCompound = `${displayName.toLowerCase()} ${normalizedEmail}`;

			const addressId = AddressService.generateAddressId(
				accountConfigId,
				normalizedEmail,
			);

			const envelopeAddressId = AddressService.generateEnvelopeAddressId(
				messageId,
				role,
				order,
			);

			await addressService.upsertAddress({
				addressId,
				accountConfigId,
				localPart,
				domain,
				normalizedEmail,
				normalizedCompound,
				displayName,
			});

			await addressService.upsertEnvelopeAddress({
				envelopeAddressId,
				messageId,
				addressId,
				displayName,
				normalizedEmail,
				addressRole: role,
				addressOrder: order,
			});
		}
	}

	/**
	 * Create or update Thread and ThreadMessage for a synced message.
	 *
	 * Thread ID derivation (RFC 2822 compliant):
	 * 1. If References header exists, use the FIRST entry as thread root
	 *    (References format: <root> <parent1> ... <direct-parent>)
	 * 2. Fall back to In-Reply-To if no References
	 * 3. Fall back to Message-ID (this message is a thread root)
	 *
	 * This ensures proper threading even when messages arrive out of order.
	 */
	private async createThreadForMessage(
		threadMessageService: IThreadMessageRepository,
		messageId: string,
		mailboxId: string,
		accountId: string,
		accountConfigId: string,
		uid: number,
		internalDate: number,
		sentDate: number,
		envelope: ImapEnvelope,
		flags: string[],
		references?: string[],
		hasAttachment = false,
	): Promise<void> {
		// Determine the thread root Message-ID
		let rootMessageIdHeader: string;

		if (references && references.length > 0) {
			// References header exists - first entry is the thread root (RFC 2822)
			rootMessageIdHeader = references[0];
		} else if (envelope.inReplyTo) {
			// No References, but has In-Reply-To - use as thread root
			// (This is a reply to a single message, which becomes the root)
			rootMessageIdHeader = envelope.inReplyTo;
		} else if (MessageService.isValidMessageId(envelope.messageId)) {
			// No References, no In-Reply-To - this message is a thread root
			rootMessageIdHeader = envelope.messageId;
		} else {
			// No usable header (missing, empty, or a "<>" delivery-failure
			// placeholder). Fall back to the always-present internal messageId so
			// this message becomes a standalone thread-of-one. Distinct headerless
			// messages keep distinct ids, so they never collide into one bogus
			// thread, and every persisted Message gets exactly one ThreadMessage.
			rootMessageIdHeader = messageId;
		}

		// Derive threadId from the root Message-ID (deterministic)
		const threadId = ThreadMessageService.deriveThreadId(
			accountId,
			rootMessageIdHeader,
		);

		// Check if message is read based on IMAP flags
		const isRead = flags.includes("\\Seen");

		// Extract sender info. When the server could not parse the From address,
		// omit fromEmail rather than persist a fabricated string — a display name
		// may still be present and useful, so keep it.
		const fromAddr = envelope.from?.[0];
		const fromEmail = isParseableEmailAddress(fromAddr)
			? `${fromAddr?.mailbox}@${fromAddr?.host}`.toLowerCase()
			: undefined;
		const fromName = fromAddr?.name;

		// Calculate reference order (position in the thread chain)
		// references.length gives the position since References = [root, parent1, parent2, ...]
		const referenceOrder = references?.length ?? (envelope.inReplyTo ? 1 : 0);

		// Create ThreadMessage linking message to thread
		await threadMessageService
			.create({
				threadId,
				messageId,
				accountConfigId,
				mailboxId,
				uid,
				messageIdHeader: envelope.messageId,
				inReplyTo: envelope.inReplyTo,
				referenceOrder,
				fromEmail,
				fromName,
				subject: envelope.subject,
				internalDate,
				sentDate,
				isRead,
				isDeleted: false,
				hasAttachment,
				hasStars: false,
			})
			.catch((error: unknown) => {
				// Ignore conflict errors (idempotent create)
				if (
					(error as { name?: string })?.name === "CreateFailedConflictError"
				) {
					return;
				}
				throw error;
			});
	}
}

/**
 * Translate the IMAP BODYSTRUCTURE for a single message into a list of
 * `BodyPartUpsertInput`s ready for `EnvelopeService.upsertBodyParts`.
 * Returns an empty list when the server didn't return BODYSTRUCTURE
 * (some unusual messages, or older test fixtures).
 */
const buildBodyPartUpserts = (
	bodyStructure: ImapBodyStructure | undefined,
): BodyPartUpsertInput[] => {
	if (!bodyStructure) return [];
	return walkMimeStructure(bodyStructure).map((part) => ({
		partPath: part.partPath,
		parentPartPath: part.parentPartPath,
		mediaType: part.mediaType,
		mediaSubtype: part.mediaSubtype,
		transferEncoding: part.transferEncoding,
		sizeOctets: part.sizeOctets,
		isMultipart: part.isMultipart,
		parameters: part.parameters,
		...(part.contentId !== undefined ? { contentId: part.contentId } : {}),
		...(part.contentDescription !== undefined
			? { contentDescription: part.contentDescription }
			: {}),
		...(part.lineCount !== undefined ? { lineCount: part.lineCount } : {}),
		...(part.md5Hash !== undefined ? { md5Hash: part.md5Hash } : {}),
		...(part.disposition !== undefined
			? { disposition: part.disposition }
			: {}),
		...(part.dispositionFilename !== undefined
			? { dispositionFilename: part.dispositionFilename }
			: {}),
		...(part.language !== undefined ? { language: part.language } : {}),
		...(part.location !== undefined ? { location: part.location } : {}),
		...(part.multipartSubtype !== undefined
			? { multipartSubtype: part.multipartSubtype }
			: {}),
	}));
};
