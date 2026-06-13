import {
	AddressService,
	type BodyPartUpsertInput,
	deriveBodyPartId,
	EnvelopeService,
	type MailboxService,
	MessageService,
	ThreadMessageService,
} from "@remit/remit-electrodb-service";
import { AddressRole } from "@remit/domain-enums";
import pMap from "p-map";
import type { ManagedConnectionFactory } from "./connection-factory.js";
import { ROOT_PART_PATH, walkMimeStructure } from "./mime-walker.js";
import type {
	ImapAddress,
	ImapBodyStructure,
	ImapEnvelope,
	ImapMessage,
} from "./types.js";

const MESSAGE_SAVE_CONCURRENCY = 10;
const ADDRESS_SAVE_CONCURRENCY = 10;

/**
 * @deprecated Use ManagedConnectionFactory instead
 */
export type ImapConnectionFactory = () => {
	connect(): Promise<void>;
	disconnect(): Promise<void>;
};

export interface SyncLogger {
	info(obj: Record<string, unknown>, msg: string): void;
}

const noopLogger: SyncLogger = {
	info: () => {},
};

export interface SyncedMessage {
	messageId: string;
	uid: number;
}

export interface SyncMessagesResult {
	syncedCount: number;
	syncedMessageIds: string[];
	syncedMessages: SyncedMessage[];
	hasMore: boolean;
	remainingCount: number;
}

export class MessageSyncService {
	private log: SyncLogger;

	constructor(
		private connectionFactory: ManagedConnectionFactory,
		private mailboxService: MailboxService,
		private messageService: MessageService,
		private envelopeService: EnvelopeService,
		private addressService: AddressService,
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

		const { box, unseenCount, uids } = await this.fetchUidsToSync(
			mailboxPath,
			lastSyncUid,
			highWaterMarkUid,
		);

		if (uids.length === 0) {
			// Still update counts even if no new messages to sync
			await this.mailboxService.update(mailboxId, {
				lastMessageSyncAt: Date.now(),
				uidValidity: box.uidvalidity,
				messageCount: box.messageCount,
				unseenCount,
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

		// Process messages in parallel with concurrency limit
		const results = await pMap(
			messages,
			(msg) => this.saveMessage(mailboxId, accountConfigId, msg),
			{ concurrency: MESSAGE_SAVE_CONCURRENCY },
		);
		const syncedMessages = results.filter(
			(result): result is SyncedMessage => result !== null,
		);
		const syncedMessageIds = syncedMessages.map((m) => m.messageId);

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
			messageCount: box.messageCount,
			unseenCount,
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

	private async saveMessage(
		mailboxId: string,
		accountConfigId: string,
		msg: ImapMessage,
	): Promise<SyncedMessage | null> {
		if (!msg.envelope) return null;

		// Store envelope to preserve narrowing in closures
		const envelope = msg.envelope;

		const messageId = MessageService.generateIdFromSource(accountConfigId, {
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
		const sentDate = new Date(envelope.date).getTime();

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

		// Run all entity saves in parallel with concurrency limit
		const saveOps: Array<() => Promise<void>> = [
			// Save Envelope
			async () => {
				await this.envelopeService.upsertEnvelope({
					envelopeId,
					messageId,
					dateValue: new Date(envelope.date).getTime(),
					dateRaw: envelope.date,
					subject: envelope.subject,
					messageIdValue: envelope.messageId,
				});
			},
			// Save all address roles in parallel
			...addressOps.map(({ addresses, role }) => async () => {
				await this.saveAddresses(messageId, accountConfigId, addresses, role);
			}),
			// Save Message
			async () => {
				await this.messageService.upsert({
					messageId,
					mailboxId,
					uid: msg.uid,
					sequenceNumber: msg.seq,
					rfc822Size: msg.size ?? 0,
					internalDate: msg.internalDate.getTime(),
					envelopeId,
					rootBodyPartId,
				});
			},
			// Save BodyPart + BodyPartParameter rows for the MIME tree.
			// IMAP returns BODYSTRUCTURE in the same FETCH that returns the
			// envelope, so this is "free" — no extra round-trip.
			async () => {
				if (bodyParts.length === 0) return;
				await this.envelopeService.upsertBodyParts(messageId, bodyParts);
			},
			// Create Thread and ThreadMessage
			async () => {
				await this.createThreadForMessage(
					messageId,
					mailboxId,
					accountConfigId,
					msg.uid,
					msg.internalDate.getTime(),
					sentDate,
					envelope,
					msg.flags,
					msg.references,
					hasAttachment,
				);
			},
		];

		await pMap(saveOps, (op) => op(), {
			concurrency: ADDRESS_SAVE_CONCURRENCY,
		});

		return { messageId, uid: msg.uid };
	}

	private async saveAddresses(
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
			if (!addr.mailbox || !addr.host) continue;
			addressData.push({
				localPart: addr.mailbox,
				domain: addr.host,
				displayName: addr.name || "",
				order: i,
			});
		}

		// Save all addresses in parallel with concurrency limit
		await pMap(
			addressData,
			async ({ localPart, domain, displayName, order }) => {
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

				// Both upserts can run in parallel
				const ops: Array<() => Promise<void>> = [
					async () => {
						await this.addressService.upsertAddress({
							addressId,
							accountConfigId,
							localPart,
							domain,
							normalizedEmail,
							normalizedCompound,
							displayName,
						});
					},
					async () => {
						await this.addressService.upsertEnvelopeAddress({
							envelopeAddressId,
							messageId,
							addressId,
							displayName,
							normalizedEmail,
							addressRole: role,
							addressOrder: order,
						});
					},
				];

				await pMap(ops, (op) => op(), { concurrency: 2 });
			},
			{ concurrency: ADDRESS_SAVE_CONCURRENCY },
		);
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
		} else if (envelope.messageId) {
			// No References, no In-Reply-To - this message is a thread root
			rootMessageIdHeader = envelope.messageId;
		} else {
			// Cannot create thread without Message-ID
			return;
		}

		// Derive threadId from the root Message-ID (deterministic)
		const threadId = ThreadMessageService.deriveThreadId(
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
