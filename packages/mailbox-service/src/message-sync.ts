import {
	AddressService,
	base36uuidv5,
	EnvelopeService,
	type MailboxService,
	MessageService,
	REMIT_NAMESPACE,
} from "@remit/remit-electrodb-service";
import { AddressRole } from "@remit/domain-enums";
import type { IImapConnection, ImapAddress, ImapMessage } from "./types.js";

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

export class MessageSyncService {
	private log: SyncLogger;

	constructor(
		private createConnection: ImapConnectionFactory,
		private mailboxService: MailboxService,
		private messageService: MessageService,
		private envelopeService: EnvelopeService,
		private addressService: AddressService,
		logger?: SyncLogger,
	) {
		this.log = logger ?? noopLogger;
	}

	/**
	 * Sync messages for a mailbox using newest-first strategy.
	 *
	 * Uses dual-watermark tracking:
	 * - highWaterMarkUid: highest UID ever seen (detects new messages)
	 * - lastSyncUid: lowest UID processed (tracks backfill progress)
	 *
	 * @param mailboxId - The database mailbox ID
	 * @param accountConfigId - The account config ID (used for address linking)
	 * @param batchSize - Number of messages to process per batch
	 */
	async syncMessages(
		mailboxId: string,
		accountConfigId: string,
		batchSize = 50,
	): Promise<number> {
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
			return 0;
		}

		const totalBatches = Math.ceil(uids.length / batchSize);
		this.log.info(
			{ mailboxId, mailboxPath, total: uids.length, batches: totalBatches },
			"Starting message sync (newest first)",
		);

		let syncedCount = 0;
		let batchNumber = 0;
		let currentHighWaterMark = highWaterMarkUid;
		let currentLastSyncUid = lastSyncUid;

		for (let i = 0; i < uids.length; i += batchSize) {
			batchNumber++;
			const batchUids = uids.slice(i, i + batchSize);
			const messages = await this.fetchMessageBatch(mailboxPath, batchUids);

			for (const msg of messages) {
				await this.saveMessage(mailboxId, accountConfigId, msg);
			}

			// Update watermarks
			const batchMax = Math.max(...batchUids);
			const batchMin = Math.min(...batchUids);

			currentHighWaterMark = Math.max(currentHighWaterMark, batchMax);

			// Update lastSyncUid only for backfill UIDs (below current lastSyncUid or fresh sync)
			if (currentLastSyncUid === 0 || batchMin < currentLastSyncUid) {
				currentLastSyncUid = batchMin;
			}

			await this.mailboxService.update(mailboxId, {
				lastSyncUid: currentLastSyncUid,
				highWaterMarkUid: currentHighWaterMark,
				lastMessageSyncAt: Date.now(),
				uidValidity: box.uidvalidity,
			});

			syncedCount += messages.length;

			this.log.info(
				{
					batch: batchNumber,
					totalBatches,
					batchSize: messages.length,
					synced: syncedCount,
					total: uids.length,
					highWaterMarkUid: currentHighWaterMark,
					lastSyncUid: currentLastSyncUid,
				},
				"Batch complete",
			);
		}

		return syncedCount;
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
	) {
		if (!msg.envelope) return;

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
				addressRole: role,
				addressOrder: order++,
			});
		}
	}
}
