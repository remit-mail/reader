import type {
	AccountConfigService,
	AccountService,
	AddressService,
	EnvelopeService,
	MailboxLockService,
	MailboxService,
	MessageFlagService,
	MessageService,
	OutboxMessageService,
	ThreadMessageService,
} from "@remit/remit-electrodb-service";
import type { Logger } from "pino";

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
}

export interface CascadeResult {
	entities: CascadeEntity[];
	messageIds: string[];
}

/**
 * Cheap fanout-side enumeration: just the account's message ids and mailbox
 * ids, with NO per-message `describe()`. The fanout only needs the message ids
 * (to enqueue search-index vector deletes) and the mailbox set; the destructive
 * child-entity enumeration stays in the finalize worker
 * ({@link enumerateAccountPurgeEntities}).
 */
export interface AccountPurgeMessageSet {
	messageIds: string[];
	mailboxIds: string[];
}

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

/**
 * Fanout-side enumeration for the per-account purge. Returns this account's
 * message ids and mailbox ids using only collection/GSI queries — one
 * `account` collection read for the mailbox set, then one paginated
 * `byMailboxId` GSI scan per mailbox. There is deliberately NO
 * `messageService.describe()` per message: describing ~8,762 messages one by
 * one is what timed out the fanout Lambda (the purge gap; a parked record in
 * remit-dev-account-fanout-dlq). Full child-entity enumeration is the finalize
 * worker's job — see {@link enumerateAccountPurgeEntities} (#632 makes that
 * step chunk-resumable).
 *
 * Scoped to `accountId`: only this account's mailboxes are read, so a sibling
 * account's mailboxes and messages never appear.
 */
export const enumerateAccountPurgeMessageIds = async (
	accountId: string,
	services: Pick<CascadeServices, "accountService" | "messageService">,
	log: Logger,
): Promise<AccountPurgeMessageSet> => {
	const { accountService, messageService } = services;
	const messageIds: string[] = [];
	const mailboxIds: string[] = [];

	const accountDescription = await accountService.describe(accountId);

	for (const mailbox of accountDescription.mailbox) {
		mailboxIds.push(mailbox.mailboxId);

		let cursor: string | undefined;
		do {
			const page = await messageService.listByMailbox(mailbox.mailboxId, {
				continuationToken: cursor,
			});
			for (const message of page.items) {
				messageIds.push(message.messageId);
			}
			cursor = page.continuationToken;
		} while (cursor);
	}

	log.info(
		{
			accountId,
			mailboxCount: mailboxIds.length,
			messageCount: messageIds.length,
		},
		"Per-account purge fanout enumeration complete",
	);

	return { messageIds, mailboxIds };
};

/**
 * Per-account variant of {@link enumerateCascadeEntities}. Walks the graph
 * from ONE accountId and returns only that account's rows — never the
 * AccountConfig, never the shared Address rows, never a sibling account's
 * data. Used by the per-account data-purge cascade so deleting one mail
 * account leaves the tenant and its other accounts intact.
 *
 * Scope discipline: every entity is reached by traversing this account's own
 * mailboxes → messages → children, plus account-scoped outbox/lock lookups.
 * ThreadMessage rows are tenant-partitioned (pk = accountConfigId) but are
 * filtered to this account by querying per mailbox (`listByMailbox`), so a
 * sibling account's threads are never enumerated.
 */
export const enumerateAccountPurgeEntities = async (
	accountConfigId: string,
	accountId: string,
	services: CascadeServices,
	log: Logger,
): Promise<CascadeResult> => {
	const entities: CascadeEntity[] = [];
	const messageIds: string[] = [];

	const {
		accountService,
		messageService,
		outboxMessageService,
		threadMessageService,
		mailboxLockService,
	} = services;

	const accountDescription = await accountService.describe(accountId);

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

		let cursor: string | undefined;
		do {
			const page = await threadMessageService.listByMailbox(
				accountConfigId,
				mailbox.mailboxId,
				{ continuationToken: cursor },
			);
			for (const tm of page.items) {
				entities.push({
					entityType: "ThreadMessage",
					key: { accountConfigId, threadMessageId: tm.threadMessageId },
				});
			}
			cursor = page.continuationToken;
		} while (cursor);
	}

	const outboxMessages = await outboxMessageService.listByAccount(accountId);
	for (const outbox of outboxMessages.items) {
		entities.push({
			entityType: "OutboxMessage",
			key: { outboxMessageId: outbox.outboxMessageId },
		});
	}

	const locks = await mailboxLockService.listByAccount(accountId);
	for (const lock of locks) {
		entities.push({
			entityType: "MailboxLock",
			key: { mailboxId: lock.mailboxId, eventName: lock.eventName },
		});
	}

	// The Account row itself is intentionally NOT enumerated: the API has
	// already soft-deleted it (`deletedAt` set, `isActive=false`) and that row
	// is kept as the purge-in-progress marker, mirroring how the tenant
	// cascade keeps the AccountConfig until the very end.

	log.info(
		{
			accountConfigId,
			accountId,
			entityCount: entities.length,
			messageCount: messageIds.length,
		},
		"Per-account purge enumeration complete",
	);

	return { entities, messageIds };
};

export const COVERED_ENTITY_TYPES = [
	"Account",
	"AccountConfig",
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
