import type {
	AccountConfigService,
	AccountExportRequestService,
	AccountService,
	AccountSettingService,
	AddressService,
	EnvelopeService,
	MailboxLockService,
	MailboxService,
	MessageFlagService,
	MessageService,
	OutboxMessageService,
	ThreadMessageService,
} from "@remit/remit-electrodb-service";
import type { Logger } from "@remit/logger-lambda";

export interface CascadeEntity {
	entityType: string;
	key: Record<string, string>;
}

export interface CascadeServices {
	accountConfigService: AccountConfigService;
	accountService: AccountService;
	addressService: AddressService;
	mailboxService: MailboxService;
	messageService: MessageService;
	envelopeService: EnvelopeService;
	messageFlagService: MessageFlagService;
	outboxMessageService: OutboxMessageService;
	threadMessageService: ThreadMessageService;
	mailboxLockService: MailboxLockService;
	accountExportRequestService: AccountExportRequestService;
	accountSettingService: AccountSettingService;
}

export interface CascadeResult {
	entities: CascadeEntity[];
	messageIds: string[];
}

/**
 * Expand one message's 9 child entities (flags, envelope, addresses, body
 * parts, references, raw/body storage) into the cascade plan. The Message row
 * itself is pushed by the caller — this only collects the children that a
 * `describe()` reveals. Shared by the tenant cascade enumerator and the
 * per-account purge worker.
 */
export const collectMessageChildEntities = (
	entities: CascadeEntity[],
	messageData: Awaited<ReturnType<MessageService["describe"]>>,
): void => {
	for (const flag of messageData.messageFlag) {
		entities.push({
			entityType: "MessageFlag",
			key: { messageFlagId: flag.messageFlagId },
		});
	}
	for (const envelope of messageData.envelope) {
		entities.push({
			entityType: "Envelope",
			key: { envelopeId: envelope.envelopeId },
		});
	}
	for (const ref of messageData.messageReference) {
		entities.push({
			entityType: "MessageReference",
			key: { messageReferenceId: ref.messageReferenceId },
		});
	}
	for (const addr of messageData.envelopeAddress) {
		entities.push({
			entityType: "EnvelopeAddress",
			key: { envelopeAddressId: addr.envelopeAddressId },
		});
	}
	for (const bp of messageData.bodyPart) {
		entities.push({
			entityType: "BodyPart",
			key: { bodyPartId: bp.bodyPartId },
		});
	}
	for (const bpp of messageData.bodyPartParameter) {
		entities.push({
			entityType: "BodyPartParameter",
			key: { bodyPartParameterId: bpp.bodyPartParameterId },
		});
	}
	for (const rms of messageData.rawMessageStorage) {
		entities.push({
			entityType: "RawMessageStorage",
			key: { rawStorageId: rms.rawStorageId },
		});
	}
	for (const bps of messageData.bodyPartStorage) {
		entities.push({
			entityType: "BodyPartStorage",
			key: { bodyPartStorageId: bps.bodyPartStorageId },
		});
	}
	for (const bpc of messageData.bodyPartContent) {
		entities.push({
			entityType: "BodyPartContent",
			key: { bodyPartContentId: bpc.bodyPartContentId },
		});
	}
};

export const enumerateCascadeEntities = async (
	accountConfigId: string,
	services: CascadeServices,
	log: Logger,
): Promise<CascadeResult> => {
	const entities: CascadeEntity[] = [];
	const messageIds: string[] = [];

	const {
		accountConfigService,
		accountService,
		messageService,
		outboxMessageService,
		threadMessageService,
		mailboxLockService,
		accountSettingService,
	} = services;

	const description = await accountConfigService.describe(accountConfigId);

	for (const account of description.account) {
		entities.push({
			entityType: "Account",
			key: { accountId: account.accountId },
		});

		const accountDescription = await accountService.describe(account.accountId);

		for (const mailbox of accountDescription.mailbox) {
			entities.push({
				entityType: "Mailbox",
				key: { mailboxId: mailbox.mailboxId },
			});

			const messages = await messageService.listAllByMailbox(mailbox.mailboxId);

			for (const message of messages) {
				messageIds.push(message.messageId);
				entities.push({
					entityType: "Message",
					key: { messageId: message.messageId },
				});

				const messageData = await messageService.describe(message.messageId);

				for (const flag of messageData.messageFlag) {
					entities.push({
						entityType: "MessageFlag",
						key: { messageFlagId: flag.messageFlagId },
					});
				}

				for (const envelope of messageData.envelope) {
					entities.push({
						entityType: "Envelope",
						key: { envelopeId: envelope.envelopeId },
					});
				}

				for (const ref of messageData.messageReference) {
					entities.push({
						entityType: "MessageReference",
						key: { messageReferenceId: ref.messageReferenceId },
					});
				}

				for (const addr of messageData.envelopeAddress) {
					entities.push({
						entityType: "EnvelopeAddress",
						key: { envelopeAddressId: addr.envelopeAddressId },
					});
				}

				for (const bp of messageData.bodyPart) {
					entities.push({
						entityType: "BodyPart",
						key: { bodyPartId: bp.bodyPartId },
					});
				}

				for (const bpp of messageData.bodyPartParameter) {
					entities.push({
						entityType: "BodyPartParameter",
						key: { bodyPartParameterId: bpp.bodyPartParameterId },
					});
				}

				for (const rms of messageData.rawMessageStorage) {
					entities.push({
						entityType: "RawMessageStorage",
						key: { rawStorageId: rms.rawStorageId },
					});
				}

				for (const bps of messageData.bodyPartStorage) {
					entities.push({
						entityType: "BodyPartStorage",
						key: { bodyPartStorageId: bps.bodyPartStorageId },
					});
				}

				for (const bpc of messageData.bodyPartContent) {
					entities.push({
						entityType: "BodyPartContent",
						key: { bodyPartContentId: bpc.bodyPartContentId },
					});
				}
			}
		}

		const outboxMessages = await outboxMessageService.listByAccount(
			account.accountId,
		);
		for (const outbox of outboxMessages.items) {
			entities.push({
				entityType: "OutboxMessage",
				key: { outboxMessageId: outbox.outboxMessageId },
			});
		}

		const locks = await mailboxLockService.listByAccount(account.accountId);
		for (const lock of locks) {
			entities.push({
				entityType: "MailboxLock",
				key: { mailboxId: lock.mailboxId, eventName: lock.eventName },
			});
		}
	}

	const threadMessages =
		await threadMessageService.listAllByAccount(accountConfigId);
	for (const tm of threadMessages) {
		entities.push({
			entityType: "ThreadMessage",
			key: { accountConfigId, threadMessageId: tm.threadMessageId },
		});
	}

	const accountSettings =
		await accountSettingService.listByAccountConfig(accountConfigId);
	for (const setting of accountSettings) {
		entities.push({
			entityType: "AccountSetting",
			key: { accountSettingId: setting.accountSettingId },
		});
	}

	for (const address of description.address) {
		entities.push({
			entityType: "Address",
			key: { addressId: address.addressId },
		});
	}

	entities.push({
		entityType: "AccountConfig",
		key: { accountConfigId },
	});

	log.info(
		{
			accountConfigId,
			entityCount: entities.length,
			messageCount: messageIds.length,
		},
		"Cascade enumeration complete",
	);

	return { entities, messageIds };
};

export const COVERED_ENTITY_TYPES = [
	"Account",
	"AccountConfig",
	"AccountSetting",
	"Address",
	"BodyPart",
	"BodyPartContent",
	"BodyPartParameter",
	"BodyPartStorage",
	"Envelope",
	"EnvelopeAddress",
	"Mailbox",
	"MailboxLock",
	"Message",
	"MessageFlag",
	"MessageReference",
	"OutboxMessage",
	"RawMessageStorage",
	"ThreadMessage",
] as const;
