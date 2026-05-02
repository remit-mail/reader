import { inspect } from "node:util";
import {
	AddressService,
	type EnvelopeService,
	type MessageService,
	type ThreadMessageService,
} from "@remit/remit-electrodb-service";
import type { ParsedBody, StorageService } from "@remit/storage-service";
import { type ParsedMail, simpleParser } from "mailparser";
import pMap from "p-map";
import { mapBodyPartsToContent } from "./body-part-mapper.js";
import { classifyByHeaders } from "./heuristics/classifyByHeaders.js";
import { extractSnippetFromEmail } from "./snippet.js";
import type { IImapConnection } from "./types.js";

const BODY_PART_STORE_CONCURRENCY = 4;

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

export type ConnectionGetter = () => Promise<IImapConnection>;

export class BodySyncService {
	private log: BodySyncLogger;

	constructor(
		private messageService: MessageService,
		private storageService: StorageService,
		private threadMessageService: ThreadMessageService,
		private addressService: AddressService,
		private envelopeService: EnvelopeService,
		logger?: BodySyncLogger,
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
		// Track results and processed indices for fail-fast behavior
		type ResultItem =
			| { status: "synced"; messageId: string }
			| { status: "skipped" }
			| { status: "failed"; messageId: string };

		const results: ResultItem[] = [];
		const processedIndices = new Set<number>();
		let connectionLost = false;

		// Process bodies sequentially (concurrency 1) to enable fail-fast
		// on connection errors. Higher concurrency would require connection pooling.
		for (let i = 0; i < messageIds.length && !connectionLost; i++) {
			const messageId = messageIds[i];
			processedIndices.add(i);

			try {
				const result = await this.fetchAndStoreBody(
					messageId,
					accountId,
					accountConfigId,
					mailboxPath,
					getConnection,
				);
				results.push(result);
			} catch (error) {
				const errorMessage = (error as Error).message;
				this.log.error?.(
					{ messageId, error: errorMessage },
					"Failed to sync body",
				);
				results.push({ status: "failed", messageId });

				// Fail-fast on connection lost errors
				if (errorMessage.includes("connection lost")) {
					connectionLost = true;
					this.log.info?.(
						{
							processedCount: i + 1,
							remainingCount: messageIds.length - i - 1,
						},
						"Connection lost, aborting batch",
					);
				}
			}
		}

		// Add all unprocessed messages as failed (for requeueing)
		for (let i = 0; i < messageIds.length; i++) {
			if (!processedIndices.has(i)) {
				results.push({ status: "failed", messageId: messageIds[i] });
			}
		}

		const synced = results.filter(
			(r): r is { status: "synced"; messageId: string } =>
				r.status === "synced",
		);
		const skipped = results.filter((r) => r.status === "skipped");
		const failed = results.filter(
			(r): r is { status: "failed"; messageId: string } =>
				r.status === "failed",
		);

		this.log.info(
			{
				synced: synced.length,
				skipped: skipped.length,
				failed: failed.length,
				total: messageIds.length,
				aborted: connectionLost,
			},
			"Body sync complete",
		);

		return {
			syncedCount: synced.length,
			syncedMessageIds: synced.map((r) => r.messageId),
			skippedCount: skipped.length,
			failedCount: failed.length,
			failedMessageIds: failed.map((r) => r.messageId),
		};
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

	private async fetchAndStoreBody(
		messageId: string,
		accountId: string,
		accountConfigId: string,
		mailboxPath: string,
		getConnection: ConnectionGetter,
	): Promise<{ status: "synced"; messageId: string } | { status: "skipped" }> {
		const message = await this.messageService.get(messageId);

		if (message.bodyStorageKey) {
			this.log.debug?.({ messageId }, "Body already stored, skipping");
			return { status: "skipped" };
		}

		const connection = await getConnection();
		await connection.openBox(mailboxPath);

		const body = await connection.fetchMessageBody(message.uid);
		const ref = await this.storageService.storeMessageBody({
			accountConfigId,
			accountId,
			messageId,
			content: body,
		});

		await this.messageService.update(messageId, { bodyStorageKey: ref.uri });
		this.log.info({ messageId, storageKey: ref.uri }, "Body stored");

		// Extract snippet and update thread entities
		const parsed = await this.updateSnippets(messageId, accountConfigId, body);

		// Header-based classification + From-Address engagement counters.
		// Counters drift under at-least-once SQS — accepted residual per EDD #232.
		await this.classifyAndCount(messageId, accountConfigId, parsed);

		// Write the parsed-body cache alongside the raw .eml so subsequent
		// describeMessage reads can skip mailparser entirely.
		await this.storeParsedBodyCache(
			accountConfigId,
			accountId,
			messageId,
			parsed,
		);

		// Per-part S3 objects so `BodyPartResponse.contentUrl` (#298) actually
		// resolves on the SPA. Each non-multipart leaf gets its own
		// `accounts/{accountConfigId}/{accountId}/messages/{messageId}/parts/{partPath}`
		// object. Failures crash the body-sync — broken inline images would
		// otherwise be invisible to operators.
		await this.storeBodyPartContents(
			accountConfigId,
			accountId,
			messageId,
			parsed,
		);

		return { status: "synced", messageId };
	}

	private async classifyAndCount(
		messageId: string,
		accountConfigId: string,
		parsed: ParsedMail,
	): Promise<void> {
		const category = classifyByHeaders(parsed);
		await this.messageService.update(messageId, { category });

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

	/**
	 * Persist one S3 object per non-multipart leaf so the SPA can resolve
	 * `BodyPartResponse.contentUrl` (#298). Keys follow the layout
	 * `accounts/{accountConfigId}/{accountId}/messages/{messageId}/parts/{partPath}`
	 * so they line up with the URL shape `derive/contentUrl.ts` emits.
	 *
	 * The mapper throws if any leaf can't be resolved against `parsed`; we
	 * propagate that — silent skips would mean the SPA hits a 404 on a
	 * `cid:`-rewritten image and the user sees a broken icon.
	 *
	 * If `listBodyParts` returns an empty list (e.g. a legacy message synced
	 * before #133 populated BodyPart rows), this is a no-op — `bodyParts: []`
	 * upstream means the cid-resolver doesn't fire, so no 404 risk.
	 */
	private async storeBodyPartContents(
		accountConfigId: string,
		accountId: string,
		messageId: string,
		parsed: ParsedMail,
	): Promise<void> {
		const bodyParts = await this.envelopeService.listBodyParts(messageId);
		if (bodyParts.length === 0) {
			this.log.debug?.(
				{ messageId },
				"No BodyPart rows; skipping per-part storage",
			);
			return;
		}

		const mapped = mapBodyPartsToContent(bodyParts, parsed);
		if (mapped.length === 0) return;

		await pMap(
			mapped,
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

		this.log.info?.(
			{ messageId, partCount: mapped.length },
			"Body parts stored",
		);
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

		// Update ThreadMessage snippet
		await this.threadMessageService.update(
			accountConfigId,
			threadMessage.threadMessageId,
			{ snippet },
		);

		this.log.debug?.(
			{ messageId, snippetLength: snippet.length },
			"Snippet updated",
		);

		return parsed;
	}
}
