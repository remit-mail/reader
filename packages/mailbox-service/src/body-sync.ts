import { appendFileSync } from "node:fs";
import type {
	MessageService,
	ThreadMessageService,
} from "@remit/remit-electrodb-service";
import type { StorageService } from "@remit/storage-service";
import { simpleParser } from "mailparser";
import { extractSnippetFromEmail } from "./snippet.js";
import type { IImapConnection } from "./types.js";

// Debug log to file (Ink overwrites console)
const debugLog = (msg: string, data?: unknown) => {
	const line = `[${new Date().toISOString()}] ${msg} ${data ? JSON.stringify(data) : ""}\n`;
	try {
		appendFileSync("/tmp/body-sync-debug.log", line);
	} catch {
		// ignore
	}
};

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

		debugLog("fetchAndGetBody", {
			messageId,
			hasBodyStorageKey: !!message.bodyStorageKey,
			bodyStorageKey: message.bodyStorageKey,
		});

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

		if (needsStore) {
			const ref = await this.storageService.storeMessageBody({
				accountId,
				messageId,
				content: body,
			});

			debugLog("Storing body", { messageId, uri: ref.uri });
			await this.messageService.update(messageId, {
				bodyStorageKey: ref.uri,
			});
			this.log.info?.({ messageId, storageKey: ref.uri }, "Body stored");

			// Update snippets for thread entities
			await this.updateSnippets(messageId, accountConfigId, body);
		} else {
			debugLog("Retrieved from storage", {
				messageId,
				bodyStorageKey: message.bodyStorageKey,
			});
		}

		// Parse and return content
		const parsed = await simpleParser(body);
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
			accountId,
			messageId,
			content: body,
		});

		await this.messageService.update(messageId, { bodyStorageKey: ref.uri });
		this.log.info({ messageId, storageKey: ref.uri }, "Body stored");

		// Extract snippet and update thread entities
		await this.updateSnippets(messageId, accountConfigId, body);

		return { status: "synced", messageId };
	}

	/**
	 * Extract snippet from message body and update ThreadMessage.
	 */
	private async updateSnippets(
		messageId: string,
		accountConfigId: string,
		body: Buffer,
	): Promise<void> {
		// Parse the email body
		const parsed = await simpleParser(body);

		// Extract snippet from text or HTML content
		const snippet = extractSnippetFromEmail(
			parsed.text,
			typeof parsed.html === "string" ? parsed.html : undefined,
			256,
		);

		if (!snippet) {
			return;
		}

		// Get the message to find its messageIdHeader
		const message = await this.messageService.get(messageId);
		if (!message.messageIdHeader) {
			this.log.debug?.(
				{ messageId },
				"No messageIdHeader, skipping snippet update",
			);
			return;
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
	}
}
