import {
	AddressService,
	base36uuidv5,
	EnvelopeService,
	type MailboxService,
	MessageService,
	REMIT_NAMESPACE,
	type ThreadMessageService,
	ThreadService,
} from "@remit/remit-electrodb-service";
import { AddressRole } from "@remit/domain-enums";
import { normalizeSubject } from "./snippet.js";
import type {
	IImapConnection,
	ImapAddress,
	ImapEnvelope,
	ImapMessage,
} from "./types.js";

/**
 * Factory function to create IMAP connections.
 * Each call should return a fresh, unconnected connection.
 */
export type ImapConnectionFactory = () => IImapConnection;

export interface SyncLogger {
	info(obj: Record<string, unknown>, msg: string): void;
}

const noopLogger: SyncLogger = {
	info: () => {},
};

export interface SyncMessagesResult {
	syncedCount: number;
	syncedMessageIds: string[];
	hasMore: boolean;
	remainingCount: number;
}

export class MessageSyncService {
	private log: SyncLogger;

	constructor(
		private createConnection: ImapConnectionFactory,
		private mailboxService: MailboxService,
		private messageService: MessageService,
		private envelopeService: EnvelopeService,
		private addressService: AddressService,
		private threadService: ThreadService,
		private threadMessageService: ThreadMessageService,
		logger?: SyncLogger,
	) {
		this.log = logger ?? noopLogger;
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
	 * @param accountConfigId - The account config ID (used for address linking)
	 * @param batchSize - Number of messages to process per batch
	 */
	async syncMessages(
		mailboxId: string,
		accountConfigId: string,
		batchSize = 50,
	): Promise<SyncMessagesResult> {
		const mailbox = await this.mailboxService.get(mailboxId);
		const mailboxPath = mailbox.fullPath;
		const lastSyncUid = mailbox.lastSyncUid || 0;
		const highWaterMarkUid = mailbox.highWaterMarkUid || 0;

		const { box, uids } = await this.fetchUidsToSync(
			mailboxPath,
			lastSyncUid,
			highWaterMarkUid,
		);

		if (uids.length === 0) {
			this.log.info(
				{ mailboxId, mailboxPath, total: 0 },
				"No new messages to sync",
			);
			return {
				syncedCount: 0,
				syncedMessageIds: [],
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
		const messages = await this.fetchMessageBatch(mailboxPath, batchUids);
		const syncedMessageIds: string[] = [];

		for (const msg of messages) {
			const messageId = await this.saveMessage(mailboxId, accountConfigId, msg);
			if (messageId) {
				syncedMessageIds.push(messageId);
			}
		}

		// Update watermarks
		const batchMax = Math.max(...batchUids);
		const batchMin = Math.min(...batchUids);

		const newHighWaterMark = Math.max(highWaterMarkUid, batchMax);

		// Update lastSyncUid only for backfill UIDs (below current lastSyncUid or fresh sync)
		const newLastSyncUid =
			lastSyncUid === 0 || batchMin < lastSyncUid ? batchMin : lastSyncUid;

		await this.mailboxService.update(mailboxId, {
			lastSyncUid: newLastSyncUid,
			highWaterMarkUid: newHighWaterMark,
			lastMessageSyncAt: Date.now(),
			uidValidity: box.uidvalidity,
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
			hasMore,
			remainingCount,
		};
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
		box: { uidvalidity: number; uidnext: number };
		uids: number[];
	}> {
		const connection = this.createConnection();
		try {
			await connection.connect();
			const box = await connection.openBox(mailboxPath);

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

			return { box, uids: uidsToSync };
		} finally {
			await connection.disconnect();
		}
	}

	/**
	 * Fetch a batch of messages using a fresh connection.
	 */
	private async fetchMessageBatch(
		mailboxPath: string,
		uids: number[],
	): Promise<ImapMessage[]> {
		const connection = this.createConnection();
		try {
			await connection.connect();
			await connection.openBox(mailboxPath);
			console.log(`Fetching messages: ${mailboxPath}${uids.join(", ")}`);
			return await connection.fetchMessages(uids);
		} finally {
			await connection.disconnect();
		}
	}

	private async saveMessage(
		mailboxId: string,
		accountConfigId: string,
		msg: ImapMessage,
	): Promise<string | null> {
		if (!msg.envelope) return null;

		const messageId = MessageService.generateIdFromSource(accountConfigId, {
			messageId: msg.envelope.messageId,
			uid: msg.uid,
			mailboxId,
			date: msg.envelope.date,
			subject: msg.envelope.subject,
			fromMailbox: msg.envelope.from?.[0]?.mailbox,
			fromHost: msg.envelope.from?.[0]?.host,
		});
		const envelopeId = EnvelopeService.generateId(messageId);

		// Save Envelope
		await this.envelopeService.upsertEnvelope({
			envelopeId,
			messageId,
			dateValue: new Date(msg.envelope.date).getTime(),
			dateRaw: msg.envelope.date,
			subject: msg.envelope.subject,
			messageIdValue: msg.envelope.messageId,
		});

		// Save Addresses
		await this.saveAddresses(
			messageId,
			accountConfigId,
			msg.envelope.from,
			AddressRole.From,
		);
		await this.saveAddresses(
			messageId,
			accountConfigId,
			msg.envelope.sender,
			AddressRole.Sender,
		);
		await this.saveAddresses(
			messageId,
			accountConfigId,
			msg.envelope.replyTo,
			AddressRole.ReplyTo,
		);
		await this.saveAddresses(
			messageId,
			accountConfigId,
			msg.envelope.to,
			AddressRole.To,
		);
		await this.saveAddresses(
			messageId,
			accountConfigId,
			msg.envelope.cc,
			AddressRole.Cc,
		);
		await this.saveAddresses(
			messageId,
			accountConfigId,
			msg.envelope.bcc,
			AddressRole.Bcc,
		);

		// Save Message
		// Generate a placeholder rootBodyPartId - will be updated when body parts are synced
		const rootBodyPartId = base36uuidv5(
			`bodypart:${messageId}:root`,
			REMIT_NAMESPACE,
		);
		await this.messageService.upsert({
			messageId,
			mailboxId,
			uid: msg.uid,
			sequenceNumber: msg.seq,
			rfc822Size: msg.size ?? 0, // Some IMAP servers don't return size
			internalDate: msg.internalDate.getTime(),
			envelopeId,
			rootBodyPartId,
		});

		// TODO: Save Flags

		// Create Thread and ThreadMessage
		await this.createThreadForMessage(
			messageId,
			mailboxId,
			accountConfigId,
			msg.uid,
			msg.internalDate.getTime(),
			msg.envelope,
			msg.flags,
			msg.references,
		);

		return messageId;
	}

	private async saveAddresses(
		messageId: string,
		accountConfigId: string,
		addresses: ImapAddress[] | undefined,
		role: (typeof AddressRole)[keyof typeof AddressRole],
	) {
		if (!addresses) return;

		let order = 0;
		for (const addr of addresses) {
			if (!addr.mailbox || !addr.host) continue;

			const localPart = addr.mailbox;
			const domain = addr.host;
			const normalizedEmail = `${localPart}@${domain}`.toLowerCase();
			const displayName = addr.name || "";
			const normalizedCompound = `${displayName.toLowerCase()} ${normalizedEmail}`;

			const addressId = AddressService.generateAddressId(
				accountConfigId,
				normalizedEmail,
			);

			await this.addressService.upsertAddress({
				addressId,
				accountConfigId,
				localPart,
				domain,
				normalizedEmail,
				normalizedCompound,
				displayName,
			});

			const envelopeAddressId = AddressService.generateEnvelopeAddressId(
				messageId,
				role,
				order,
			);

			await this.addressService.upsertEnvelopeAddress({
				envelopeAddressId,
				messageId,
				addressId,
				displayName,
				normalizedEmail,
				addressRole: role,
				addressOrder: order++,
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
		messageId: string,
		mailboxId: string,
		accountConfigId: string,
		uid: number,
		internalDate: number,
		envelope: ImapEnvelope,
		flags: string[],
		references?: string[],
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
		} else if (envelope.messageId) {
			// No References, no In-Reply-To - this message is a thread root
			rootMessageIdHeader = envelope.messageId;
		} else {
			// Cannot create thread without Message-ID
			return;
		}

		// Derive threadId from the root Message-ID (deterministic)
		const threadId = ThreadService.deriveThreadId(
			accountConfigId,
			rootMessageIdHeader,
		);

		// Check if message is read based on IMAP flags
		const isRead = flags.includes("\\Seen");

		// Extract sender info
		const fromAddr = envelope.from?.[0];
		const fromEmail = fromAddr
			? `${fromAddr.mailbox}@${fromAddr.host}`.toLowerCase()
			: "";
		const fromName = fromAddr?.name;

		// Parse envelope date
		const dateValue = envelope.date
			? new Date(envelope.date).getTime()
			: internalDate;

		// Check if thread exists
		const existingThread = await this.threadService.findByThreadId(threadId);

		if (existingThread) {
			// Update existing thread aggregates
			const participants = existingThread.participants.includes(fromEmail)
				? existingThread.participants
				: [fromEmail, ...existingThread.participants].slice(0, 50);

			const mailboxIds = existingThread.mailboxIds.includes(mailboxId)
				? existingThread.mailboxIds
				: [...existingThread.mailboxIds, mailboxId];

			await this.threadService.update(accountConfigId, threadId, {
				messageCount: existingThread.messageCount + 1,
				unreadCount: existingThread.unreadCount + (isRead ? 0 : 1),
				hasUnread: existingThread.hasUnread || !isRead,
				participants,
				participantCount: participants.length,
				mailboxIds,
				lastMessageAt: Math.max(existingThread.lastMessageAt, dateValue),
				firstMessageAt: Math.min(existingThread.firstMessageAt, dateValue),
			});
		} else {
			// Create new thread
			await this.threadService.create({
				accountConfigId,
				rootMessageIdHeader,
				subject: envelope.subject,
				subjectNormalized: normalizeSubject(envelope.subject || ""),
				participants: fromEmail ? [fromEmail] : [],
				participantCount: fromEmail ? 1 : 0,
				messageCount: 1,
				unreadCount: isRead ? 0 : 1,
				hasUnread: !isRead,
				hasAttachments: false,
				hasStars: false,
				mailboxIds: [mailboxId],
				firstMessageAt: dateValue,
				lastMessageAt: dateValue,
			});
		}

		// Calculate reference order (position in the thread chain)
		// references.length gives the position since References = [root, parent1, parent2, ...]
		const referenceOrder = references?.length ?? (envelope.inReplyTo ? 1 : 0);

		// Create ThreadMessage linking message to thread
		await this.threadMessageService
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
				isRead,
				hasAttachment: false,
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
