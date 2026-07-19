import { PassThrough, type Readable } from "node:stream";
import { inspect } from "node:util";
import type {
	IAddressRepository,
	IEnvelopeRepository,
	IMailboxSpecialUseRepository,
	IMessageRepository,
	IThreadMessageRepository,
	MessageItem,
	ThreadMessageItem,
	UpdateMessageInput,
} from "@remit/data-ports";
import { NotFoundError } from "@remit/data-ports/errors";
import { deriveAddressId } from "@remit/data-ports/id";
import { isBulkSender } from "@remit/data-ports/wellknown";
import {
	MailboxSpecialUse,
	MessageCategory,
	PlacementAction,
	PlacementConfidence,
	SenderTrust,
} from "@remit/domain-enums";
import {
	isStorageNotFoundError,
	type ParsedBody,
	type StorageService,
} from "@remit/storage-service";
import { type ParsedMail, simpleParser } from "mailparser";
import pMap from "p-map";
import { mapBodyPartsToContent } from "./body-part-mapper.js";
import type { FilterMessage } from "./filters/match.js";
import {
	type FilterConfig,
	type FilterDecision,
	FilterPipeline,
} from "./filters/pipeline.js";
import {
	classifyByHeaders,
	extractAuthenticity,
	extractAuthResult,
	extractHasListUnsubscribe,
	extractProviderSpam,
} from "./heuristics/classifyByHeaders.js";
import {
	classifyPlacement,
	type FolderPlacement,
} from "./heuristics/classifyPlacement.js";
import type { PlacementMoveService } from "./placement-move.js";
import { extractSnippetFromEmail } from "./snippet.js";
import { type IImapConnection, MailConnectionError } from "./types.js";

const BODY_PART_STORE_CONCURRENCY = 4;

type MessagePlacementVerdict = NonNullable<
	UpdateMessageInput["placementVerdict"]
>;

type ThreadMessageCategory = ThreadMessageItem["category"];

/**
 * Outcome of {@link BodySyncService.resolvePlacement}: the audit `verdict` to
 * persist on the Message (present whenever Remit decided to act, i.e. action
 * != leave), and the IMAP `move` to enqueue (present only for a confident,
 * actionable verdict). An unsure verdict carries a `verdict` but no `move`.
 */
interface PlacementOutcome {
	verdict?: MessagePlacementVerdict;
	move?: { destinationMailboxId: string; destinationPath: string };
}

/**
 * Whether the body-sync hot path defers per-part S3 objects. Each MIME leaf is
 * its own PutObject, so during bulk sync these per-part writes dominate S3 write
 * count and cost. With deferral ON a synced message writes only `body.eml` +
 * `parsed.json.gz` (2 writes); the per-part objects are materialized lazily on
 * the first `contentUrl` read via {@link BodySyncService.ensureBodyPartsStored}.
 *
 * Default ON (cost savings). Set `DEFER_BODY_PARTS=false`/`0`/`off` to restore
 * the original eager per-part writes — a safe, reversible escape hatch.
 */
export const isBodyPartDeferralEnabled = (): boolean => {
	const raw = process.env.DEFER_BODY_PARTS;
	if (raw === undefined) return true;
	const normalized = raw.trim().toLowerCase();
	return normalized !== "false" && normalized !== "0" && normalized !== "off";
};

/**
 * Sentinel object written under a message's parts prefix once lazy
 * materialization has stored EVERY leaf. The read path checks it first with a
 * single HEAD and early-returns, skipping the body.eml GET, the MIME re-parse,
 * and the per-leaf HEADs on every warm re-open.
 *
 * Deliberately an S3-only marker (no Message-row flag): a DDB write would
 * re-fire the redundant vector upsert that #607 removed. A leading dot keeps it
 * out of any real IMAP section path (those are dot-separated digits).
 */
const MATERIALIZED_SENTINEL_PART_PATH = ".materialized";

/**
 * A mid-stream socket drop during the ranged body fetch surfaces as a typed
 * `MailConnectionError` (the connection layer classifies imapflow's
 * `EConnectionClosed`/`NoConnection`). Detect by type/code, never by message
 * text — the underlying library strings vary.
 */
const isConnectionDrop = (error: unknown): boolean => {
	if (error instanceof MailConnectionError) {
		return error.kind === "network";
	}
	const code = (error as { code?: string }).code;
	return code === "EConnectionClosed" || code === "NoConnection";
};

export const extractPrimaryFromEmail = (parsed: ParsedMail): string | null => {
	const from = parsed.from;
	if (!from || !from.value || from.value.length === 0) return null;
	const address = from.value[0]?.address;
	if (!address) return null;
	return address.toLowerCase();
};

/**
 * Project a parsed message onto the fields a filter matches against (RFC 034) —
 * the literal-clause targets plus the text a semantic anchor embeds. Kept
 * separate from `ParsedMail` so {@link FilterPipeline} stays parser-agnostic.
 */
const toFilterMessage = (parsed: ParsedMail): FilterMessage => ({
	from: extractPrimaryFromEmail(parsed) ?? "",
	fromName: parsed.from?.value?.[0]?.name ?? "",
	subject: parsed.subject ?? "",
	text: parsed.text ?? "",
});

export const toParsedBody = (parsed: ParsedMail): ParsedBody => ({
	text: parsed.text ?? null,
	html: typeof parsed.html === "string" ? parsed.html : null,
	attachments: (parsed.attachments ?? []).map((a) => ({
		filename: a.filename ?? null,
		contentType: a.contentType,
		contentDisposition: a.contentDisposition ?? null,
		contentId: a.contentId ?? null,
		size: a.size,
	})),
});

export interface BodySyncLogger {
	info(obj: Record<string, unknown>, msg: string): void;
	debug?(obj: Record<string, unknown>, msg: string): void;
	warn?(obj: Record<string, unknown>, msg: string): void;
	error?(obj: Record<string, unknown>, msg: string): void;
}

const noopLogger: BodySyncLogger = {
	info: () => {},
};

export interface SyncBodiesResult {
	syncedCount: number;
	syncedMessageIds: string[];
	skippedCount: number;
	failedCount: number;
	failedMessageIds: string[];
}

export interface FetchBodyResult {
	text: string | null;
	html: string | null;
	storedAt: string;
}

export interface StoreBodyPartContentsResult {
	stored: number;
}

export type ConnectionGetter = () => Promise<IImapConnection>;

export interface PlacementConfig {
	mailboxSpecialUseService: IMailboxSpecialUseRepository;
	/**
	 * Local-first mover for a confident placement verdict (issue #1271). Same
	 * `moveMessage(accountConfigId, messageId, destinationMailboxId, accountId)`
	 * signature as the general-purpose `MessageMoveService` it replaced here,
	 * but backed by a pending-move marker + its own reconciler queue instead of
	 * the general MESSAGE_MOVE event (see `placement-move.ts`).
	 */
	placementMoveService: PlacementMoveService;
}

export class BodySyncService {
	private log: BodySyncLogger;
	private readonly filterPipeline?: FilterPipeline;

	constructor(
		private messageService: IMessageRepository,
		private storageService: StorageService,
		private threadMessageService: IThreadMessageRepository,
		private addressService: IAddressRepository,
		private envelopeService: IEnvelopeRepository,
		logger?: BodySyncLogger,
		private readonly placementConfig?: PlacementConfig,
		private readonly filterConfig?: FilterConfig,
	) {
		this.log = logger ?? noopLogger;
		this.filterPipeline = filterConfig
			? new FilterPipeline(filterConfig, this.log)
			: undefined;
	}

	/**
	 * Sync message bodies for a batch of messages.
	 *
	 * Fail-fast on connection errors: if the IMAP connection is lost,
	 * immediately stop processing and return all remaining messages as failed
	 * so they can be requeued for later retry.
	 *
	 * @param messageIds - The message IDs to sync bodies for
	 * @param accountId - The account ID (for storage path)
	 * @param accountConfigId - The account config ID (for thread updates)
	 * @param mailboxPath - The IMAP mailbox path
	 * @param getConnection - Function to get a (lazy) IMAP connection
	 * @param force - Bypass the "already stored" skip guard and re-fetch every
	 * message in this batch even though `bodyStorageKey` is already set. Set
	 * only by the read-miss re-arm cue (a `/content` read found the storage
	 * object missing despite the DB row saying otherwise); bulk metadata-sync
	 * never sets this, so it keeps skipping on `bodyStorageKey` with no
	 * existence check.
	 */
	async syncBodies(
		messageIds: string[],
		accountId: string,
		accountConfigId: string,
		mailboxPath: string,
		getConnection: ConnectionGetter,
		force = false,
	): Promise<SyncBodiesResult> {
		const syncedMessageIds: string[] = [];
		let skippedCount = 0;

		// Resolve every message up front so we can issue ONE ranged FETCH for the
		// whole batch (the desktop-client pattern) instead of a SELECT + download
		// per message. Messages whose body is already stored are skipped here and
		// never hit the wire — UNLESS `force` is set, in which case every message
		// is re-fetched regardless of `bodyStorageKey` (the read-miss cue already
		// confirmed the stored object is gone). `pending` maps each UID to its
		// messageId so we can match FETCH rows back and re-enqueue any UID the
		// server never returns.
		const pending = new Map<number, string>();
		// Messages that were skipped (body already stored) but whose backfill
		// classification failed. They are NOT in `pending` — nothing about them
		// needs fetching — so they are merged into failedMessageIds separately.
		const backfillFailedMessageIds: string[] = [];
		for (const messageId of messageIds) {
			const message = await this.messageService.get(messageId);
			if (message.bodyStorageKey && !force) {
				this.log.debug?.({ messageId }, "Body already stored, skipping");
				// The skip guard keys on the body, but classification is a separate
				// derived field written by the same pass. A message that got its body
				// before it got a classifier — or whose classifying pass failed after
				// the body landed — is skipped here forever and stays `uncategorized`
				// (issue #45). Classify it from the stored bytes: no IMAP, no
				// placement/filter side effects, and it skips cleanly once done.
				//
				// Contained per-message: one unreadable body object must not abort a
				// batch that has not fetched anything yet. The failure is loud and
				// the id is requeued, but the other messages still get their bodies.
				try {
					await this.backfillClassification(message, accountConfigId);
				} catch (error) {
					this.log.error?.(
						{
							messageId,
							storageKey: message.bodyStorageKey,
							errorName: (error as { name?: string }).name,
							errorCode: (error as { Code?: string }).Code,
							error: inspect(error),
						},
						"Classification backfill failed for an already-stored body; leaving for requeue",
					);
					backfillFailedMessageIds.push(messageId);
					continue;
				}
				skippedCount++;
				continue;
			}
			pending.set(message.uid, messageId);
		}

		if (pending.size === 0) {
			return this.buildResult(
				syncedMessageIds,
				skippedCount,
				backfillFailedMessageIds,
			);
		}

		const connection = await getConnection();
		// Single SELECT for the whole batch. openBox is idempotent, so a warm
		// connection already on this mailbox skips the SELECT entirely.
		await connection.openBox(mailboxPath);

		let connectionLost = false;
		try {
			for await (const { uid, source } of connection.fetchMessageBodies([
				...pending.keys(),
			])) {
				const messageId = pending.get(uid);
				if (!messageId) {
					// A UID we didn't ask for — drain the stream so the connection
					// stays usable, then ignore it.
					source.resume();
					continue;
				}
				try {
					await this.storeStreamedBody(
						messageId,
						accountId,
						accountConfigId,
						source,
					);
				} catch (error) {
					// A per-message store failure (e.g. the parsed-body S3 write) is a
					// real fault, but it must not silently mark the message synced —
					// that would leave parsedBody null and the message unindexed. Leave
					// the UID in `pending` so it lands in failedMessageIds and the SQS
					// batch requeues just this message. A dropped connection is handled
					// by the outer catch (fail-fast on the whole remaining batch).
					if (isConnectionDrop(error)) throw error;
					this.log.error?.(
						{
							messageId,
							errorName: (error as { name?: string }).name,
							error: (error as Error).message,
						},
						"Body store failed for message; leaving for requeue",
					);
					// Drain the stream so the connection stays usable for the next UID.
					source.resume();
					continue;
				}
				pending.delete(uid);
				syncedMessageIds.push(messageId);
			}
		} catch (error) {
			this.log.error?.(
				{ error: (error as Error).message },
				"Body fetch stream failed",
			);
			// Fail-fast: a dropped connection mid-stream leaves every not-yet-yielded
			// UID in `pending`; they fall through to failedMessageIds and re-enqueue.
			// Any other error is a real fault — let it crash.
			if (!isConnectionDrop(error)) {
				throw error;
			}
			connectionLost = true;
			this.log.info?.(
				{ remainingCount: pending.size },
				"Connection lost, aborting batch",
			);
		}

		// Anything still pending was never yielded (mid-stream drop or a UID the
		// server silently omitted) — re-enqueue it.
		const failedMessageIds = [...pending.values(), ...backfillFailedMessageIds];

		this.log.info(
			{
				synced: syncedMessageIds.length,
				skipped: skippedCount,
				failed: failedMessageIds.length,
				total: messageIds.length,
				aborted: connectionLost,
			},
			"Body sync complete",
		);

		return this.buildResult(syncedMessageIds, skippedCount, failedMessageIds);
	}

	private buildResult(
		syncedMessageIds: string[],
		skippedCount: number,
		failedMessageIds: string[],
	): SyncBodiesResult {
		return {
			syncedCount: syncedMessageIds.length,
			syncedMessageIds,
			skippedCount,
			failedCount: failedMessageIds.length,
			failedMessageIds,
		};
	}

	/**
	 * Stream one message body straight to storage while teeing the bytes into a
	 * buffer for the parse-dependent steps (snippet, classification, parsed-body
	 * cache, per-part objects). The S3 upload never sees a whole-body concat —
	 * the storage service streams it — but mailparser still needs the full bytes,
	 * so we collect them in parallel. Later issues move parsing off the hot path.
	 */
	private async storeStreamedBody(
		messageId: string,
		accountId: string,
		accountConfigId: string,
		source: Readable,
	): Promise<void> {
		const toStorage = new PassThrough();
		const chunks: Buffer[] = [];

		// Tee the source: bytes flow to storage as a stream (no whole-body concat
		// on the upload path) while we also collect them for the parse-dependent
		// steps below, which still need the full body for mailparser. The store
		// and the tee are awaited together so neither rejection is orphaned.
		const tee = new Promise<void>((resolve, reject) => {
			source.on("data", (chunk: Buffer) => {
				chunks.push(chunk);
				toStorage.write(chunk);
			});
			source.on("end", () => {
				toStorage.end();
				resolve();
			});
			source.on("error", (err) => {
				toStorage.destroy(err);
				reject(err);
			});
		});

		const [ref] = await Promise.all([
			this.storageService.storeMessageBodyStream({
				accountConfigId,
				accountId,
				messageId,
				content: toStorage,
			}),
			tee,
		]);

		const body = Buffer.concat(chunks);

		await this.applyPostStoreSteps(
			messageId,
			accountId,
			accountConfigId,
			body,
			{
				uri: ref.uri,
			},
		);
	}

	/**
	 * The steps every synced body must go through regardless of which path
	 * fetched it first — the sync path ({@link storeStreamedBody}) and the
	 * read-path backfill ({@link fetchAndGetBody}) both call this instead of
	 * duplicating (and drifting on) their own subset. Before issue #1271,
	 * `fetchAndGetBody` skipped classification/placement entirely — a message
	 * materialized by a read got different treatment than one synced in bulk.
	 *
	 * Order matters for two independent reasons, both load-bearing:
	 * 1. The parsed-body cache must be durable before `bodyStorageKey` (the
	 *    skip-guard signal) — see the comment on the write below.
	 * 2. A placement move — local mailboxId change, pending marker, IMAP-push
	 *    enqueue (`PlacementMoveService.moveMessage`, issue #1271) — must
	 *    complete, or fully fail, BEFORE `bodyStorageKey` is written. That
	 *    failure is never swallowed: if it throws, `bodyStorageKey` is not yet
	 *    durable, so a retry reprocesses the message from scratch (marker
	 *    included) instead of the skip-guard stranding a `movedByRemit` flag
	 *    with no marker behind it — the defect this issue fixes.
	 *
	 * Returns the parsed mail so callers that already need it (both do) don't
	 * pay for mailparser twice.
	 */
	private async applyPostStoreSteps(
		messageId: string,
		accountId: string,
		accountConfigId: string,
		body: Buffer,
		bodyRef: { uri: string },
	): Promise<ParsedMail> {
		// Snippet + thread update; reuses the parsed mail for the steps below.
		// This is a ThreadMessage write — a different entity — so it does NOT
		// trigger the Message-filtered stream bridge and stays separate.
		const parsed = await this.updateSnippets(messageId, accountConfigId, body);

		// Compute the header classification once. The derived fields are folded
		// into the single Message update below — they are NOT written here.
		const classification = this.classifyMessage(parsed);

		// Decide the placement move from the in-memory classification before the
		// write, so its `movedByRemit` flag and audit verdict join the same
		// UpdateItem. The verdict is recorded whenever Remit decided to act
		// (action != leave); the move is enqueued only for a confident,
		// actionable verdict.
		const resolved = await this.resolvePlacement(
			messageId,
			accountId,
			accountConfigId,
			parsed,
			classification,
		);

		// Index-time filter pass (RFC 034). Isolated the same way placement is —
		// FilterPipeline.evaluate swallows any read/decision failure and returns
		// no actions, so a schema-drifted filter query never fails the body store.
		// The DECISION is computed here; the applies below are unswallowed.
		const filterDecision = await this.evaluateFilters(
			accountConfigId,
			messageId,
			parsed,
		);

		// Store the parsed-body cache BEFORE persisting bodyStorageKey. The skip
		// guard in syncBodies treats a stored bodyStorageKey as "fully synced",
		// so if we wrote it first and the parsed-cache write then failed, the
		// requeued retry would skip the message — leaving parsedBody null and the
		// search-index upsert bodyless forever. A parsed-cache failure here throws
		// and propagates before bodyStorageKey is written, so the requeued message
		// genuinely re-attempts the parsed write and gets indexed.
		await this.storeParsedBodyCache(
			accountConfigId,
			accountId,
			messageId,
			parsed,
		);

		// Per-part S3 objects dominate S3 writes during bulk sync. When deferral
		// is enabled we skip them here; they are materialized lazily on the first
		// `contentUrl` read (see ensureBodyPartsStored), keeping bulk sync at 2
		// writes/message (body.eml + parsed.json.gz).
		if (!isBodyPartDeferralEnabled()) {
			await this.storeBodyPartContents(
				accountConfigId,
				accountId,
				messageId,
				parsed,
			);
		}

		// Local-first move (issue #1271): local mailboxId change + pending marker +
		// IMAP-push enqueue via PlacementMoveService, UNSWALLOWED — a throw here
		// propagates before bodyStorageKey is written (see the method doc above),
		// so a genuine SQS/DDB write failure requeues the message rather than being
		// absorbed. A matched filter's move is exclusive and outranks the
		// classifier's placement move (RFC 034 Decision 3.1) — an explicit user
		// rule wins the single mailbox a message occupies — so at most one move is
		// enqueued. A non-confident/leave verdict with no filter move is a no-op.
		if (filterDecision.move) {
			await this.filterConfig?.placementMoveService.moveMessage(
				accountConfigId,
				messageId,
				filterDecision.move.destinationMailboxId,
				accountId,
			);
		} else if (resolved.move) {
			await this.placementConfig?.placementMoveService.moveMessage(
				accountConfigId,
				messageId,
				resolved.move.destinationMailboxId,
				accountId,
			);
		}

		// Additive label actions (RFC 034 Decision 3.1): every matching filter's
		// label applies. The deterministic MessageLabel upsert is idempotent, so a
		// requeue after a later failure re-applies safely; UNSWALLOWED, so a DDB
		// write failure propagates before bodyStorageKey is written.
		for (const label of filterDecision.labels) {
			await this.filterConfig?.messageLabelService.apply({
				messageId,
				labelId: label.labelId,
				accountConfigId,
				appliedByFilterId: label.filterId,
			});
		}

		const moved = Boolean(resolved.move || filterDecision.move);

		// ONE Message UpdateItem per synced message: bodyStorageKey + every
		// classification/derived field + the move flag + the audit verdict. Each
		// extra Message mutation emits a DDB stream record that fans out to a
		// redundant S3-Vectors upsert, so we collapse them into a single write.
		// The flag is folded in only when a move WAS applied (by the classifier or
		// a filter); the verdict is folded in whenever Remit decided to act.
		// Written LAST so bodyStorageKey — the skip-guard signal — is only durable
		// once the parsed cache AND the move (when any) are.
		const update: UpdateMessageInput = {
			bodyStorageKey: bodyRef.uri,
			...classification,
			...(moved ? { movedByRemit: true } : {}),
			...(resolved.verdict ? { placementVerdict: resolved.verdict } : {}),
		};
		await this.messageService.update(messageId, update);
		this.log.info({ messageId, storageKey: bodyRef.uri }, "Body stored");

		// From-Address engagement counter (Address entity, not Message).
		await this.incrementInboundCount(
			messageId,
			accountConfigId,
			parsed,
			classification,
		);

		return parsed;
	}

	/**
	 * Fetch a single message body, store it, and return the parsed content.
	 *
	 * If the body is already stored, retrieves it from storage.
	 * Otherwise fetches from IMAP, stores it, and returns the parsed content.
	 *
	 * @param messageId - The message ID to fetch
	 * @param accountId - The account ID (for storage path)
	 * @param accountConfigId - The account config ID (for thread updates)
	 * @param mailboxPath - The IMAP mailbox path
	 * @param getConnection - Function to get a (lazy) IMAP connection
	 * @returns Parsed text and HTML content
	 */
	async fetchAndGetBody(
		messageId: string,
		accountId: string,
		accountConfigId: string,
		mailboxPath: string,
		getConnection: ConnectionGetter,
	): Promise<FetchBodyResult> {
		const message = await this.messageService.get(messageId);

		let body: Buffer;
		let needsStore = false;

		if (message.bodyStorageKey) {
			// Body already stored, try to retrieve from storage
			this.log.debug?.({ messageId }, "Retrieving body from storage");
			try {
				body = await this.storageService.retrieve(message.bodyStorageKey);
			} catch (err) {
				// Only a genuinely-missing object (NoSuchKey) is a safe IMAP
				// fallback — that's the cross-environment / never-stored case.
				// A permission/infra error (AccessDenied, throttle) must NOT be
				// masked as a missing object: let it crash so it's observable.
				if (!isStorageNotFoundError(err)) {
					this.log.error?.(
						{
							messageId,
							storageKey: message.bodyStorageKey,
							errorName: (err as { name?: string }).name,
							errorCode: (err as { Code?: string }).Code,
							error: inspect(err),
						},
						"Body storage retrieval failed (non-NoSuchKey); not falling back to IMAP",
					);
					throw err;
				}
				this.log.debug?.(
					{ messageId, error: (err as Error).message },
					"Body object missing (NoSuchKey), falling back to IMAP",
				);
				needsStore = true;
				body = await this.fetchFromImap(
					message.uid,
					mailboxPath,
					getConnection,
				);
			}
		} else {
			// Fetch from IMAP and store
			needsStore = true;
			body = await this.fetchFromImap(message.uid, mailboxPath, getConnection);
		}

		let parsed: ParsedMail;

		if (needsStore) {
			const ref = await this.storageService.storeMessageBody({
				accountConfigId,
				accountId,
				messageId,
				content: body,
			});

			// Same shared step the sync path (storeStreamedBody) runs — issue
			// #1271 unified the two body paths so classification/placement no
			// longer depends on which one fetched the body first.
			parsed = await this.applyPostStoreSteps(
				messageId,
				accountId,
				accountConfigId,
				body,
				{ uri: ref.uri },
			);
		} else {
			parsed = await simpleParser(body);
		}

		return {
			text: parsed.text ?? null,
			html: typeof parsed.html === "string" ? parsed.html : null,
			storedAt: message.bodyStorageKey ?? "newly-stored",
		};
	}

	private async fetchFromImap(
		uid: number,
		mailboxPath: string,
		getConnection: ConnectionGetter,
	): Promise<Buffer> {
		this.log.debug?.({ uid }, "Fetching body from IMAP");
		const connection = await getConnection();
		await connection.openBox(mailboxPath);
		return connection.fetchMessageBody(uid);
	}

	/**
	 * Classify a message whose body is already stored but which carries no
	 * decided category, reading the body from storage instead of IMAP.
	 *
	 * "No decided category" is `uncategorized` OR the field being absent: rows
	 * written before the column existed have no value at all, and treating that
	 * as already-classified would strand exactly the oldest mail this backfill
	 * exists to reach.
	 *
	 * Deliberately narrower than {@link applyPostStoreSteps}: it writes the
	 * derived classification fields and the denormalized ThreadMessage category,
	 * and nothing else. Placement moves and filter actions are index-time
	 * decisions that already ran (or were declined) when the body first landed;
	 * re-running them here would move mail the user has since filed by hand.
	 *
	 * A storage or write failure propagates to the caller, which contains it per
	 * message: the id lands in `failedMessageIds` and SQS requeues it, while the
	 * rest of the batch still gets its bodies. An unreadable body object is an
	 * infra fault, never absorbed — but it is also not a reason to abort a batch
	 * that has fetched nothing yet.
	 */
	private async backfillClassification(
		message: MessageItem,
		accountConfigId: string,
	): Promise<void> {
		if (!message.bodyStorageKey) return;
		if (
			message.category !== undefined &&
			message.category !== MessageCategory.uncategorized
		) {
			return;
		}

		const body = await this.storageService.retrieve(message.bodyStorageKey);
		const parsed = await simpleParser(body);
		const classification = this.classifyMessage(parsed);

		await this.messageService.update(message.messageId, classification);
		await this.denormalizeCategory(
			accountConfigId,
			message.messageId,
			classification.category,
		);

		this.log.info(
			{ messageId: message.messageId, category: classification.category },
			"Backfilled classification for an already-stored body",
		);
	}

	/**
	 * Pure header classification. Returns the subset of the Message update that
	 * carries the derived fields; the caller folds it into a single UpdateItem
	 * alongside `bodyStorageKey`. Optional signals are omitted when absent so we
	 * never overwrite an existing value with `undefined`.
	 */
	private classifyMessage(
		parsed: ParsedMail,
	): UpdateMessageInput & { category: ThreadMessageCategory } {
		const category = classifyByHeaders(parsed);
		const authenticity = extractAuthenticity(parsed);
		const authResult = extractAuthResult(parsed);
		const providerSpam = extractProviderSpam(parsed);
		const hasListUnsubscribe = extractHasListUnsubscribe(parsed);
		return {
			category,
			hasListUnsubscribe,
			...(authenticity !== null ? { authenticity } : {}),
			...(authResult !== null ? { authResult } : {}),
			...(providerSpam !== null ? { providerSpam } : {}),
		};
	}

	private async incrementInboundCount(
		messageId: string,
		accountConfigId: string,
		parsed: ParsedMail,
		classification: UpdateMessageInput,
	): Promise<void> {
		const fromEmail = extractPrimaryFromEmail(parsed);
		if (!fromEmail) {
			this.log.debug?.(
				{ messageId },
				"No From address; skipping inbound counter",
			);
			return;
		}

		const addressId = deriveAddressId(accountConfigId, fromEmail);
		const bulk = isBulkSender(
			classification.category,
			classification.hasListUnsubscribe ?? false,
		);
		await this.addressService.incrementInboundCount(
			accountConfigId,
			addressId,
			Date.now(),
			bulk,
		);
	}

	private async deriveSenderTrust(
		accountConfigId: string,
		fromEmail: string,
	): Promise<(typeof SenderTrust)[keyof typeof SenderTrust]> {
		try {
			const addressId = deriveAddressId(accountConfigId, fromEmail);
			const address = await this.addressService.getAddress(
				accountConfigId,
				addressId,
			);
			if (address.flags?.vip?.value === true) return SenderTrust.Vip;
			if (address.flags?.wellknown?.value === true)
				return SenderTrust.Wellknown;
		} catch (err) {
			// A genuinely-absent address means "unknown trust". Any other failure
			// (AccessDenied, throttle, infra) must NOT be silently downgraded to
			// Unknown — let it crash so the rescue decision isn't made on bad data.
			if (!(err instanceof NotFoundError)) throw err;
		}
		return SenderTrust.Unknown;
	}

	/**
	 * Evaluate the account's active filters against a synced message (RFC 034),
	 * BEFORE the single Message update — so a filter's `movedByRemit` flag joins
	 * that same UpdateItem. Returns the actions to apply (labels + at most one
	 * move); the caller applies them. A no-op returning no actions when no
	 * {@link FilterConfig} is wired.
	 *
	 * Isolation lives in {@link FilterPipeline.evaluate}: this read/decision phase
	 * never fails the body store (the #1246 placement precedent). The applies of
	 * the returned decision are the caller's and are deliberately unswallowed.
	 */
	private async evaluateFilters(
		accountConfigId: string,
		messageId: string,
		parsed: ParsedMail,
	): Promise<FilterDecision> {
		if (!this.filterPipeline) return { labels: [] };
		return this.filterPipeline.evaluate(
			accountConfigId,
			messageId,
			toFilterMessage(parsed),
		);
	}

	/**
	 * Resolve the placement decision for a message, BEFORE the single Message
	 * update — so both the `movedByRemit` flag and the audit verdict join that
	 * one UpdateItem instead of a second mutation that would fan out another
	 * redundant S3-Vectors upsert. Drives both directions (junk → inbox rescue,
	 * inbox → junk demote) off the pure {@link classifyPlacement} verdict.
	 *
	 * Returns a {@link PlacementOutcome}: a `verdict` to persist whenever Remit
	 * decided to act (action != leave), confident and unsure alike, so the
	 * distribution is queryable on the message; and a `move` to enqueue only for
	 * a confident verdict.
	 *
	 * Always logs a structured verdict line for confident, actionable verdicts so
	 * the real distribution is observable on a live mailbox.
	 *
	 * The verdict reads the just-computed classification rather than a persisted
	 * row, since those fields are not written until the single update. Placement
	 * is auxiliary to the body store — the primary artifact (body.eml) is already
	 * durable by the time this runs — so a failure here (e.g. a placement-repo
	 * query erroring on a schema-drifted DB) is caught and logged loudly with an
	 * alertable field instead of failing the surrounding message store. The empty
	 * {@link PlacementOutcome} means "no action", whether Remit genuinely decided
	 * to leave the message alone or placement itself failed; the alert log is
	 * what distinguishes the latter.
	 */
	private async resolvePlacement(
		messageId: string,
		accountId: string,
		accountConfigId: string,
		parsed: ParsedMail,
		classification: UpdateMessageInput,
	): Promise<PlacementOutcome> {
		if (!this.placementConfig) return {};
		return this.computePlacement(
			this.placementConfig,
			messageId,
			accountId,
			accountConfigId,
			parsed,
			classification,
		).catch((error: unknown) => {
			this.log.error?.(
				{
					alert: "body_sync_placement_failed",
					messageId,
					accountId,
					accountConfigId,
					errorName: (error as { name?: string })?.name,
					error: inspect(error),
				},
				"Placement resolution failed; body already stored, continuing without placement (best-effort, non-fatal)",
			);
			return {};
		});
	}

	private async computePlacement(
		placementConfig: PlacementConfig,
		messageId: string,
		accountId: string,
		accountConfigId: string,
		parsed: ParsedMail,
		classification: UpdateMessageInput,
	): Promise<PlacementOutcome> {
		const { mailboxSpecialUseService } = placementConfig;

		const message = await this.messageService.get(messageId);
		const junkMailbox = await mailboxSpecialUseService.findBySpecialUse(
			accountId,
			MailboxSpecialUse.Junk,
		);
		const inboxMailbox =
			await mailboxSpecialUseService.findInboxMailbox(accountId);

		const placement: FolderPlacement =
			junkMailbox && message.mailboxId === junkMailbox.mailboxId
				? "junk"
				: inboxMailbox && message.mailboxId === inboxMailbox.mailboxId
					? "inbox"
					: "other";

		const fromEmail = extractPrimaryFromEmail(parsed);
		const senderTrust = fromEmail
			? await this.deriveSenderTrust(accountConfigId, fromEmail)
			: SenderTrust.Unknown;

		// The verdict needs the classification signals (providerSpam,
		// authResult, authenticity) that this body-sync pass just derived; the
		// stored row does not carry them yet, so overlay them onto the message.
		const candidate = { ...message, ...classification };
		const verdict = classifyPlacement(candidate, placement, senderTrust);

		// A `leave` verdict carries no audit record and no move.
		if (verdict.action === "leave") {
			return {};
		}

		// Audit verdict — recorded for every actionable verdict (both
		// confidences), so the distribution is queryable on the message.
		// Independent of whether a move is enqueued.
		const audit: MessagePlacementVerdict = {
			action:
				verdict.action === "move-to-inbox"
					? PlacementAction.MoveToInbox
					: PlacementAction.MoveToJunk,
			confidence:
				verdict.confidence === "confident"
					? PlacementConfidence.Confident
					: PlacementConfidence.Unsure,
			fromPlacement: placement,
			reasons: verdict.reasons,
			dryRun: false,
			decidedAt: Date.now(),
		};

		// Only a confident verdict moves mail. An unsure verdict is recorded
		// but never enqueues a move.
		if (verdict.confidence !== "confident") {
			return { verdict: audit };
		}

		const target =
			verdict.action === "move-to-inbox" ? inboxMailbox : junkMailbox;
		if (!target) return { verdict: audit };

		// Structured verdict line — emitted for confident, actionable verdicts
		// so the real verdict distribution is observable on a live mailbox.
		this.log.info(
			{
				messageId,
				accountId,
				placement,
				action: verdict.action,
				confidence: verdict.confidence,
				reasons: verdict.reasons,
				destinationMailboxId: target.mailboxId,
			},
			"Placement verdict",
		);

		return {
			verdict: audit,
			move: {
				destinationMailboxId: target.mailboxId,
				destinationPath: target.fullPath,
			},
		};
	}

	// The old `enqueuePlacementMove` (best-effort, catch-and-log) lived here.
	// Issue #1271: it ran AFTER `bodyStorageKey` was already durable, so a
	// failure was swallowed to avoid stranding the message behind the
	// body-sync skip guard — but that meant `movedByRemit` could be true with
	// no record the move ever reached IMAP. Replaced by the unswallowed call
	// inside `applyPostStoreSteps`, sequenced BEFORE `bodyStorageKey` is
	// written, backed by `PlacementMoveService`'s pending-move marker.

	/**
	 * Persist one S3 object per non-multipart leaf so the SPA can resolve
	 * `BodyPartResponse.contentUrl` (#298). Keys follow the layout
	 * `accounts/{accountConfigId}/{accountId}/messages/{messageId}/parts/{partPath}`
	 * so they line up with the URL shape `derive/contentUrl.ts` emits.
	 *
	 * The mapper is total (#395 PR B): every leaf gets a `BodyPartContentPair`,
	 * possibly with a zero-byte content for leaves that have no source bytes
	 * (genuinely empty parts, or pathological inputs the positional fallback
	 * couldn't pair). No try/catch is needed; the only failure surface here is
	 * an S3 write itself, which `pMap` surfaces directly.
	 *
	 * If `listBodyParts` returns an empty list (e.g. a legacy message synced
	 * before #133 populated BodyPart rows), this is a no-op.
	 */
	private async storeBodyPartContents(
		accountConfigId: string,
		accountId: string,
		messageId: string,
		parsed: ParsedMail,
		options?: { skipExisting?: boolean },
	): Promise<StoreBodyPartContentsResult> {
		const bodyParts = await this.envelopeService.listBodyParts(messageId);
		if (bodyParts.length === 0) {
			this.log.debug?.(
				{ messageId },
				"No BodyPart rows; skipping per-part storage",
			);
			return { stored: 0 };
		}

		const log = this.log;
		const pairs = mapBodyPartsToContent(bodyParts, parsed, {
			messageId,
			logger:
				log.warn || log.debug
					? {
							warn: (obj, msg) => {
								log.warn?.(obj, msg);
							},
							debug: (obj, msg) => {
								log.debug?.(obj, msg);
							},
						}
					: undefined,
		});

		if (pairs.length === 0) {
			return { stored: 0 };
		}

		const bodyPartIdByPath = new Map(
			bodyParts.map((bp) => [bp.partPath, bp.bodyPartId]),
		);

		let stored = 0;
		const textContents: { bodyPartId: string; content: string }[] = [];
		await pMap(
			pairs,
			async (entry) => {
				if (
					options?.skipExisting &&
					(await this.storageService.bodyPartExists(
						accountConfigId,
						accountId,
						messageId,
						entry.partPath,
					))
				) {
					return;
				}
				await this.storageService.storeBodyPart({
					accountConfigId,
					accountId,
					messageId,
					partPath: entry.partPath,
					content: entry.content,
					contentType: entry.contentType,
				});
				stored++;

				if (
					entry.contentType.toLowerCase().startsWith("text/") &&
					entry.content.length > 0
				) {
					const bodyPartId = bodyPartIdByPath.get(entry.partPath);
					if (bodyPartId) {
						textContents.push({
							bodyPartId,
							content: entry.content.toString("utf8"),
						});
					}
				}
			},
			{ concurrency: BODY_PART_STORE_CONCURRENCY },
		);

		if (textContents.length > 0) {
			await this.envelopeService.upsertBodyPartContents(
				messageId,
				textContents,
			);
		}

		this.log.info(
			{ messageId, partCount: pairs.length, stored },
			"Body parts stored",
		);

		return { stored };
	}

	/**
	 * Lazily materialize the per-part S3 objects for an already-synced message
	 * whose parts were deferred during bulk sync (DEFER_BODY_PARTS).
	 *
	 * Called from the read path (the API `describeMessage` handler) before the
	 * SPA fetches any `contentUrl`: the part bytes are served directly from S3 by
	 * CloudFront with no Lambda in the request path, so a missing object would
	 * surface to the SPA as a hard "body-missing" failure. Generating the parts
	 * here — re-parsing the stored `body.eml` with the same `mapBodyPartsToContent`
	 * logic body-sync uses — guarantees every `contentUrl` resolves, while bulk
	 * sync stays at 2 writes/message.
	 *
	 * Idempotent: skips any leaf already on S3, so repeat reads cost only HEAD
	 * checks, and a re-read after a partial failure fills the gaps. Requires the
	 * message body to be stored (`bodyStorageKey`); callers gate on that.
	 *
	 * Warm-open fast path: a single HEAD on the `.materialized` sentinel
	 * short-circuits the whole pass — no body.eml GET, no MIME re-parse, no
	 * per-leaf HEADs. The sentinel is written only after every leaf is confirmed
	 * stored, so its presence guarantees all `contentUrl`s resolve.
	 */
	async ensureBodyPartsStored(
		accountConfigId: string,
		accountId: string,
		messageId: string,
		bodyStorageKey: string,
	): Promise<StoreBodyPartContentsResult> {
		if (
			await this.storageService.bodyPartExists(
				accountConfigId,
				accountId,
				messageId,
				MATERIALIZED_SENTINEL_PART_PATH,
			)
		) {
			this.log.debug?.(
				{ messageId },
				"Body parts already materialized (sentinel hit); skipping",
			);
			return { stored: 0 };
		}

		const body = await this.storageService.retrieve(bodyStorageKey);
		const parsed = await simpleParser(body);
		const result = await this.storeBodyPartContents(
			accountConfigId,
			accountId,
			messageId,
			parsed,
			{ skipExisting: true },
		);

		// Reaching here means storeBodyPartContents resolved — `pMap` rejects on
		// any single failed write, so every leaf is now durably on S3. Drop the
		// sentinel so subsequent opens take the HEAD-only fast path above.
		await this.storageService.storeBodyPart({
			accountConfigId,
			accountId,
			messageId,
			partPath: MATERIALIZED_SENTINEL_PART_PATH,
			content: Buffer.alloc(0),
		});

		return result;
	}

	/**
	 * Persist the pre-parsed body cache. A failure here MUST fail the
	 * surrounding body-sync: the parsed-body object is what the search-index
	 * pipeline reads, so swallowing a write failure leaves the message marked
	 * synced while `parsedBody` is null and it never gets indexed — a silent
	 * search gap. Propagate so the message lands in failedMessageIds and the
	 * SQS batch requeues it.
	 */
	private async storeParsedBodyCache(
		accountConfigId: string,
		accountId: string,
		messageId: string,
		parsed: ParsedMail,
	): Promise<void> {
		const parsedBody = toParsedBody(parsed);
		try {
			await this.storageService.storeParsedBody({
				accountConfigId,
				accountId,
				messageId,
				parsed: parsedBody,
			});
			this.log.debug?.({ messageId }, "Parsed body cache stored");
		} catch (err: unknown) {
			this.log.error?.(
				{
					messageId,
					errorName: (err as { name?: string }).name,
					errorCode: (err as { Code?: string }).Code,
					error: inspect(err),
				},
				"Failed to store parsed body cache; failing sync to requeue",
			);
			throw err;
		}
	}

	/**
	 * Extract snippet and header category from the body and denormalize both
	 * onto the ThreadMessage. `category` mirrors the Message: created as
	 * `uncategorized` at metadata-sync and set to the classified value here, so
	 * the list/search read path carries it without a per-row Message fetch.
	 * Returns the parsed mail so callers can reuse it (e.g., to write the
	 * parsed-body cache) without paying for mailparser twice.
	 */
	private async updateSnippets(
		messageId: string,
		accountConfigId: string,
		body: Buffer,
	): Promise<ParsedMail> {
		// Parse the email body
		const parsed = await simpleParser(body);

		// Extract snippet from text or HTML content
		const snippet = extractSnippetFromEmail(
			parsed.text,
			typeof parsed.html === "string" ? parsed.html : undefined,
			256,
		);

		const category = classifyByHeaders(parsed);

		await this.denormalizeCategory(
			accountConfigId,
			messageId,
			category,
			snippet,
		);

		this.log.debug?.(
			{ messageId, category, snippetLength: snippet?.length ?? 0 },
			"ThreadMessage snippet + category updated",
		);

		return parsed;
	}

	/**
	 * Write the denormalized `category` (and optionally the snippet) onto the
	 * message's ThreadMessage row — the copy the list/search read path serves
	 * without a per-row Message fetch.
	 *
	 * The ThreadMessage is looked up by messageId (GSI), so it does not depend
	 * on the RFC822 Message-ID header — a headerless message still gets
	 * denormalized, matching the unconditional Message.category write. The full
	 * composite set is passed so that a future key-attribute addition touching
	 * the lsi3/lsi4/lsi5/gsi2 sort keys keeps the index rows consistent.
	 */
	private async denormalizeCategory(
		accountConfigId: string,
		messageId: string,
		category: ThreadMessageCategory,
		snippet?: string,
	): Promise<void> {
		const threadMessage = await this.threadMessageService.getByMessageId(
			accountConfigId,
			messageId,
		);

		await this.threadMessageService.update(
			accountConfigId,
			threadMessage.threadMessageId,
			{ category, ...(snippet ? { snippet } : {}) },
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
	}
}
