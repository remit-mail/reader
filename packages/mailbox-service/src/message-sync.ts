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
	 * Thread ID is derived from the root Message-ID:
	 * - If inReplyTo exists, use it as the thread root (message is a reply)
	 * - Otherwise, use messageId as the thread root (message starts a new thread)
	 */
	private async createThreadForMessage(
		messageId: string,
		mailboxId: string,
		accountConfigId: string,
		uid: number,
		internalDate: number,
		envelope: ImapEnvelope,
	): Promise<void> {
		// Derive root Message-ID for thread grouping
		const rootMessageIdHeader = envelope.inReplyTo || envelope.messageId;
		if (!rootMessageIdHeader) {
			// Cannot create thread without Message-ID
			return;
		}

		const threadId = ThreadService.deriveThreadId(
			accountConfigId,
			rootMessageIdHeader,
		);

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
				unreadCount: existingThread.unreadCount + 1, // Assume new messages are unread
				hasUnread: true,
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
				unreadCount: 1,
				hasUnread: true,
				hasAttachments: false,
				hasStars: false,
				mailboxIds: [mailboxId],
				firstMessageAt: dateValue,
				lastMessageAt: dateValue,
			});
		}

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
				referenceOrder: envelope.inReplyTo ? 1 : 0,
				fromEmail,
				fromName,
				subject: envelope.subject,
				internalDate,
				isRead: false,
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
