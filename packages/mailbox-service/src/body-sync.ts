import { PassThrough, type Readable } from "node:stream";
import { inspect } from "node:util";
import {
	AddressService,
	type EnvelopeService,
	type MailboxSpecialUseService,
	type MessageService,
	type ThreadMessageService,
} from "@remit/remit-electrodb-service";
import { MailboxSpecialUse, SenderTrust } from "@remit/domain-enums";
import type { ParsedBody, StorageService } from "@remit/storage-service";
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
import { shouldRescueFromJunk } from "./heuristics/rescueFromJunk.js";
import type { MessageMoveService } from "./message-move.js";
import { extractSnippetFromEmail } from "./snippet.js";
import { type IImapConnection, MailConnectionError } from "./types.js";

const BODY_PART_STORE_CONCURRENCY = 4;

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

export interface RescueConfig {
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
		private readonly rescueConfig?: RescueConfig,
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
				pending.delete(uid);

				await this.storeStreamedBody(
					messageId,
					accountId,
					accountConfigId,
					source,
				);
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

		await this.messageService.update(messageId, { bodyStorageKey: ref.uri });
		this.log.info({ messageId, storageKey: ref.uri }, "Body stored");

		// Snippet + thread update; reuses the parsed mail for the steps below.
		const parsed = await this.updateSnippets(messageId, accountConfigId, body);

		// Header classification + From-Address engagement counters.
		await this.classifyAndCount(messageId, accountConfigId, parsed);

		await this.storeParsedBodyCache(
			accountConfigId,
			accountId,
			messageId,
			parsed,
		);

		await this.storeBodyPartContents(
			accountConfigId,
			accountId,
			messageId,
			parsed,
		);

		// Best-effort junk rescue runs LAST, fully isolated.
		await this.maybeRescueFromJunk(
			messageId,
			accountId,
			accountConfigId,
			parsed,
		);
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
				// Storage file missing (e.g., different environment), re-fetch from IMAP
				this.log.debug?.(
					{ messageId, error: (err as Error).message },
					"Storage retrieval failed, falling back to IMAP",
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
			await this.storeBodyPartContents(
				accountConfigId,
				accountId,
				messageId,
				parsed,
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

	private async classifyAndCount(
		messageId: string,
		accountConfigId: string,
		parsed: ParsedMail,
	): Promise<void> {
		const category = classifyByHeaders(parsed);
		const authenticity = extractAuthenticity(parsed);
		const authResult = extractAuthResult(parsed);
		const providerSpam = extractProviderSpam(parsed);
		const hasListUnsubscribe = extractHasListUnsubscribe(parsed);
		await this.messageService.update(messageId, {
			category,
			...(authenticity !== null ? { authenticity } : {}),
			...(authResult !== null ? { authResult } : {}),
			...(providerSpam !== null ? { providerSpam } : {}),
			hasListUnsubscribe,
		});

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
		await this.addressService.incrementInboundCount(addressId, Date.now());
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
		} catch {
			// Address not found — treat as unknown trust
		}
		return SenderTrust.Unknown;
	}

	/**
	 * Best-effort rescue of falsely-junked mail. This is an enhancement bolted
	 * onto the body-sync hot path, NOT part of the critical sync contract, so
	 * it is the one place where let-it-crash is wrong: any failure here is
	 * swallowed with a warning so it can never fail body-sync or block the
	 * search-index enqueue. Runs last, after the body cache is durably stored.
	 */
	private async maybeRescueFromJunk(
		messageId: string,
		accountId: string,
		accountConfigId: string,
		parsed: ParsedMail,
	): Promise<void> {
		if (!this.rescueConfig) return;
		const { mailboxSpecialUseService, messageMoveService } = this.rescueConfig;

		try {
			const message = await this.messageService.get(messageId);
			const junkMailbox = await mailboxSpecialUseService.findBySpecialUse(
				accountId,
				MailboxSpecialUse.Junk,
			);
			if (!junkMailbox || message.mailboxId !== junkMailbox.mailboxId) return;

			const fromEmail = extractPrimaryFromEmail(parsed);
			const senderTrust = fromEmail
				? await this.deriveSenderTrust(accountConfigId, fromEmail)
				: SenderTrust.Unknown;

			const rescue = shouldRescueFromJunk(message, senderTrust);
			if (!rescue) return;

			const inboxMailbox =
				await mailboxSpecialUseService.findInboxMailbox(accountId);
			if (!inboxMailbox) return;

			await this.messageService.update(messageId, { movedByRemit: true });
			await messageMoveService.moveMessage(
				messageId,
				inboxMailbox.mailboxId,
				accountId,
			);

			this.log.info(
				{ messageId, accountId, destination: inboxMailbox.fullPath },
				"Rescued message from Junk",
			);
		} catch (err: unknown) {
			this.log.warn?.(
				{ messageId, accountId, error: inspect(err) },
				"Junk rescue failed (best-effort, non-fatal)",
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

		await pMap(
			pairs,
			async (entry) => {
				await this.storageService.storeBodyPart({
					accountConfigId,
					accountId,
					messageId,
					partPath: entry.partPath,
					content: entry.content,
					contentType: entry.contentType,
				});
			},
			{ concurrency: BODY_PART_STORE_CONCURRENCY },
		);

		this.log.info({ messageId, partCount: pairs.length }, "Body parts stored");

		return { stored: pairs.length };
	}

	/**
	 * Persist the pre-parsed body cache. A failure here MUST NOT fail the
	 * surrounding body-sync: the raw .eml is still useful and the read path
	 * can fall back to mailparser. Errors are logged via util.inspect.
	 */
	private async storeParsedBodyCache(
		accountConfigId: string,
		accountId: string,
		messageId: string,
		parsed: ParsedMail,
	): Promise<void> {
		const parsedBody = toParsedBody(parsed);
		await this.storageService
			.storeParsedBody({
				accountConfigId,
				accountId,
				messageId,
				parsed: parsedBody,
			})
			.then(() => {
				this.log.debug?.({ messageId }, "Parsed body cache stored");
			})
			.catch((err: unknown) => {
				this.log.error?.(
					{ messageId, error: inspect(err) },
					"Failed to store parsed body cache (non-fatal)",
				);
			});
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
