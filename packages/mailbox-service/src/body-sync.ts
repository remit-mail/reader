import { inspect } from "node:util";
import {
	provisionDefaultCalendar,
	recordCalendarReply,
	recordCalendarSuggestion,
} from "@remit/calendar-service";
import {
	type BodyPartItem,
	type ClassifierScoreItem,
	type FilterItem,
	filterRuleTestsClassification,
	type IAccountRepository,
	type IAddressRepository,
	type ICalendarStore,
	type ICalendarSuggestionRepository,
	type IEnvelopeRepository,
	type IFilterRepository,
	type IMailboxSpecialUseRepository,
	type IMessageRepository,
	type IThreadMessageRepository,
	isSenderMuted,
	type MailboxItem,
	type MessageItem,
	readResolvedSpamSettings,
	type SpamSettingsItem,
	type UpdateMessageInput,
} from "@remit/data-ports";
import {
	MessageGoneFromServerError,
	MessagePlacementUnsettledError,
	NotFoundError,
} from "@remit/data-ports/errors";
import { deriveAddressId, deriveBodyPartId } from "@remit/data-ports/id";
import { isEncapsulatedMessage } from "@remit/data-ports/message-parts";
import { isBulkSender } from "@remit/data-ports/wellknown";
import {
	FilterState,
	QuarantineFailureStage,
	SyncWarningStage,
} from "@remit/domain-enums";
import {
	isStorageNotFoundError,
	MATERIALIZED_SENTINEL_PART_PATH,
	MATERIALIZED_SENTINEL_V2_PART_PATH,
	type ParsedBody,
	type StorageService,
} from "@remit/storage-service";
import { Semaphore } from "async-mutex";
import type { ParsedMail } from "mailparser";
import pMap from "p-map";
import { recordArrival, spamArrivalOf } from "./arrival-decision.js";
import { BodyParseError, parseMessageBody } from "./body-parse.js";
import {
	mapMessagePartsToContent,
	parsePartSource,
} from "./body-part-mapper.js";
import { calendarParts } from "./calendar-parts.js";
import { consultClassifier } from "./classifier/classifier-consult.js";
import {
	CLASSIFIER_OFF,
	type ClassifierConfig,
	type ClassifierGate,
	readClassifierGate,
} from "./classifier/classifier-gate.js";
import type { ClassifierVerdict } from "./classifier/classifier-precedence.js";
import {
	classifyParsedMessage,
	extractPrimaryFromEmail,
} from "./classify-message.js";
import { extractListId } from "./filters/list-id.js";
import {
	type FilterConfig,
	type FilterDecision,
	FilterPipeline,
	filtersForArrival,
	type PreparedFilters,
} from "./filters/pipeline.js";
import type { FilterMessage } from "./filters/rule.js";
import type { FlagQueueService } from "./flag-queue.js";
import {
	type FolderRoleMailboxes,
	resolveFolderRoleMailboxes,
} from "./folder-placement.js";
import type { FolderPlacement } from "./heuristics/classifyPlacement.js";
import { denormalizeMessageCategory } from "./message-category.js";
import { isMessageGoneFromOpenMailbox } from "./message-presence.js";
import type { PlacementMoveService } from "./placement-move.js";
import { isPlacementUnsettled, uidMailboxIdOf } from "./placement-settled.js";
import { type QuarantineService, shapeFromMessageData } from "./quarantine.js";
import {
	readSenderPlacement,
	type SenderPlacement,
} from "./sender-placement.js";
import { extractSearchText, extractSnippetFromEmail } from "./snippet.js";
import {
	decideSpamVerdict,
	type SpamConfig,
	type SpamPlacement,
	spamPlacementOf,
} from "./spam/index.js";
import type { SyncWarningService } from "./sync-warning.js";
import { type IImapConnection, MailConnectionError } from "./types.js";

const BODY_PART_STORE_CONCURRENCY = 4;

type MessageFilterMove = NonNullable<UpdateMessageInput["filterMove"]>;

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

/**
 * Project a parsed message onto the fields a filter matches against (RFC 034) —
 * the literal-clause targets. Kept
 * separate from `ParsedMail` so {@link FilterPipeline} stays parser-agnostic.
 */
const toFilterMessage = (
	parsed: ParsedMail,
	classifierScores: readonly ClassifierScoreItem[],
): FilterMessage => ({
	from: extractPrimaryFromEmail(parsed) ?? "",
	fromName: parsed.from?.value?.[0]?.name ?? "",
	subject: parsed.subject ?? "",
	text: parsed.text ?? "",
	listId: extractListId(parsed),
	classifierScores,
});

const SNIPPET_LENGTH = 256;

/**
 * The snippet the list row shows, from whichever body part carries text.
 * Exported for the classification backfill (issue #1197), which denormalizes
 * the same fields the body-store path does, from the same bytes.
 */
export const extractSnippet = (parsed: ParsedMail): string =>
	extractSnippetFromEmail(
		parsed.text,
		typeof parsed.html === "string" ? parsed.html : undefined,
		SNIPPET_LENGTH,
	);

/**
 * Issue #499: whether a completed body-sync pass has already stored this
 * message's body. `bodyStorageKey` is written last, once every derivation of
 * that pass has run, so its presence means that pass finished.
 *
 * Key presence, and nothing more. What the classifier decided is
 * `Message.category`; whether it ran at all is `Message.classificationState`.
 * Neither is inferred from here — the field this reads is the storage fact.
 *
 * The re-fetch paths that re-enter with the key already set (`syncBodies(...,
 * force: true)` and `fetchAndGetBody`'s `NoSuchKey` fallback) are re-stores
 * that skip the derivations entirely (issue #1011), so this guard is what
 * keeps a first store that lands on an already-stored row from re-deciding
 * anything.
 */
const hasStoredBody = (bodyStorageKey: string | undefined): boolean =>
	Boolean(bodyStorageKey);

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

export interface SyncBodiesOptions {
	force: boolean;
	concurrency: number;
	bytesInFlight: number;
}

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

export interface BodySyncFolder
	extends Pick<MailboxItem, "initialSyncCompletedAt" | "createdAt"> {
	mailboxId: string;
	fullPath: string;
	placement: FolderPlacement;
}

export interface BodySyncRoundFolder extends BodySyncFolder {
	uidValidity: number;
}

export interface PlacementConfig {
	mailboxSpecialUseService: IMailboxSpecialUseRepository;
	placementMoveService: PlacementMoveService;
}

/**
 * What body sync needs to set a message aside (issue #72). The mailbox facts
 * are supplied by the caller because they are properties of the round, not of
 * any one message.
 */
export interface QuarantineConfig {
	quarantineService: QuarantineService;
	mailboxId: string;
	/**
	 * The mailbox's stored UIDVALIDITY. Taken from the mailbox row rather than
	 * from the open box because a round whose two disagree is paused by the
	 * cursor guard before it reaches any UID.
	 */
	uidValidity: number;
	/** Redeliveries of this batch so far, so the record says how hard we tried. */
	attempts: number;
}

/**
 * What body sync needs to auto-mark-read a message from an unsubscribed
 * sender (issue #302, RFC 039 Decision 3). Reuses the same
 * `FlagQueueService.markAsRead` a manual mark-as-read already goes through —
 * local `\Seen` + `ThreadMessage.isRead` + a durable pending IMAP flag-push
 * marker — so this fires the same round-trip, not a second primitive.
 */
export interface UnsubscribeConfig {
	flagQueueService: FlagQueueService;
}

/**
 * What body sync needs to offer a mail's invitation as a card (issue #1033).
 *
 * The calendar store is here to provision the account's default collection on
 * first use, through the one function every other caller provisions with. That
 * is not bookkeeping: an invitation whose DTSTART names no zone is RFC 5545
 * floating time, and reading it anywhere but where the user's calendar lives
 * shows the meeting at the wrong hour. Without a collection there is no zone
 * to read it in, and every such event silently lands in UTC.
 *
 * `filterService` is read to honour `dismiss{muteSender:true}`: a sender the
 * user muted gets no card at all.
 */
export interface CalendarSuggestionConfig {
	calendarSuggestionService: ICalendarSuggestionRepository;
	calendarStore: ICalendarStore;
	filterService: Pick<IFilterRepository, "listByAccountAndState">;
	/** The account config's addresses: a guest's REPLY lands only on an event the reader organizes. */
	accountService: Pick<IAccountRepository, "listAllByAccountConfig">;
}

/** Where a stored body's message sits and when the server received it. */
interface Arrival {
	placement: FolderPlacement;
	internalDate: number;
	folderSynced: boolean;
	folderCreatedAt: number;
}

const folderSynced = (folder: BodySyncFolder): boolean =>
	(folder.initialSyncCompletedAt ?? 0) > 0;

const internalDateOf = (
	internalDates: ReadonlyMap<string, number>,
	messageId: string,
): number => {
	const internalDate = internalDates.get(messageId);
	if (internalDate === undefined) {
		throw new Error(`${messageId} was fetched but never read from the batch`);
	}
	return internalDate;
};

interface ClassifierDecision {
	verdict: ClassifierVerdict;
	scores: ClassifierScoreItem[];
}

const NO_SPAM_PLACEMENT: SpamPlacement = { action: "None" };

const NO_CLASSIFIER_DECISION: ClassifierDecision = {
	verdict: { kind: "None" },
	scores: [],
};

interface BatchLookups {
	roleMailboxes: () => Promise<FolderRoleMailboxes>;
	activeFilters: () => Promise<FilterItem[]>;
	usableFilters: () => Promise<PreparedFilters>;
	classifierGate: () => Promise<ClassifierGate>;
	ownAddresses: () => Promise<string[]>;
	spamSettings: () => Promise<SpamSettingsItem>;
}

// A failed load is forgotten, so the next message retries it rather than the
// rest of the batch inheriting the failure.
const once = <T>(load: () => Promise<T>): (() => Promise<T>) => {
	let loaded: Promise<T> | undefined;
	return () => {
		if (loaded) return loaded;
		const attempt = load();
		loaded = attempt;
		attempt.then(undefined, () => {
			if (loaded === attempt) loaded = undefined;
		});
		return attempt;
	};
};

type StoreOutcome =
	| { kind: "Stored" }
	| { kind: "Quarantined" }
	| { kind: "Failed"; error: unknown };

export class BodySyncService {
	private log: BodySyncLogger;
	private readonly filterPipeline?: FilterPipeline;

	constructor(
		private messageService: IMessageRepository,
		private storageService: StorageService,
		private threadMessageService: IThreadMessageRepository,
		private addressService: IAddressRepository,
		private envelopeService: IEnvelopeRepository,
		private readonly syncWarningService: SyncWarningService,
		private readonly spamConfig: SpamConfig,
		logger?: BodySyncLogger,
		private readonly placementConfig?: PlacementConfig,
		private readonly filterConfig?: FilterConfig,
		private readonly quarantineConfig?: QuarantineConfig,
		private readonly unsubscribeConfig?: UnsubscribeConfig,
		private readonly calendarConfig?: CalendarSuggestionConfig,
		private readonly classifierConfig?: ClassifierConfig,
	) {
		this.log = logger ?? noopLogger;
		this.filterPipeline = filterConfig
			? new FilterPipeline(filterConfig, this.log)
			: undefined;
	}

	async syncBodies(
		messageIds: string[],
		accountId: string,
		accountConfigId: string,
		folder: BodySyncRoundFolder,
		getConnection: ConnectionGetter,
		{ force, concurrency, bytesInFlight }: SyncBodiesOptions,
	): Promise<SyncBodiesResult> {
		let skippedCount = 0;
		const location = {
			accountId,
			accountConfigId,
			mailboxPath: folder.fullPath,
		};

		// Resolve every message up front so we can issue ONE ranged FETCH for the
		// whole batch (the desktop-client pattern) instead of a SELECT + download
		// per message. Messages whose body is already stored are skipped here and
		// never hit the wire — UNLESS `force` is set, in which case every message
		// is re-fetched regardless of `bodyStorageKey` (the read-miss cue already
		// confirmed the stored object is gone). `pending` maps each UID to its
		// messageId so we can match FETCH rows back and re-enqueue any UID the
		// server never returns.
		const pending = new Map<number, string>();
		// Message IDs in this batch whose row already carried `bodyStorageKey`
		// when `force` re-added them to `pending`: a forced re-fetch of an
		// already-stored body is a re-store (issue #1011) — bytes only, no
		// decision re-run. A message with no stored body inside a forced batch
		// is still a first store and takes the full decision pass.
		const reStoredMessageIds = new Set<string>();
		const internalDates = new Map<string, number>();

		// One read per round, not per message (issue #72). The list is small by
		// design and almost always empty, so a lookup per message would put a
		// query on the hot path for a state that is nearly never set.
		const quarantined =
			await this.quarantineConfig?.quarantineService.load(accountConfigId);

		const rows = new Map(
			(await this.messageService.get(messageIds)).map((row) => [
				row.messageId,
				row,
			]),
		);

		for (const messageId of messageIds) {
			const message = rows.get(messageId);

			// A row deleted since the batch was cut, or moved out of this folder
			// for good, has no uid here; its new uid would fetch another message.
			if (!message || uidMailboxIdOf(message) !== folder.mailboxId) {
				skippedCount++;
				continue;
			}

			// A quarantined message has no stored body, so nothing else here would
			// stop it being fetched and re-parsed on every redelivery, forever.
			if (
				this.quarantineConfig &&
				quarantined?.has(
					this.quarantineConfig.mailboxId,
					this.quarantineConfig.uidValidity,
					message.uid,
				)
			) {
				this.log.debug?.(
					{ messageId, uid: message.uid },
					"Message is quarantined, skipping",
				);
				skippedCount++;
				continue;
			}

			// The body is stored, so there is nothing to fetch (issue #331). This
			// used to re-read those bytes from storage to re-derive a category,
			// keyed on `category === uncategorized` — which is also the classifier's
			// own "nothing to say", so a message it declined cost one storage read
			// and two writes on every pass, forever, for the same answer. What the
			// classifier did is now recorded as `classificationState`, so a sync
			// pass never has to guess it from the row, and the cohort it has not
			// reached is selectable by a backfill instead of re-derived here.
			if (hasStoredBody(message.bodyStorageKey) && !force) {
				this.log.debug?.({ messageId }, "Body already stored, skipping");
				skippedCount++;
				continue;
			}
			if (message.bodyStorageKey) reStoredMessageIds.add(messageId);
			pending.set(message.uid, messageId);
			internalDates.set(messageId, message.internalDate);
		}

		if (pending.size === 0) {
			return this.buildResult([], skippedCount, []);
		}

		const connection = await getConnection();
		// Single SELECT for the whole batch. openBox is idempotent, so a warm
		// connection already on this mailbox skips the SELECT entirely.
		await connection.openBox(folder.fullPath);

		const lookups = this.batchLookups(accountConfigId, accountId);
		const log = this.log;
		const stream: {
			lost: boolean;
			fault: { error: unknown } | null;
			failed: boolean;
		} = { lost: false, fault: null, failed: false };
		const budget = new Semaphore(bytesInFlight);

		const endStream = (error: unknown): null => {
			log.error?.(
				{ error: (error as Error).message },
				"Body fetch stream failed",
			);
			// A dropped connection leaves every not-yet-yielded UID in `pending`;
			// they fall through to failedMessageIds and re-enqueue. Any other error
			// is a real fault, raised once the stores already running have finished.
			if (isConnectionDrop(error)) {
				stream.lost = true;
				log.info?.(
					{ remainingCount: pending.size },
					"Connection lost, aborting batch",
				);
				return null;
			}
			stream.fault = { error };
			return null;
		};

		// The FETCH stays one command on the one connection, read in order; no
		// row is pulled after a store has failed.
		async function* fetchedBodies(): AsyncGenerator<{
			uid: number;
			messageId: string;
			body: Buffer;
		}> {
			const rows = connection.fetchMessageBodies([...pending.keys()]);
			for (;;) {
				const step = await rows.next().catch(endStream);
				if (!step || step.done) return;
				const { uid, source } = step.value;
				const messageId = pending.get(uid);
				if (!messageId) continue;
				if (stream.failed) {
					await rows.return(undefined);
					return;
				}
				yield { uid, messageId, body: source };
			}
		}

		const stored = await pMap(
			fetchedBodies(),
			async ({ uid, messageId, body }) => {
				// A body larger than the whole budget takes all of it and goes alone.
				const outcome = await budget.runExclusive(
					() =>
						this.storeFetchedBody(
							messageId,
							accountId,
							accountConfigId,
							body,
							{
								placement: folder.placement,
								folderSynced: folderSynced(folder),
								folderCreatedAt: folder.createdAt,
								internalDate: internalDateOf(internalDates, messageId),
							},
							reStoredMessageIds.has(messageId),
							lookups,
							location,
						),
					Math.min(body.length, bytesInFlight),
				);
				if (outcome.kind === "Failed") stream.failed = true;
				return { uid, messageId, outcome };
			},
			{ concurrency },
		);

		const syncedMessageIds: string[] = [];
		const syncedUids: number[] = [];
		const faults: unknown[] = [];
		for (const { uid, messageId, outcome } of stored) {
			if (outcome.kind === "Stored") {
				pending.delete(uid);
				syncedMessageIds.push(messageId);
				syncedUids.push(uid);
			}
			if (outcome.kind === "Quarantined") {
				pending.delete(uid);
				skippedCount++;
			}
			if (outcome.kind === "Failed") faults.push(outcome.error);
		}

		// A store failing on our own storage, database or queue fails the batch,
		// which redelivers whole; what stored skips on the redelivery.
		if (faults.length > 0) throw faults[0];
		if (stream.fault) throw stream.fault.error;

		// Anything still pending was never yielded (mid-stream drop or a UID the
		// server silently omitted) — re-enqueue it.
		const failedMessageIds = [...pending.values()];
		const connectionLost = stream.lost;

		await this.syncWarningService.settle(
			{
				accountConfigId,
				accountId,
				mailboxId: folder.mailboxId,
				uidValidity: folder.uidValidity,
			},
			SyncWarningStage.Body,
			{
				failedUids: [...pending.keys()],
				syncedUids,
				serverUids: { kind: "Unlisted" },
			},
		);

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

	/**
	 * Set a message aside because its body will not parse (issue #72). The
	 * fingerprint comes from the BodyPart rows metadata sync already wrote: the
	 * body path streams raw bytes and has no FETCH result to read.
	 */
	private async recordQuarantine(
		config: QuarantineConfig,
		messageId: string,
		location: {
			accountId: string;
			accountConfigId: string;
			mailboxPath: string;
		},
		error: BodyParseError,
	): Promise<void> {
		const message = await this.messageService.get(messageId);
		const messageData = await this.envelopeService.getMessageData(messageId);
		const threadMessage = await this.threadMessageService.findByMessageId(
			location.accountConfigId,
			messageId,
		);

		await config.quarantineService.record(
			{
				accountId: location.accountId,
				accountConfigId: location.accountConfigId,
				mailboxId: config.mailboxId,
				mailboxPath: location.mailboxPath,
				uidValidity: config.uidValidity,
				attempts: config.attempts,
			},
			message.uid,
			{
				stage: QuarantineFailureStage.BodyParse,
				code: error.failureCode,
				message: error.message,
			},
			shapeFromMessageData(
				message,
				messageData,
				threadMessage?.messageIdHeader,
			),
		);
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

	private async storeFetchedBody(
		messageId: string,
		accountId: string,
		accountConfigId: string,
		body: Buffer,
		arrival: Arrival,
		isReStore: boolean,
		lookups: BatchLookups,
		location: {
			accountId: string;
			accountConfigId: string;
			mailboxPath: string;
		},
	): Promise<StoreOutcome> {
		const stored = await this.storageService
			.storeMessageBody({
				accountConfigId,
				accountId,
				messageId,
				content: body,
			})
			.then((ref) =>
				this.applyPostStoreSteps(
					messageId,
					accountId,
					accountConfigId,
					body,
					{ uri: ref.uri },
					arrival,
					isReStore,
					lookups,
				),
			)
			.then(
				(): StoreOutcome => ({ kind: "Stored" }),
				(error: unknown): StoreOutcome => ({ kind: "Failed", error }),
			);
		if (stored.kind !== "Failed") return stored;

		const { error } = stored;

		// The one error in this frame that is the message's own fault. It
		// reaches here from the parse call and nowhere else, so the S3, DB and
		// queue work this same frame wraps cannot be mistaken for it. The row is
		// durable before the UID leaves `pending`, so the message is never let go
		// of unrecorded.
		if (!(error instanceof BodyParseError) || !this.quarantineConfig) {
			this.log.error?.(
				{ messageId, accountId, error: inspect(error) },
				"Body store failed",
			);
			return stored;
		}
		return this.recordQuarantine(
			this.quarantineConfig,
			messageId,
			location,
			error,
		).then(
			(): StoreOutcome => ({ kind: "Quarantined" }),
			(recordError: unknown): StoreOutcome => ({
				kind: "Failed",
				error: recordError,
			}),
		);
	}

	/**
	 * The steps every synced body must go through regardless of which path
	 * fetched it first — the sync path ({@link storeFetchedBody}) and the
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
		arrival: Arrival,
		/**
		 * Whether this call is a re-store of an already-classified message
		 * rather than a first store. The two re-entrant paths (`force: true`
		 * in `syncBodies`, and `fetchAndGetBody`'s `NoSuchKey` IMAP fallback) are
		 * both body-only re-fetches: a body re-sync fetches and stores bytes and
		 * runs no decision logic (issue #1011). When `isReStore` is true the
		 * placement/filter/category machinery is skipped entirely and the
		 * message's existing category is carried forward unchanged.
		 */
		isReStore: boolean,
		lookups: BatchLookups,
	): Promise<ParsedMail> {
		// The one operation on this path that can fail because of how the message
		// is built. Its own try block lives in `parseMessageBody`, so this frame —
		// which also wraps the S3 body write, the parsed-body cache, the placement
		// move, the label writes and the counter update — can tell the two apart
		// and quarantine only this one (issue #72). The ThreadMessage write these
		// feed happens later, alongside the Message write (see below), once the
		// write-once category is decided.
		const parsed = await parseMessageBody(body);

		await this.messageService.setSearchText(
			messageId,
			extractSearchText(parsed),
		);

		// Body-only re-fetch (issue #1011): the decision pass already ran when
		// this message's body first landed, so a re-store re-materializes only
		// the body-derived artifacts — parsed cache, body parts, the storage
		// key — and re-decides nothing: no classification, placement, filters,
		// labels, read state, and no second engagement-counter increment.
		// Skipping the decisions here is what lets the write-once fields stay
		// safe without per-derivation re-entrancy guards.
		if (isReStore) {
			await this.messageService.syncSearch([messageId]);
			// Same ordering rule as the first-store path below: the parsed-body
			// cache must be durable before `bodyStorageKey` — the skip-guard
			// signal — is written, so a failure here requeues the message and
			// the retry genuinely re-attempts the artifact writes.
			await this.storeParsedBodyCache(
				accountConfigId,
				accountId,
				messageId,
				parsed,
			);
			if (!isBodyPartDeferralEnabled()) {
				await this.storeBodyPartContents(
					accountConfigId,
					accountId,
					messageId,
					await this.envelopeService.listBodyParts(messageId),
					body,
				);
			}
			await this.messageService.update(messageId, {
				bodyStorageKey: bodyRef.uri,
			});
			this.log.info(
				{ messageId, storageKey: bodyRef.uri },
				"Body re-stored without re-running decisions",
			);
			return parsed;
		}

		const snippet = extractSnippet(parsed);
		const listId = extractListId(parsed);

		// Compute the header classification once, folding in the sender's
		// `flags.category` override when one applies (issue #299). The derived
		// fields are folded into the single Message update below — they are NOT
		// written here.
		const { fields: classification, categoryOverridden } =
			await classifyParsedMessage(this.addressService, accountConfigId, parsed);

		const senderPlacement = once(() =>
			this.senderPlacementOf(accountConfigId, parsed),
		);

		const { filterDecision, verdict, classifierScores } =
			await this.decideFiltersAndClassifier(
				lookups,
				{ accountId, accountConfigId },
				messageId,
				parsed,
				arrival,
				categoryOverridden,
				senderPlacement,
			);

		const spamVerdict = arrival.folderSynced
			? await decideSpamVerdict(
					this.spamConfig,
					this.addressService,
					spamArrivalOf({
						account: { accountId, accountConfigId },
						parsed,
						raw: body,
						internalDate: arrival.internalDate,
						sender: await senderPlacement(),
						filterDecision,
						classifierScores,
						classification,
						classifier: this.classifierConfig,
						gate: await lookups.classifierGate(),
						ownAddresses: await lookups.ownAddresses(),
					}),
				)
			: undefined;
		const spamPlacement = spamVerdict
			? spamPlacementOf(spamVerdict, await lookups.spamSettings())
			: NO_SPAM_PLACEMENT;

		// Store the parsed-body cache BEFORE persisting bodyStorageKey. The skip
		// guard in syncBodies treats a stored bodyStorageKey as "fully synced",
		// so if we wrote it first and the parsed-cache write then failed, the
		// requeued retry would skip the message — leaving parsedBody null forever.
		// A parsed-cache failure here throws and propagates before bodyStorageKey
		// is written, so the requeued message genuinely re-attempts the parsed
		// write.
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
				await this.envelopeService.listBodyParts(messageId),
				body,
			);
		}

		const decidedRow = await this.messageService.get(messageId);
		let filterMove: MessageFilterMove | undefined;
		let filterMoved = false;
		if (filterDecision.move) {
			const destinationMailboxId = filterDecision.move.destinationMailboxId;
			// Capture the source mailbox BEFORE the move rewrites mailboxId, so the
			// auto-moved badge can name where the filter took the message from and
			// offer an undo back to it (issue #223). Snapshotted into the marker
			// rather than read from `originalMailboxId` at derive time, which a
			// later user move would overwrite — the filter's source must survive an
			// undo to stay derivable. A redelivery after a failed enqueue finds
			// the move already applied locally, so the source is the folder the
			// uid still names, not the one the row now points at.
			const sourceMailboxId = uidMailboxIdOf(decidedRow);
			const filed = await this.filterConfig?.placementMoveService.moveMessage(
				accountConfigId,
				messageId,
				destinationMailboxId,
				accountId,
				decidedRow.mailboxId,
			);
			// A filter matches by content, not location: a message delivered
			// straight into the destination (a server-side rule) or already filed
			// there matches but was not moved by Remit. `moveMessage` no-ops in that
			// case; record neither the marker nor `movedByRemit`, so the badge never
			// claims a move that did not happen and its Undo is never a no-op.
			if (filed === "filed") {
				filterMoved = true;
				filterMove = {
					filterId: filterDecision.move.filterId,
					sourceMailboxId,
					destinationMailboxId,
					decidedAt: Date.now(),
				};
			}
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

		// Read once for the two write-once guards below — the auto-read decision
		// and the category carry-forward. Taken here rather than earlier because
		// nothing between this point and the Message update writes either field;
		// the moves touch `mailboxId` only.
		const existingMessage = await this.messageService.get(messageId);

		const { update: decided } = await recordArrival(this.spamConfig, {
			account: { accountId, accountConfigId },
			messageId,
			gate: lookups.classifierGate,
			classifierVerdict: verdict,
			classifierScores,
			classification,
			currentCategory: existingMessage.category,
			spamVerdict: spamVerdict ?? existingMessage.spamVerdict,
			spamPlacement,
			placement: this.placementConfig
				? {
						deps: { ...this.placementConfig, log: this.log },
						row: { ...decidedRow, ...classification },
						roles: await lookups.roleMailboxes(),
						sender: await senderPlacement(),
						move: !filterDecision.move,
						leaveJunk: arrival.internalDate <= arrival.folderCreatedAt,
					}
				: undefined,
		});

		// `flags.unsubscribed` (issue #302, RFC 039 Decision 3): auto-mark-read,
		// reusing the same FlagQueueService.markAsRead round-trip a manual
		// mark-as-read goes through — idempotent on a retry (flipFlag no-ops when
		// the message is already \Seen), so a failure here safely re-fires on the
		// next attempt rather than being lost behind the bodyStorageKey skip guard.
		await this.applyUnsubscribedAutoRead(
			messageId,
			accountId,
			accountConfigId,
			parsed,
			existingMessage.bodyStorageKey,
		);

		await this.deriveCalendarSuggestions(
			lookups,
			messageId,
			accountConfigId,
			parsed,
			existingMessage.bodyStorageKey,
		);

		// ONE Message UpdateItem per synced message: bodyStorageKey + every
		// classification/derived field + the move flag + the audit verdict,
		// collapsed into a single write.
		// The flag is folded in only when a move WAS applied (by the classifier or
		// a filter); the verdict is folded in whenever Remit decided to act.
		// Written LAST so bodyStorageKey — the skip-guard signal — is only durable
		// once the parsed cache AND the move (when any) are.

		// Thread-list denormalization, using the same write-once category as the
		// Message update below — the two rows must never disagree on category.
		await denormalizeMessageCategory(
			{ threadMessageService: this.threadMessageService },
			accountConfigId,
			messageId,
			{ category: decided.category, snippet, listId },
		);

		// `classificationState` records that the classifier ran, in the same
		// UpdateItem as the answer it gave (issue #331).
		const update: UpdateMessageInput = {
			bodyStorageKey: bodyRef.uri,
			...decided,
			...(filterMoved ? { movedByRemit: true } : {}),
			...(filterMove ? { filterMove } : {}),
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
	 * @param folder - The IMAP mailbox path and its folder placement
	 * @param getConnection - Function to get a (lazy) IMAP connection
	 * @returns Parsed text and HTML content
	 */
	async fetchAndGetBody(
		messageId: string,
		accountId: string,
		accountConfigId: string,
		folder: BodySyncFolder,
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
					message,
					accountId,
					accountConfigId,
					folder.fullPath,
					getConnection,
				);
			}
		} else {
			// Fetch from IMAP and store
			needsStore = true;
			body = await this.fetchFromImap(
				message,
				accountId,
				accountConfigId,
				folder.fullPath,
				getConnection,
			);
		}

		let parsed: ParsedMail;

		if (needsStore) {
			const ref = await this.storageService.storeMessageBody({
				accountConfigId,
				accountId,
				messageId,
				content: body,
			});

			// A store from here is a re-store exactly when the row already claimed
			// a stored body — the NoSuchKey fallback above; a row with no
			// bodyStorageKey is a genuine first store and takes the full decision
			// pass.
			parsed = await this.applyPostStoreSteps(
				messageId,
				accountId,
				accountConfigId,
				body,
				{ uri: ref.uri },
				{
					placement: folder.placement,
					internalDate: message.internalDate,
					folderSynced: folderSynced(folder),
					folderCreatedAt: folder.createdAt,
				},
				message.bodyStorageKey != null,
				this.batchLookups(accountConfigId, accountId),
			);
		} else {
			const { simpleParser } = await import("mailparser");
			parsed = await simpleParser(body);
		}

		return {
			text: parsed.text ?? null,
			html: typeof parsed.html === "string" ? parsed.html : null,
			storedAt: message.bodyStorageKey ?? "newly-stored",
		};
	}

	private async fetchFromImap(
		message: MessageItem,
		accountId: string,
		accountConfigId: string,
		mailboxPath: string,
		getConnection: ConnectionGetter,
	): Promise<Buffer> {
		const { uid } = message;
		this.log.debug?.({ uid }, "Fetching body from IMAP");
		const connection = await getConnection();
		await connection.openBox(mailboxPath);
		const body = await connection.fetchMessageBody(uid);
		if (body) return body;

		if (!(await isMessageGoneFromOpenMailbox(connection, uid))) {
			throw new Error(
				`IMAP FETCH returned no source for UID ${uid} in ${mailboxPath}, which the server still lists`,
			);
		}

		return this.reconcileGoneMessage(message, accountId, mailboxPath);
	}

	/**
	 * The server no longer holds the message at the row's UID. A row with our
	 * own move or delete in flight belongs to that mutation (409). A settled row
	 * is removed with its thread entries, but only while its placement still
	 * matches what was read (imap-mutations R3); losing that predicate is a 409
	 * like any other lost placement transition.
	 */
	private async reconcileGoneMessage(
		message: MessageItem,
		accountId: string,
		mailboxPath: string,
	): Promise<never> {
		const { messageId, uid } = message;
		if (isPlacementUnsettled(message)) {
			throw new MessagePlacementUnsettledError(
				`Message ${messageId} is not at its UID while a move or delete is in flight`,
				accountId,
				messageId,
				"in_flight",
			);
		}

		const reconciled = await this.messageService.deleteIfPlacement(messageId, {
			status: message.status,
			mailboxId: message.mailboxId,
			uid,
		});

		if (!reconciled) {
			throw new MessagePlacementUnsettledError(
				`Message ${messageId} changed placement while its absence from ${mailboxPath} was being reconciled`,
				accountId,
				messageId,
				"in_flight",
			);
		}

		this.log.info(
			{
				metric: "message_gone_stale_row_reconciled",
				messageId,
				uid,
				mailboxPath,
			},
			"Message no longer on the mail server (expunged or moved by another client); stale row reconciled",
		);
		throw new MessageGoneFromServerError(messageId);
	}

	private senderPlacementOf(
		accountConfigId: string,
		parsed: ParsedMail,
	): Promise<SenderPlacement> {
		return readSenderPlacement(
			this.addressService,
			accountConfigId,
			extractPrimaryFromEmail(parsed),
		);
	}

	private async classifierRunsFirst(lookups: BatchLookups): Promise<boolean> {
		if (!this.filterPipeline || !this.classifierConfig) return false;
		const usable = await lookups.usableFilters().catch(() => undefined);
		return (
			usable?.filters.some((filter) =>
				filterRuleTestsClassification(filter.rule),
			) ?? false
		);
	}

	private async decideFiltersAndClassifier(
		lookups: BatchLookups,
		account: { accountId: string; accountConfigId: string },
		messageId: string,
		parsed: ParsedMail,
		arrival: Arrival,
		categoryOverridden: boolean,
		senderPlacement: () => Promise<SenderPlacement>,
	): Promise<{
		filterDecision: FilterDecision;
		verdict: ClassifierVerdict;
		classifierScores: ClassifierScoreItem[];
	}> {
		const matched = (decision: FilterDecision): boolean =>
			decision.labels.length > 0 || decision.move !== undefined;
		if (await this.classifierRunsFirst(lookups)) {
			const classified = await this.decideClassifier(
				lookups,
				account,
				parsed,
				arrival,
				categoryOverridden,
				senderPlacement,
			);
			const filterDecision = await this.evaluateFilters(
				lookups,
				messageId,
				parsed,
				arrival,
				classified.scores,
			);
			return {
				filterDecision,
				verdict: matched(filterDecision)
					? NO_CLASSIFIER_DECISION.verdict
					: classified.verdict,
				classifierScores: classified.scores,
			};
		}
		const filterDecision = await this.evaluateFilters(
			lookups,
			messageId,
			parsed,
			arrival,
			[],
		);
		const classified = await this.decideClassifier(
			lookups,
			account,
			parsed,
			arrival,
			matched(filterDecision) || categoryOverridden,
			senderPlacement,
		);
		return {
			filterDecision,
			verdict: classified.verdict,
			classifierScores: classified.scores,
		};
	}

	private async decideClassifier(
		lookups: BatchLookups,
		account: { accountId: string; accountConfigId: string },
		parsed: ParsedMail,
		arrival: Arrival,
		userRuleApplies: boolean,
		senderPlacement: () => Promise<SenderPlacement>,
	): Promise<ClassifierDecision> {
		const { classifierConfig } = this;
		if (!classifierConfig || !arrival.folderSynced || userRuleApplies) {
			return NO_CLASSIFIER_DECISION;
		}
		const gate = await lookups.classifierGate();
		if (gate.state === "Off" || arrival.internalDate <= gate.classifiesAfter) {
			return NO_CLASSIFIER_DECISION;
		}
		const consulted = await consultClassifier(
			classifierConfig,
			gate,
			account,
			parsed,
			(await senderPlacement()).senderOverride,
			Date.now(),
		);
		return consulted.state === "Answered"
			? { verdict: consulted.verdict, scores: consulted.scores }
			: NO_CLASSIFIER_DECISION;
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

	/**
	 * `flags.unsubscribed` (issue #302, RFC 039 Decision 3): "auto-mark-read
	 * until sender stops" — fires on every new message from that sender for as
	 * long as the flag stays set, per the flag's own doc comment; there is no
	 * separate expiry mechanism, and no caching of the decision beyond this
	 * per-message `Address` read. A no-op when body sync was built without an
	 * {@link UnsubscribeConfig} or the message carries no `From` address.
	 *
	 * Write-once per message (issue #499), like the `category` and placement
	 * derivations alongside it: read state is applied on the pass that first
	 * classifies a message and never re-decided. A user who marks such a message
	 * unread afterwards owns it — a re-entrant pass over an already-classified
	 * body would otherwise silently undo that.
	 */
	private async applyUnsubscribedAutoRead(
		messageId: string,
		accountId: string,
		accountConfigId: string,
		parsed: ParsedMail,
		storedBodyKey: string | undefined,
	): Promise<void> {
		if (!this.unsubscribeConfig) return;
		if (hasStoredBody(storedBodyKey)) return;

		const fromEmail = extractPrimaryFromEmail(parsed);
		if (!fromEmail) return;

		const unsubscribed = await this.deriveSenderUnsubscribed(
			accountConfigId,
			fromEmail,
		);
		if (!unsubscribed) return;

		await this.unsubscribeConfig.flagQueueService.markAsRead(
			accountConfigId,
			messageId,
			accountId,
		);
	}

	/**
	 * Offer what a message's `text/calendar` parts propose, as cards beside the
	 * message (issue #1033). Nothing here reaches a calendar: a suggestion is
	 * written `Pending` and waits for a person, and a `METHOD:CANCEL` is a card
	 * of its own rather than a withdrawal of an event the user added.
	 *
	 * Write-once per message, like the `category`, placement and read-state
	 * derivations alongside it (issues #499, #1011): a card is offered on the
	 * pass that first classifies a message — the same moment the account's
	 * filters run — and never again. The two re-entrant paths a forced body
	 * re-sync goes through (`fetchAndGetBody`'s `NoSuchKey` fallback,
	 * `syncBodies(..., force: true)`) reach this with `bodyStorageKey` already
	 * set, and re-offering there would resurrect a card the user dismissed.
	 *
	 * Nothing here is caught. A failure is a fault in this code or its store,
	 * so it fails the body-sync job loudly and the job takes the queue's own
	 * dead-letter path. A part the sender's client wrote badly is not a failure:
	 * it is read as `Unreadable` and offered nothing.
	 */
	private async deriveCalendarSuggestions(
		lookups: BatchLookups,
		messageId: string,
		accountConfigId: string,
		parsed: ParsedMail,
		storedBodyKey: string | undefined,
	): Promise<void> {
		if (!this.calendarConfig) return;
		if (hasStoredBody(storedBodyKey)) return;

		const parts = calendarParts(parsed);
		if (parts.length === 0) return;

		const { calendarStore, calendarSuggestionService, accountService } =
			this.calendarConfig;

		// A guest answering the reader's own invitation moves their answer on the
		// organizer's copy, whoever the reader muted. Local only: nothing goes
		// back to the guest. A reply proposes nothing to add, so it is never
		// offered as a card.
		const selfAddresses = (
			await accountService.listAllByAccountConfig(accountConfigId)
		).map((account) => account.email);
		const offered: typeof parts = [];
		for (const part of parts) {
			const replied = await recordCalendarReply(calendarStore, {
				accountConfigId,
				icalData: part.icalData,
				selfAddresses,
			});
			if (replied === "NotAReply") offered.push(part);
		}
		if (offered.length === 0) return;

		// `dismiss{muteSender:true}` wrote a standing rule naming this
		// sender. Honouring it here is what makes that button do anything:
		// the index-time filter pipeline skips a rule with no label and no
		// move, so this is the only reader such a rule has.
		const sender = extractPrimaryFromEmail(parsed);
		if (sender) {
			const active = await lookups.activeFilters();
			if (isSenderMuted(active, sender)) {
				this.log.debug?.(
					{ messageId, sender },
					"Sender is muted; offering no calendar suggestion",
				);
				return;
			}
		}

		// Provisioned rather than looked up, through the one function every
		// caller provisions with. A missing collection has no timezone, and
		// a floating DTSTART read in UTC puts the meeting hours from where
		// the organizer meant it. Idempotent: the id is derived, so a second
		// first use returns the collection the first one made.
		const collection = await provisionDefaultCalendar(
			calendarStore,
			accountConfigId,
		);
		for (const part of offered) {
			const recorded = await recordCalendarSuggestion(
				calendarSuggestionService,
				{
					accountConfigId,
					messageId,
					bodyPartId: deriveBodyPartId(messageId, part.partPath),
					source: part.source,
					icalData: part.icalData,
					timezone: collection.timezone,
				},
			);
			if (!recorded.ok) {
				this.log.info(
					{
						messageId,
						partPath: part.partPath,
						code: recorded.error.code,
						reason: recorded.error.message,
					},
					"Message carries iCalendar this cannot read; no suggestion offered",
				);
			}
		}
	}

	private async deriveSenderUnsubscribed(
		accountConfigId: string,
		fromEmail: string,
	): Promise<boolean> {
		try {
			const addressId = deriveAddressId(accountConfigId, fromEmail);
			const address = await this.addressService.getAddress(
				accountConfigId,
				addressId,
			);
			return address.flags?.unsubscribed?.value === true;
		} catch (err) {
			// A genuinely-absent address means "not unsubscribed". Any other
			// failure (AccessDenied, throttle, infra) must NOT be silently
			// downgraded — let it crash so the read-state decision isn't made on
			// bad data.
			if (!(err instanceof NotFoundError)) throw err;
			return false;
		}
	}

	/**
	 * Evaluate the account's active filters against a synced message (RFC 034),
	 * BEFORE the single Message update — so a filter's `movedByRemit` flag joins
	 * that same UpdateItem. Returns the actions to apply (labels + at most one
	 * move); the caller applies them. A no-op returning no actions when no
	 * {@link FilterConfig} is wired.
	 *
	 * A failed filter read never fails the body store (the #1246 placement
	 * precedent). The applies of the returned decision are the caller's and are
	 * deliberately unswallowed.
	 */
	private async evaluateFilters(
		lookups: BatchLookups,
		messageId: string,
		parsed: ParsedMail,
		arrival: Arrival,
		classifierScores: readonly ClassifierScoreItem[],
	): Promise<FilterDecision> {
		const { filterPipeline } = this;
		if (!filterPipeline) return { labels: [] };
		return lookups
			.usableFilters()
			.then((usable) =>
				filterPipeline.decide(
					filtersForArrival(usable, arrival),
					toFilterMessage(parsed, classifierScores),
				),
			)
			.catch((error: unknown): FilterDecision => {
				this.log.error?.(
					{
						alert: "body_sync_filter_match_failed",
						messageId,
						errorName: (error as { name?: string })?.name,
						error: inspect(error),
					},
					"Filter matching failed; body already stored, continuing without filter actions (best-effort, non-fatal)",
				);
				return { labels: [] };
			});
	}

	private batchLookups(
		accountConfigId: string,
		accountId: string,
	): BatchLookups {
		const { placementConfig, filterPipeline, classifierConfig } = this;
		const filterService =
			this.filterConfig?.filterService ?? this.calendarConfig?.filterService;
		const activeFilters = once(async () =>
			filterService
				? filterService.listByAccountAndState(
						accountConfigId,
						FilterState.Active,
					)
				: [],
		);
		return {
			roleMailboxes: once(async () =>
				placementConfig
					? resolveFolderRoleMailboxes(
							placementConfig.mailboxSpecialUseService,
							accountId,
						)
					: { junkMailbox: null, inboxMailbox: null },
			),
			activeFilters,
			usableFilters: once(async () => {
				if (!filterPipeline) {
					throw new Error("usableFilters needs a filter pipeline");
				}
				return filterPipeline.prepare(
					accountConfigId,
					accountId,
					await activeFilters(),
				);
			}),
			classifierGate: once(async () =>
				classifierConfig
					? readClassifierGate(classifierConfig, accountConfigId)
					: CLASSIFIER_OFF,
			),
			ownAddresses: once(async () =>
				(
					await this.spamConfig.accountService.listAllByAccountConfig(
						accountConfigId,
					)
				).map((account) => account.email),
			),
			spamSettings: once(() =>
				readResolvedSpamSettings(this.spamConfig, accountConfigId),
			),
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
		bodyParts: readonly BodyPartItem[],
		body: Buffer,
		options?: { skipExisting?: boolean },
	): Promise<StoreBodyPartContentsResult> {
		if (bodyParts.length === 0) {
			this.log.debug?.(
				{ messageId },
				"No BodyPart rows; skipping per-part storage",
			);
			return { stored: 0 };
		}

		const log = this.log;
		// A parse of its own: classification and the snippet, which search reads,
		// need an inline forwarded message's text, which `ignoreEmbedded` keeps out.
		const pairs = await mapMessagePartsToContent(
			bodyParts,
			await parsePartSource(body),
			{
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
			},
		);

		if (pairs.length === 0) {
			return { stored: 0 };
		}

		let stored = 0;
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
			},
			{ concurrency: BODY_PART_STORE_CONCURRENCY },
		);

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
		const bodyParts = await this.envelopeService.listBodyParts(messageId);
		const carriesMessage = bodyParts.some(isEncapsulatedMessage);
		const sentinel = carriesMessage
			? MATERIALIZED_SENTINEL_V2_PART_PATH
			: MATERIALIZED_SENTINEL_PART_PATH;
		if (
			await this.storageService.bodyPartExists(
				accountConfigId,
				accountId,
				messageId,
				sentinel,
			)
		) {
			this.log.debug?.(
				{ messageId },
				"Body parts already materialized (sentinel hit); skipping",
			);
			return { stored: 0 };
		}

		const body = await this.storageService.retrieve(bodyStorageKey);
		const result = await this.storeBodyPartContents(
			accountConfigId,
			accountId,
			messageId,
			bodyParts,
			body,
			{ skipExisting: !carriesMessage },
		);

		// Reaching here means storeBodyPartContents resolved — `pMap` rejects on
		// any single failed write, so every leaf is now durably on S3. Drop the
		// sentinel so subsequent opens take the HEAD-only fast path above.
		await this.storageService.storeBodyPart({
			accountConfigId,
			accountId,
			messageId,
			partPath: sentinel,
			content: Buffer.alloc(0),
		});

		return result;
	}

	private async storeParsedBodyCache(
		accountConfigId: string,
		accountId: string,
		messageId: string,
		parsed: ParsedMail,
	): Promise<void> {
		await this.storageService.storeParsedBody({
			accountConfigId,
			accountId,
			messageId,
			parsed: toParsedBody(parsed),
		});
	}
}
