import {
	AddressService,
	EnvelopeService,
	type MailboxService,
	MessageService,
} from "@remit/remit-electrodb-service";
import { AddressRole } from "@remit/domain-enums";
import { v4 as uuidv4 } from "uuid";
import type { ImapConnection } from "./imap-connection.js";
import type { ImapAddress, ImapMessage } from "./types.js";

export class MessageSyncService {
	constructor(
		private imap: ImapConnection,
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

		// 2. Open mailbox in IMAP
		const box = await this.imap.openBox(mailbox.fullPath);

		// Check UIDVALIDITY
		if (mailbox.uidValidity && mailbox.uidValidity !== box.uidvalidity) {
			console.warn(
				`UIDVALIDITY changed for ${mailbox.fullPath}. Full resync required.`,
			);
			// TODO: Handle UIDVALIDITY change (invalidate cache)
		}

		const lastSyncUid = mailbox.lastSyncUid || 0;
		const uidNext = box.uidnext;

		// If we are up to date (or close enough), skip
		// Note: uidNext is the *next* UID to be assigned, so if lastSyncUid == uidNext - 1, we are good.
		if (lastSyncUid >= uidNext - 1) {
			return 0;
		}

		// 3. Fetch UIDs in range
		// Range: lastSyncUid + 1 : *
		// We use search to get actual UIDs
		const uids = await this.imap.search([["UID", `${lastSyncUid + 1}:*`]]);

		if (uids.length === 0) {
			// Update lastSyncUid to current max just in case?
			// No, if no UIDs found, maybe they were deleted or gap.
			return 0;
		}

		// 4. Process in batches
		let syncedCount = 0;
		for (let i = 0; i < uids.length; i += batchSize) {
			const batchUids = uids.slice(i, i + batchSize);
			const messages = await this.imap.fetchMessages(batchUids);

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
		} catch (e: any) {
			if (e.name !== "ConditionalCheckFailedException") {
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
			await this.messageService.create({
				messageId,
				mailboxId,
				uid: msg.uid,
				sequenceNumber: msg.seq,
				rfc822Size: msg.size,
				internalDate: msg.internalDate.getTime(),
				envelopeId,
				rootBodyPartId: uuidv4(), // Placeholder
			});
		} catch (e: any) {
			if (e.name !== "ConditionalCheckFailedException") {
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
			} catch (e: any) {
				if (e.name !== "ConditionalCheckFailedException") {
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
			} catch (e: any) {
				if (e.name !== "ConditionalCheckFailedException") {
					console.error("Failed to create envelope address", e);
				}
			}
		}
	}
}
