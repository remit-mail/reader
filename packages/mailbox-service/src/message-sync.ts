import type {
	BodyPartUpsertInput,
	IAddressRepository,
	IEnvelopeRepository,
	IMailboxRepository,
	IMessageFlagPushRepository,
	IMessageFlagRepository,
	IMessageRepository,
	IThreadMessageRepository,
	IUnitOfWork,
	MailboxItem,
	ThreadMessageItem,
} from "@remit/data-ports";
import {
	deriveAddressId,
	deriveBodyPartId,
	deriveEnvelopeAddressId,
	deriveEnvelopeId,
	deriveMessageIdFromSource,
	deriveThreadId,
	isValidMessageId,
} from "@remit/data-ports/id";
import {
	AddressRole,
	MailboxCursorState,
	MessageSystemFlag,
	QuarantineFailureCode,
	QuarantineFailureStage,
	StarColor,
} from "@remit/domain-enums";
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
import {
	type QuarantineContext,
	type QuarantineService,
	shapeFromImapMessage,
} from "./quarantine.js";
import { reconcileStaleMessage } from "./stale-message-reconcile.js";
import {
	advanceChangeCursor,
	advanceUidWatermarks,
	type ChangeCursor,
	dropAppliedPrefix,
	formatChangeCursor,
	hasChangeCursor,
	orderByModseq,
	parseChangeCursor,
	parseModseq,
} from "./sync-watermarks.js";
import type {
	ImapAddress,
	ImapBodyStructure,
	ImapEnvelope,
	ImapMailboxStatus,
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
	error(obj: Record<string, unknown>, msg: string): void;
}

const noopLogger: SyncLogger = {
	info: () => {},
	warn: () => {},
	error: () => {},
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
 * the message is re-fetched and retried on the next cycle. A `saved` outcome
 * with a `null` result is a UID this round finished with but created no row
 * for: a cross-mailbox collision, a change applied to an existing row, or a
 * message quarantined instead of applied (issue #72). Its watermark advances
 * either way, because there is nothing left to retry.
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
	/**
	 * The round had work to do and moved no cursor. Nothing throws on this
	 * path — a message that cannot be applied is caught and held back — so
	 * without this flag a mailbox that stops syncing looks exactly like one
	 * with nothing to sync. Callers must surface it.
	 */
	cursorStalled: boolean;
}

const emptySyncResult = (): SyncMessagesResult => ({
	syncedCount: 0,
	syncedMessageIds: [],
	syncedMessages: [],
	hasMore: false,
	remainingCount: 0,
	cursorStalled: false,
});

/**
 * Pick the UIDs a full-enumeration round should sync, newest first.
 *
 * 1. New messages: UIDs above the forward watermark.
 * 2. Backfill: UIDs below the lowest one synced so far.
 * 3. A mailbox with no watermarks at all syncs everything.
 */
export const selectUidsToSync = (
	allUids: number[],
	lastSyncUid: number,
	highWaterMarkUid: number,
): number[] => {
	const newUids = allUids.filter((uid) => uid > highWaterMarkUid);
	const backfillUids =
		lastSyncUid > 1 ? allUids.filter((uid) => uid < lastSyncUid) : [];

	const isFreshSync = highWaterMarkUid === 0 && lastSyncUid === 0;
	const uidsToSync = isFreshSync ? [...allUids] : [...newUids, ...backfillUids];

	return uidsToSync.sort((a, b) => b - a);
};

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
		/**
		 * Pending outbound flag-push markers (#1273). Supplied, an inbound
		 * metadata change never overwrites a local flip that IMAP has not been
		 * told about yet; omitted, the server always wins.
		 */
		private flagPushMarkerService?: IMessageFlagPushRepository,
		/**
		 * The canonical flag record. Supplied, an inbound metadata change lands
		 * on the same record the outbound flip path reads, so a user's next
		 * flip is never dismissed as redundant.
		 */
		private messageFlagService?: IMessageFlagRepository,
		/**
		 * Writes the record a message becomes when it cannot be applied (issue
		 * #72). Omitted, the sync path keeps its old behaviour of holding the
		 * watermark below anything it could not save — correct, but the stall
		 * this issue exists to end.
		 */
		private quarantineService?: QuarantineService,
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

		const connection = this.connectionFactory.getConnection();
		const box = await connection.openBox(mailboxPath);
		const status = await connection.getMailboxStatus(mailboxPath);

		// Detection: the served UIDVALIDITY may have changed since it was last
		// stored, even though this mailbox was `normal` a moment ago. Trip the
		// cursor and pause — every stored watermark, the mod-sequence included,
		// is meaningless on the new axis, so nothing below may be acted on this
		// round (epic #1281 invariants 3 and 5). The rebuild that follows is
		// where the mod-sequence is reseeded from the new axis.
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
			return emptySyncResult();
		}

		const cursor = parseChangeCursor(mailbox.highestModseq);
		if (hasChangeCursor(cursor) && connection.supportsCondstore()) {
			return this.syncChangedSince({
				mailbox,
				accountId,
				accountConfigId,
				cursor,
				box,
				status,
				batchSize,
			});
		}

		// One read per round, not per message (issue #72). The list is small by
		// design — a growing one is a bug being reported, not a page to paginate.
		const quarantined = await this.quarantineService?.load(accountConfigId);

		const allUids = await connection.search(["ALL"]);
		const uids = selectUidsToSync(allUids, lastSyncUid, highWaterMarkUid);
		const unseenCount = status.unseen;
		const deletedCount = status.deletedCount;

		if (uids.length === 0) {
			// Nothing left to enumerate: the folder is fully covered on this
			// UIDVALIDITY axis, which is the one moment a mod-sequence watermark
			// can be seeded without hiding unsynced history behind it. From the
			// next round on, this mailbox takes the CHANGEDSINCE path above.
			await this.mailboxService.update(accountId, mailboxId, {
				lastMessageSyncAt: Date.now(),
				uidValidity: box.uidvalidity,
				messageCount: status.messages,
				highestModseq: status.highestModseq,
				unseenCount,
				deletedCount,
			});

			this.log.info(
				{
					mailboxId,
					mailboxPath,
					total: 0,
					messageCount: status.messages,
					unseenCount,
					highestModseq: status.highestModseq,
				},
				"No new messages to sync",
			);
			return emptySyncResult();
		}

		const totalBatches = Math.ceil(uids.length / batchSize);
		this.log.info(
			{ mailboxId, mailboxPath, total: uids.length, batches: totalBatches },
			"Starting message sync batch (newest first)",
		);

		// Process only the first batch
		const batchUids = uids.slice(0, batchSize);

		// A quarantined UID is not fetched again, but it stays in `batchUids` so
		// the watermark still advances over it. Filtering it out of the selection
		// instead would hold the watermark below a message that is already
		// durably resolved, which is the stall by another route.
		const context = this.quarantineContext(mailbox, accountConfigId, box);
		const fetchUids = batchUids.filter(
			(uid) => !quarantined?.has(mailboxId, box.uidvalidity, uid),
		);
		const messages =
			fetchUids.length > 0 ? await this.fetchMessageBatch(fetchUids) : [];

		// A UID the FETCH never returned a row for was not consumed by this
		// round, so no watermark may pass it. The connection layer drops rows
		// imapflow yields without a usable UID or INTERNALDATE (#408), and a
		// message can be expunged between the SEARCH and the FETCH; both used to
		// look identical to a successful save, and the watermark stepped over
		// them. Leaving them out of the consumed set costs nothing when the
		// message is genuinely gone — the next SEARCH will not list it — and
		// keeps a live one selectable.
		const returnedUids = new Set(messages.map((msg) => msg.uid));
		const consumedUids = batchUids.filter(
			(uid) =>
				returnedUids.has(uid) ||
				quarantined?.has(mailboxId, box.uidvalidity, uid),
		);
		const unreturnedCount = batchUids.length - consumedUids.length;
		if (unreturnedCount > 0) {
			this.log.warn(
				{ mailboxId, mailboxPath, unreturnedCount },
				"FETCH returned no row for some requested UIDs; holding the watermark below them",
			);
		}

		// Process messages in parallel with concurrency limit. `stopOnError` stays
		// at its default — but each message is saved through `trySaveMessage`,
		// which catches its own error and reports a `failed` outcome instead of
		// rejecting. So one bad message can no longer abort the whole batch (the
		// poison pill that previously froze the mailbox, #817).
		const outcomes = await pMap(
			messages,
			(msg) => this.trySaveMessage(context, msg),
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
		// independent of ownership. `selectUidsToSync` reselects work purely by UID
		// vs watermark (there is no per-UID processed set), so a foreign-owned UID
		// that did not advance the watermark would be re-fetched every cycle
		// forever. The same Message-ID legitimately appears in several of one
		// account's mailboxes (Gmail All Mail + INBOX/labels), so cross-mailbox
		// conflicts are routine; excluding them from body-sync is correct, stalling
		// forward sync is not. Failures are what a watermark may never pass —
		// see `advanceUidWatermarks`.
		const { highWaterMarkUid: newHighWaterMark, lastSyncUid: newLastSyncUid } =
			advanceUidWatermarks({
				batchUids: consumedUids,
				failedUids,
				lastSyncUid,
				highWaterMarkUid,
			});

		const remainingCount = uids.length - batchUids.length;
		const hasMore = remainingCount > 0;

		// The mod-sequence watermark is seeded only by a round that leaves no
		// enumeration work behind and lost no message to a failed save. Seeding
		// it earlier would switch the mailbox to CHANGEDSINCE while UIDs it has
		// never fetched still sit below the watermark, and those messages would
		// never be discovered. A UID the FETCH did not return counts the same
		// way: the round did not finish with it either.
		const enumerationComplete =
			!hasMore && failedUids.size === 0 && unreturnedCount === 0;

		await this.mailboxService.update(accountId, mailboxId, {
			lastSyncUid: newLastSyncUid,
			highWaterMarkUid: newHighWaterMark,
			lastMessageSyncAt: Date.now(),
			uidValidity: box.uidvalidity,
			messageCount: status.messages,
			...(enumerationComplete ? { highestModseq: status.highestModseq } : {}),
			unseenCount,
			deletedCount,
		});

		// Same stall condition as the CHANGEDSINCE round, on the UID axis: work
		// selected, nothing moved, and the next round will select exactly the
		// same work. No error surfaces on its own — every failure here is caught
		// and held back — so this is the only signal that the mailbox is stuck.
		const stalled =
			newHighWaterMark === highWaterMarkUid && newLastSyncUid === lastSyncUid;
		if (stalled) {
			this.log.error(
				{
					alert: "message_sync_cursor_stalled",
					mailboxId,
					mailboxPath,
					accountId,
					pendingUids: uids.length,
					failedUids: [...failedUids],
				},
				"Message sync watermarks did not advance while UIDs were pending; this mailbox stops syncing until they do",
			);
		}

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
			cursorStalled: stalled,
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
		// Read before the pass, never after: a message arriving while the
		// rebuild runs is absent from the snapshot below, and a HIGHESTMODSEQ
		// read afterwards would already sit above that arrival's mod-sequence —
		// seeding it would close the mailbox over a message it never stored.
		const status = await connection.getMailboxStatus(mailboxPath);
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
		const rebuildContext = this.quarantineContext(
			mailbox,
			accountConfigId,
			box,
		);
		const outcomes = await pMap(
			newMessages,
			(msg) => this.trySaveMessage(rebuildContext, msg),
			{ concurrency: MESSAGE_SAVE_CONCURRENCY },
		);
		const syncedMessages: SyncedMessage[] = outcomes.flatMap((o) =>
			o.kind === "saved" && o.result !== null && o.result.owned
				? [{ messageId: o.result.messageId, uid: o.result.uid }]
				: [],
		);

		const serverUids = serverSnapshots.map((s) => s.uid);

		// A new message whose save threw must stay selectable, so the forward
		// watermark stops below it and every UID above it is re-enumerated next
		// round. The mod-sequence seed is withheld entirely in that case: the
		// old value is meaningless on this axis (RFC 7162 requires discarding
		// it on a UIDVALIDITY change) and the new one would sit above the
		// message that failed, so the mailbox goes back to enumeration until a
		// clean round seeds it.
		const failedUids = new Set(
			outcomes.flatMap((o) => (o.kind === "failed" ? [o.uid] : [])),
		);
		const lowestFailure = failedUids.size
			? Math.min(...failedUids)
			: Number.POSITIVE_INFINITY;
		const coveredUids = serverUids.filter((uid) => uid < lowestFailure);

		await this.mailboxService.update(accountId, mailboxId, {
			cursorState: MailboxCursorState.normal,
			uidValidity: box.uidvalidity,
			highWaterMarkUid: coveredUids.length > 0 ? Math.max(...coveredUids) : 0,
			lastSyncUid: serverUids.length > 0 ? Math.min(...serverUids) : 0,
			highestModseq: failedUids.size === 0 ? status.highestModseq : "0",
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
			cursorStalled: false,
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
	 * One CHANGEDSINCE round (issue #20).
	 *
	 * A single `FETCH ... (CHANGEDSINCE <modseq>)` over the whole UID space
	 * returns both the messages that arrived and the messages whose metadata
	 * changed since the stored watermark, so a flag flipped on another client
	 * is picked up without enumerating the folder. Rows already present take
	 * the metadata path — the envelope, body structure and addresses are
	 * immutable, so re-writing them for a read-state change would be pure
	 * waste; everything else is a new message and takes the normal save
	 * pipeline.
	 *
	 * Expunges are invisible here (CONDSTORE without QRESYNC never reports
	 * them, RFC 7162 Section 3.1.2.1) — they remain the reconcile path's job.
	 */
	private async syncChangedSince(params: {
		mailbox: MailboxItem;
		accountId: string;
		accountConfigId: string;
		cursor: ChangeCursor;
		box: { uidvalidity: number };
		status: ImapMailboxStatus;
		batchSize: number;
	}): Promise<SyncMessagesResult> {
		const {
			mailbox,
			accountId,
			accountConfigId,
			cursor,
			box,
			status,
			batchSize,
		} = params;
		const mailboxId = mailbox.mailboxId;
		const mailboxPath = mailbox.fullPath;

		const connection = this.connectionFactory.getConnection();
		// Ask from the last COMPLETE mod-sequence, so a group left part-applied
		// by an earlier round is served again in full; its applied members are
		// then dropped by position, without a lookup.
		const changed = await connection.fetchMessagesChangedSince(cursor.modseq);

		const ordered = dropAppliedPrefix(orderByModseq(changed), cursor);
		const batch = ordered.slice(0, batchSize);

		// A quarantined UID stays in `batch`, so the cursor still advances over
		// it; only the work of re-applying it is skipped.
		const quarantined = await this.quarantineService?.load(accountConfigId);
		const context = this.quarantineContext(mailbox, accountConfigId, box);
		const applicable = batch.filter(
			(msg) => !quarantined?.has(mailboxId, box.uidvalidity, msg.uid),
		);

		const outcomes = await pMap(
			applicable,
			(msg) => this.tryApplyChange(context, msg),
			{ concurrency: MESSAGE_SAVE_CONCURRENCY },
		);

		const failedUids = new Set(
			outcomes.flatMap((o) => (o.kind === "failed" ? [o.uid] : [])),
		);
		if (failedUids.size > 0) {
			this.log.warn(
				{ mailboxId, mailboxPath, failedUids: [...failedUids] },
				"Some changes failed to apply; holding the sync cursor below them for retry",
			);
		}

		// Body sync only concerns messages this round created — a metadata
		// change has no new body to fetch.
		const syncedMessages: SyncedMessage[] = outcomes.flatMap((o) =>
			o.kind === "saved" && o.result !== null && o.result.owned
				? [{ messageId: o.result.messageId, uid: o.result.uid }]
				: [],
		);
		const syncedMessageIds = syncedMessages.map((m) => m.messageId);

		const { cursor: nextCursor, hasMore } = advanceChangeCursor({
			cursor,
			serverModseq: parseModseq(status.highestModseq),
			ordered,
			batch,
			failedUids,
		});
		const highestModseq = formatChangeCursor(nextCursor);

		// The UID watermark obeys the same clamp as the enumeration path even
		// though the cursor governs retries here: a mailbox that later falls
		// back to enumeration must not find a failed UID already behind its
		// forward watermark.
		const { highWaterMarkUid: newHighWaterMark } = advanceUidWatermarks({
			batchUids: batch.map((msg) => msg.uid),
			failedUids,
			lastSyncUid: mailbox.lastSyncUid || 0,
			highWaterMarkUid: mailbox.highWaterMarkUid || 0,
		});

		await this.mailboxService.update(accountId, mailboxId, {
			highestModseq,
			highWaterMarkUid: newHighWaterMark,
			lastMessageSyncAt: Date.now(),
			uidValidity: box.uidvalidity,
			messageCount: status.messages,
			unseenCount: status.unseen,
			deletedCount: status.deletedCount,
		});

		// A round that had work to do and moved nothing is stalled: the same
		// fetch will return the same set forever, and the set only grows as the
		// mailbox keeps changing. Nothing above this call fails, so nothing else
		// would ever notice — the queue message is acked either way.
		const stalled =
			ordered.length > 0 && highestModseq === mailbox.highestModseq;
		if (stalled) {
			this.log.error(
				{
					alert: "message_sync_cursor_stalled",
					mailboxId,
					mailboxPath,
					accountId,
					cursor: highestModseq,
					pendingChanges: ordered.length,
					failedUids: [...failedUids],
				},
				"Message sync cursor did not advance while changes were pending; this mailbox stops seeing changes until it does",
			);
		}

		this.log.info(
			{
				mailboxId,
				mailboxPath,
				changed: ordered.length,
				applied: batch.length,
				created: syncedMessageIds.length,
				fromCursor: formatChangeCursor(cursor),
				cursor: highestModseq,
				hasMore,
			},
			"CHANGEDSINCE round complete",
		);

		return {
			syncedCount: syncedMessageIds.length,
			syncedMessageIds,
			syncedMessages,
			hasMore,
			remainingCount: ordered.length - batch.length,
			cursorStalled: stalled,
		};
	}

	/**
	 * Apply one message from a CHANGEDSINCE result without ever rejecting —
	 * same contract as {@link trySaveMessage}, so a single unapplicable change
	 * holds the watermark back instead of failing the round.
	 */
	private async tryApplyChange(
		context: QuarantineContext,
		msg: ImapMessage,
	): Promise<BatchOutcome> {
		const { mailboxId, accountId, accountConfigId } = context;

		// Same reasoning as the enumeration path: a change carrying no ENVELOPE
		// names no message, so it is set aside rather than skipped in silence.
		if (!msg.envelope) {
			const recorded = await this.quarantineMissingEnvelope(context, msg);
			return recorded
				? { kind: "saved", uid: msg.uid, result: null }
				: { kind: "failed", uid: msg.uid };
		}

		return this.applyChange(mailboxId, accountId, accountConfigId, msg)
			.then((result): BatchOutcome => ({ kind: "saved", uid: msg.uid, result }))
			.catch((error): BatchOutcome => {
				this.log.warn(
					{
						mailboxId,
						uid: msg.uid,
						messageId: msg.envelope?.messageId,
						error: error instanceof Error ? error.message : String(error),
					},
					"Failed to apply message change; will retry on next sync",
				);
				return { kind: "failed", uid: msg.uid };
			});
	}

	private async applyChange(
		mailboxId: string,
		accountId: string,
		accountConfigId: string,
		msg: ImapMessage,
	): Promise<SaveMessageResult | null> {
		if (!msg.envelope) return null;

		const messageId = deriveMessageIdFromSource(accountId, {
			messageId: msg.envelope.messageId,
			uid: msg.uid,
			mailboxId,
			date: msg.envelope.date,
			subject: msg.envelope.subject,
			fromMailbox: msg.envelope.from?.[0]?.mailbox,
			fromHost: msg.envelope.from?.[0]?.host,
		});

		const existing = await this.threadMessageService.findByMessageId(
			accountConfigId,
			messageId,
		);
		if (!existing) {
			return this.saveMessage(mailboxId, accountId, accountConfigId, msg);
		}

		await this.applyServerFlags(existing, msg.flags);
		return null;
	}

	/**
	 * Bring a stored row's read and star state in line with the server's
	 * flags.
	 *
	 * A field with a pending outbound push is left alone: the user flipped it
	 * locally, IMAP has not been told yet, and the server's answer is
	 * therefore known-stale for that field. Writing it back would revert the
	 * flip in front of the user and then push the reverted value.
	 */
	private async applyServerFlags(
		existing: ThreadMessageItem,
		flags: string[],
	): Promise<void> {
		const isRead = flags.includes(MessageSystemFlag.Seen);
		const hasStars = flags.includes(MessageSystemFlag.Flagged);

		const updates: {
			isRead?: boolean;
			hasStars?: boolean;
			star?: (typeof StarColor)[keyof typeof StarColor];
		} = {};
		if (
			existing.isRead !== isRead &&
			!(await this.hasPendingPush(existing.messageId, MessageSystemFlag.Seen))
		) {
			updates.isRead = isRead;
		}
		if (
			existing.hasStars !== hasStars &&
			!(await this.hasPendingPush(
				existing.messageId,
				MessageSystemFlag.Flagged,
			))
		) {
			updates.hasStars = hasStars;
			// `hasStars` is the boolean of record and `star` its presentation
			// colour; the two may never disagree (#58). A star cleared upstream
			// loses its colour; one set upstream takes the standard colour unless
			// the row already carries a real one the user chose.
			if (!hasStars) {
				updates.star = StarColor.None;
			} else if (
				existing.star === undefined ||
				existing.star === StarColor.None
			) {
				updates.star = StarColor.Yellow;
			}
		}

		if (Object.keys(updates).length === 0) return;

		// MessageFlag is the canonical flag record — `FlagQueueService` reads it
		// to decide whether a user's flip is redundant, and the API answers
		// read/starred from it. Writing only the denormalized row would leave
		// the two disagreeing, and the next local flip would be dismissed as
		// already-in-state: a click that does nothing.
		//
		// Canonical record first, projection second — the same order the local
		// flip path uses. A crash between the two leaves the pair inconsistent
		// exactly as a crashed local flip would, and the round's watermark has
		// not moved, so the next round re-fetches the message and re-applies
		// both writes (each is idempotent).
		if (updates.isRead !== undefined) {
			await this.setMessageFlag(
				existing.messageId,
				MessageSystemFlag.Seen,
				updates.isRead,
			);
		}
		if (updates.hasStars !== undefined) {
			await this.setMessageFlag(
				existing.messageId,
				MessageSystemFlag.Flagged,
				updates.hasStars,
			);
		}

		await this.threadMessageService.update(
			existing.accountConfigId,
			existing.threadMessageId,
			updates,
			{
				// The CURRENT values of every sort-key attribute: ElectroDB uses
				// them for the conditional check on the existing row and to
				// recompute the new keys. Passing the new value here would fail
				// that check and silently drop the update (see FlagQueueService).
				composites: {
					sentDate: existing.sentDate,
					mailboxId: existing.mailboxId,
					isRead: existing.isRead,
					isDeleted: existing.isDeleted,
					hasStars: existing.hasStars,
					hasAttachment: existing.hasAttachment,
				},
			},
		);

		this.log.info(
			{
				messageId: existing.messageId,
				threadMessageId: existing.threadMessageId,
				...updates,
			},
			"Applied server flag state from CHANGEDSINCE",
		);
	}

	/**
	 * Set or clear one flag on the canonical record. Both repository calls are
	 * idempotent, so a re-applied change is a no-op rather than a conflict.
	 */
	private async setMessageFlag(
		messageId: string,
		flagName: string,
		present: boolean,
	): Promise<void> {
		if (!this.messageFlagService) return;
		if (present) {
			await this.messageFlagService.addFlag(messageId, flagName);
			return;
		}
		await this.messageFlagService.removeFlag(messageId, flagName);
	}

	private async hasPendingPush(
		messageId: string,
		flagName: string,
	): Promise<boolean> {
		if (!this.flagPushMarkerService) return false;
		const marker = await this.flagPushMarkerService.find(messageId, flagName);
		return marker !== null;
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
		context: QuarantineContext,
		msg: ImapMessage,
	): Promise<BatchOutcome> {
		const { mailboxId, accountId, accountConfigId } = context;

		// A message with no ENVELOPE has no sender, no date and no Message-ID, so
		// nothing here can key it — it was skipped, counted as saved, and the
		// watermark moved past it, which is the silent loss this feature exists to
		// end. The defect is the message's own and came off the FETCH result, so
		// it is quarantinable: record it, then let the watermark move past it for
		// the same reason as before, only now with something to show for it.
		if (!msg.envelope) {
			const recorded = await this.quarantineMissingEnvelope(context, msg);
			return recorded
				? { kind: "saved", uid: msg.uid, result: null }
				: { kind: "failed", uid: msg.uid };
		}

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

	/**
	 * The mailbox facts every quarantine record in this round shares.
	 *
	 * `attempts` is 1 because message sync has no per-message attempt state —
	 * its unit is the mailbox round, and the SQS receive count belongs to the
	 * round rather than to any message in it. That absence is why this feature
	 * is a quarantine record rather than a retry ceiling.
	 */
	private quarantineContext(
		mailbox: MailboxItem,
		accountConfigId: string,
		box: { uidvalidity: number },
	): QuarantineContext {
		return {
			accountId: mailbox.accountId,
			accountConfigId,
			mailboxId: mailbox.mailboxId,
			mailboxPath: mailbox.fullPath,
			uidValidity: box.uidvalidity,
			attempts: 1,
		};
	}

	/**
	 * Record a message that arrived without an ENVELOPE.
	 *
	 * Returns false when there is no quarantine writer, so the caller falls back
	 * to holding the watermark rather than dropping the message with no record —
	 * a stalled mailbox is recoverable, a silently skipped message is not.
	 *
	 * A failed write returns false for the same reason: the write is database
	 * work, so its failure is infrastructure and must not be mistaken for the
	 * message being resolved. The watermark stays put and the round retries.
	 */
	private async quarantineMissingEnvelope(
		context: QuarantineContext,
		msg: ImapMessage,
	): Promise<boolean> {
		if (!this.quarantineService) return false;

		return this.quarantineService
			.record(
				context,
				msg.uid,
				{
					stage: QuarantineFailureStage.MessageEnvelope,
					code: QuarantineFailureCode.MissingEnvelope,
					message: "FETCH returned the message with no ENVELOPE",
				},
				shapeFromImapMessage(msg),
			)
			.then(() => true)
			.catch((error: unknown) => {
				this.log.warn(
					{
						mailboxId: context.mailboxId,
						uid: msg.uid,
						error: error instanceof Error ? error.message : String(error),
					},
					"Could not record quarantine; holding the watermark below the message",
				);
				return false;
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

		const messageId = deriveMessageIdFromSource(accountId, {
			messageId: envelope.messageId,
			uid: msg.uid,
			mailboxId,
			date: envelope.date,
			subject: envelope.subject,
			fromMailbox: envelope.from?.[0]?.mailbox,
			fromHost: envelope.from?.[0]?.host,
		});
		const envelopeId = deriveEnvelopeId(messageId);
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

		// An unusable address is dropped and the message is written anyway, and
		// that stays deliberate under the quarantine rules (issue #72). What is
		// lost is one envelope address, not the message: it is stored, listed and
		// readable, and its body is untouched. Setting the whole message aside
		// over a malformed From would take readable mail out of the mailbox to
		// protect a display name.
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
			const normalizedCompound =
				`${displayName.toLowerCase()} ${normalizedEmail}`.trim();

			const addressId = deriveAddressId(accountConfigId, normalizedEmail);

			const envelopeAddressId = deriveEnvelopeAddressId(messageId, role, order);

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
		} else if (isValidMessageId(envelope.messageId)) {
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
		const threadId = deriveThreadId(accountId, rootMessageIdHeader);

		const isRead = flags.includes(MessageSystemFlag.Seen);

		// The server's \Flagged keyword is the star. Mail flagged in another
		// client must arrive starred, so carry it through on create rather than
		// defaulting every row to unstarred. Both comparisons go through the
		// generated members, which carry the wire spelling (reader#65) and are
		// the same values the flag-push markers are keyed by — one source of
		// truth for the wire flag and the record of it.
		const hasStars = flags.includes(MessageSystemFlag.Flagged);

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
				hasStars,
				star: hasStars ? StarColor.Yellow : StarColor.None,
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
