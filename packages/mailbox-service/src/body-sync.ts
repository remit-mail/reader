import { PassThrough, type Readable } from "node:stream";
import { inspect } from "node:util";
import {
	AddressService,
	type EnvelopeService,
	isBulkSender,
	type MailboxSpecialUseService,
	type MessageService,
	NotFoundError,
	type ThreadMessageService,
	type UpdateMessageInput,
} from "@remit/remit-electrodb-service";
import {
	MailboxSpecialUse,
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
import type { MessageMoveService } from "./message-move.js";
import { extractSnippetFromEmail } from "./snippet.js";
import { type IImapConnection, MailConnectionError } from "./types.js";

const BODY_PART_STORE_CONCURRENCY = 4;

type MessagePlacementVerdict = NonNullable<
	UpdateMessageInput["placementVerdict"]
>;

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
	mailboxSpecialUseService: MailboxSpecialUseService;
	messageMoveService: MessageMoveService;
}

export class BodySyncService {
	private log: BodySyncLogger;

	constructor(
		private messageService: MessageService,
		private storageService: StorageService,
		private threadMessageService: ThreadMessageService,
		private addressService: AddressService,
		private envelopeService: EnvelopeService,
		logger?: BodySyncLogger,
		private readonly placementConfig?: PlacementConfig,
	) {
		this.log = logger ?? noopLogger;
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
	 */
	async syncBodies(
		messageIds: string[],
		accountId: string,
		accountConfigId: string,
		mailboxPath: string,
		getConnection: ConnectionGetter,
	): Promise<SyncBodiesResult> {
		const syncedMessageIds: string[] = [];
		let skippedCount = 0;

		// Resolve every message up front so we can issue ONE ranged FETCH for the
		// whole batch (the desktop-client pattern) instead of a SELECT + download
		// per message. Messages whose body is already stored are skipped here and
		// never hit the wire. `pending` maps each UID to its messageId so we can
		// match FETCH rows back and re-enqueue any UID the server never returns.
		const pending = new Map<number, string>();
		for (const messageId of messageIds) {
			const message = await this.messageService.get(messageId);
			if (message.bodyStorageKey) {
				this.log.debug?.({ messageId }, "Body already stored, skipping");
				skippedCount++;
				continue;
			}
			pending.set(message.uid, messageId);
		}

		if (pending.size === 0) {
			return this.buildResult(syncedMessageIds, skippedCount, []);
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
		const failedMessageIds = [...pending.values()];

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

		// Snippet + thread update; reuses the parsed mail for the steps below.
		// This is a ThreadMessage write — a different entity — so it does NOT
		// trigger the Message-filtered stream bridge and stays separate.
		const parsed = await this.updateSnippets(messageId, accountConfigId, body);

		// Compute the header classification once. The derived fields are folded
		// into the single Message update below — they are NOT written here.
		const classification = this.classifyMessage(parsed);

		// Decide the placement move from the in-memory classification before the
		// write, so its `movedByRemit` flag and audit verdict join the same
		// UpdateItem. Best-effort and fully isolated: a failure here can never
		// block the body sync. The verdict is recorded whenever Remit decided to
		// act (action != leave); the move is enqueued only for a confident,
		// actionable verdict.
		const resolved = await this.resolvePlacement(
			messageId,
			accountId,
			accountConfigId,
			parsed,
			classification,
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

		// ONE Message UpdateItem per synced message: bodyStorageKey + every
		// classification/derived field + the move flag + the audit verdict. Each
		// extra Message mutation emits a DDB stream record that fans out to a
		// redundant S3-Vectors upsert, so we collapse them into a single write.
		// The flag is folded in only when a move WILL be enqueued; the verdict
		// is folded in whenever Remit decided to act. Written LAST so bodyStorageKey
		// — the skip-guard signal — is only durable once the parsed cache is.
		const update: UpdateMessageInput = {
			bodyStorageKey: ref.uri,
			...classification,
			...(resolved.move ? { movedByRemit: true } : {}),
			...(resolved.verdict ? { placementVerdict: resolved.verdict } : {}),
		};
		await this.messageService.update(messageId, update);
		this.log.info({ messageId, storageKey: ref.uri }, "Body stored");

		// From-Address engagement counter (Address entity, not Message).
		await this.incrementInboundCount(
			messageId,
			accountConfigId,
			parsed,
			classification,
		);

		// The actual mailbox move runs LAST, after the body cache is durably
		// stored. The `movedByRemit` flag was already folded into the update
		// above; here we only enqueue the IMAP move. A non-confident or leave
		// verdict yields no move, so this is a no-op for those.
		if (resolved.move) {
			await this.enqueuePlacementMove(
				messageId,
				accountId,
				resolved.move.destinationMailboxId,
				resolved.move.destinationPath,
			);
		}
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

			await this.messageService.update(messageId, {
				bodyStorageKey: ref.uri,
			});
			this.log.info?.({ messageId, storageKey: ref.uri }, "Body stored");

			// Update snippets for thread entities — also returns the parsed
			// mail so we don't pay mailparser twice.
			parsed = await this.updateSnippets(messageId, accountConfigId, body);
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
					parsed,
				);
			}
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
	 * Pure header classification. Returns the subset of the Message update that
	 * carries the derived fields; the caller folds it into a single UpdateItem
	 * alongside `bodyStorageKey`. Optional signals are omitted when absent so we
	 * never overwrite an existing value with `undefined`.
	 */
	private classifyMessage(parsed: ParsedMail): UpdateMessageInput {
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

		const addressId = AddressService.generateAddressId(
			accountConfigId,
			fromEmail,
		);
		const bulk = isBulkSender(
			classification.category,
			classification.hasListUnsubscribe ?? false,
		);
		await this.addressService.incrementInboundCount(
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
			const addressId = AddressService.generateAddressId(
				accountConfigId,
				fromEmail,
			);
			const address = await this.addressService.getAddress(addressId);
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
	 * Best-effort: this is an enhancement bolted onto the body-sync hot path, NOT
	 * part of the critical sync contract, so it is the one place where
	 * let-it-crash is wrong. Any failure is swallowed with a warning and treated
	 * as "no outcome" so it can never fail body-sync or block the search-index
	 * enqueue. The verdict reads the just-computed classification rather than a
	 * persisted row, since those fields are not written until the single update.
	 */
	private async resolvePlacement(
		messageId: string,
		accountId: string,
		accountConfigId: string,
		parsed: ParsedMail,
		classification: UpdateMessageInput,
	): Promise<PlacementOutcome> {
		if (!this.placementConfig) return {};
		const { mailboxSpecialUseService } = this.placementConfig;

		try {
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
		} catch (err: unknown) {
			// biome-ignore lint/plugin/no-silent-catch: best-effort placement verdict — failure here must never abort body-sync; the move is a non-fatal enhancement
			this.log.warn?.(
				{ messageId, accountId, error: inspect(err) },
				"Placement move failed (best-effort, non-fatal)",
			);
			return {};
		}
	}

	/**
	 * Enqueue the IMAP move for a placed message. Best-effort: a failure here is
	 * swallowed with a warning so it can never fail body-sync. The `movedByRemit`
	 * flag was already persisted in the single Message update.
	 */
	private async enqueuePlacementMove(
		messageId: string,
		accountId: string,
		destinationMailboxId: string,
		destinationPath: string,
	): Promise<void> {
		if (!this.placementConfig) return;
		try {
			await this.placementConfig.messageMoveService.moveMessage(
				messageId,
				destinationMailboxId,
				accountId,
			);
			this.log.info(
				{ messageId, accountId, destination: destinationPath },
				"Moved message by placement verdict",
			);
		} catch (err: unknown) {
			// biome-ignore lint/plugin/no-silent-catch: best-effort placement move enqueue — failure here must never abort body-sync; the movedByRemit flag was already persisted
			this.log.warn?.(
				{ messageId, accountId, error: inspect(err) },
				"Placement move failed (best-effort, non-fatal)",
			);
		}
	}

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
	 * Extract snippet from message body and update ThreadMessage.
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

		if (!snippet) {
			return parsed;
		}

		// Get the message to find its messageIdHeader
		const message = await this.messageService.get(messageId);
		if (!message.messageIdHeader) {
			this.log.debug?.(
				{ messageId },
				"No messageIdHeader, skipping snippet update",
			);
			return parsed;
		}

		// Get the ThreadMessage by messageId (efficient GSI lookup)
		const threadMessage =
			await this.threadMessageService.getByMessageId(messageId);

		// Update ThreadMessage snippet.
		// Pass the full composite set so that if a future key-attribute addition
		// touches lsi3/lsi4/lsi5/gsi2 sort keys, the index rows remain consistent.
		// The threadMessage was fetched just above, so the values are already in scope.
		await this.threadMessageService.update(
			accountConfigId,
			threadMessage.threadMessageId,
			{ snippet },
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

		this.log.debug?.(
			{ messageId, snippetLength: snippet.length },
			"Snippet updated",
		);

		return parsed;
	}
}
