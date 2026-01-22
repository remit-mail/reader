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

export class MessageSyncService {
	constructor(
		private createConnection: ImapConnectionFactory,
		private mailboxService: MailboxService,
		private messageService: MessageService,
		private envelopeService: EnvelopeService,
		private addressService: AddressService,
	) {}

	async syncMessages(
		mailboxId: string,
		accountConfigId: string,
		batchSize = 50,
	): Promise<number> {
		// 1. Get mailbox from DB to check lastSyncUid
		const mailbox = await this.mailboxService.get(mailboxId);
		if (!mailbox) {
			throw new Error(`Mailbox ${mailboxId} not found`);
		}

		// 2. Fetch UIDs from IMAP using a fresh connection
		// Creating a new connection for each IMAP operation avoids IDLE issues
		const { box, uids } = await this.fetchUidsToSync(
			mailbox.fullPath,
			mailbox.lastSyncUid || 0,
		);

		if (uids.length === 0) {
			return 0;
		}

		// 3. Process in batches, each batch uses a fresh connection
		let syncedCount = 0;
		for (let i = 0; i < uids.length; i += batchSize) {
			const batchUids = uids.slice(i, i + batchSize);
			const messages = await this.fetchMessageBatch(
				mailbox.fullPath,
				batchUids,
			);

			for (const msg of messages) {
				await this.saveMessage(mailboxId, accountConfigId, msg);
			}

			// Update lastSyncUid
			const maxUid = Math.max(...batchUids);
			await this.mailboxService.update(mailboxId, {
				lastSyncUid: maxUid,
				lastMessageSyncAt: Date.now(),
				uidValidity: box.uidvalidity,
			});

			syncedCount += messages.length;
		}

		return syncedCount;
	}

	/**
	 * Fetch UIDs to sync using a fresh connection.
	 * Opens mailbox, searches for all UIDs, filters by lastSyncUid.
	 */
	private async fetchUidsToSync(
		mailboxPath: string,
		lastSyncUid: number,
	): Promise<{
		box: { uidvalidity: number; uidnext: number };
		uids: number[];
	}> {
		const connection = this.createConnection();
		try {
			await connection.connect();
			const box = await connection.openBox(mailboxPath);

			// If we are up to date, skip
			if (lastSyncUid >= box.uidnext - 1) {
				return { box, uids: [] };
			}

			// Use SEARCH ALL and filter client-side (workaround for mokapi bug with UID range syntax)
			const allUids = await connection.search(["ALL"]);
			const uids = allUids.filter((uid) => uid > lastSyncUid);

			return { box, uids };
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

		const messageIdHeader =
			msg.envelope.messageId || `no-id-${msg.uid}-${mailboxId}`;
		const messageId = MessageService.generateId(messageIdHeader);
		const envelopeId = EnvelopeService.generateId(messageId);

		// Save Envelope
		try {
			await this.envelopeService.createEnvelope({
				envelopeId,
				messageId,
				dateValue: new Date(msg.envelope.date).getTime(),
				dateRaw: msg.envelope.date,
				subject: msg.envelope.subject,
				messageIdValue: msg.envelope.messageId,
			});
		} catch (e: unknown) {
			if (
				(e as { name?: string })?.name !== "ConditionalCheckFailedException"
			) {
				console.error("Failed to create envelope", e);
			}
		}

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
		try {
			// Generate a placeholder rootBodyPartId - will be updated when body parts are synced
			const rootBodyPartId = base36uuidv5(
				`bodypart:${messageId}:root`,
				REMIT_NAMESPACE,
			);
			await this.messageService.create({
				messageId,
				mailboxId,
				uid: msg.uid,
				sequenceNumber: msg.seq,
				rfc822Size: msg.size ?? 0, // Some IMAP servers don't return size
				internalDate: msg.internalDate.getTime(),
				envelopeId,
				rootBodyPartId,
			});
		} catch (e: unknown) {
			if (
				(e as { name?: string })?.name !== "ConditionalCheckFailedException"
			) {
				console.error("Failed to create message", e);
			}
		}

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

			try {
				await this.addressService.createAddress({
					addressId,
					accountConfigId,
					localPart,
					domain,
					normalizedEmail,
					normalizedCompound,
					displayName,
				});
			} catch (e: unknown) {
				if (
					(e as { name?: string })?.name !== "ConditionalCheckFailedException"
				) {
					console.error("Failed to create address", e);
				}
			}

			const envelopeAddressId = AddressService.generateEnvelopeAddressId(
				messageId,
				role,
				order,
			);

			try {
				await this.addressService.createEnvelopeAddress({
					envelopeAddressId,
					messageId,
					addressId,
					displayName,
					addressRole: role,
					addressOrder: order++,
				});
			} catch (e: unknown) {
				if (
					(e as { name?: string })?.name !== "ConditionalCheckFailedException"
				) {
					console.error("Failed to create envelope address", e);
				}
			}
		}
	}
}
