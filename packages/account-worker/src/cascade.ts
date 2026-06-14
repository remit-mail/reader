import {
	type AccountConfigService,
	type AccountExportRequestService,
	type AccountService,
	type AddressService,
	type EnvelopeService,
	type MailboxLockService,
	type MailboxService,
	type MessageFlagService,
	type MessageService,
	NotFoundError,
	type OutboxMessageService,
	type ThreadMessageService,
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
}

export interface CascadeResult {
	entities: CascadeEntity[];
	messageIds: string[];
}

/**
 * One bounded slice of a per-account purge. `entities` are the rows to delete
 * this invocation; `drained` is true only once the account holds no more
 * message subtrees, signalling the finalize worker to do the final
 * container-level cleanup (mailboxes, thread messages, outbox, locks, S3) and
 * stop re-enqueuing continuations.
 */
export interface AccountPurgeChunk {
	entities: CascadeEntity[];
	messageIds: string[];
	drained: boolean;
}

const collectMessageChildEntities = (
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

/**
 * Bounded, resumable slice of {@link enumerateAccountPurgeEntities}. Enumerates
 * at most `maxMessages` message subtrees for one account by draining the
 * mailboxes from the front: deleted message rows vanish from the `byMailboxId`
 * GSI, so each invocation re-queries and picks up the next slice with no stored
 * cursor. The bounded per-message `describe()` cost is intentional — it is
 * capped at `maxMessages` collection reads per invocation, never the whole
 * account (the unbounded full-account walk is what timed out finalize).
 *
 * `drained` is true only when the account has fewer than `maxMessages` messages
 * left (i.e. this slice cleared the last of them). The finalize worker then
 * appends the container-level rows (mailboxes, thread messages, outbox, locks)
 * and finishes; while not drained it deletes only message subtrees and
 * re-enqueues a continuation.
 *
 * Scope discipline matches {@link enumerateAccountPurgeEntities}: only this
 * account's mailboxes → messages → children are reached.
 */
export const enumerateAccountPurgeChunk = async (
	accountConfigId: string,
	accountId: string,
	maxMessages: number,
	services: Pick<
		CascadeServices,
		| "accountService"
		| "messageService"
		| "threadMessageService"
		| "outboxMessageService"
		| "mailboxLockService"
	>,
	log: Logger,
): Promise<AccountPurgeChunk> => {
	const {
		accountService,
		messageService,
		threadMessageService,
		outboxMessageService,
		mailboxLockService,
	} = services;

	const entities: CascadeEntity[] = [];
	const messageIds: string[] = [];

	const accountDescription = await accountService.describe(accountId);

	let budget = maxMessages;
	let moreMessagesRemain = false;

	for (const mailbox of accountDescription.mailbox) {
		if (budget <= 0) {
			// Budget exhausted by an earlier mailbox; this one is unread. Probe a
			// single key cheaply so we only flag "more remain" when the mailbox
			// actually holds a message — an empty trailing mailbox must not force
			// a wasted continuation.
			const probe = await messageService.listByMailbox(mailbox.mailboxId, {
				limit: 1,
			});
			if (probe.items.length > 0) {
				moreMessagesRemain = true;
				break;
			}
			continue;
		}

		// Over-fetch one row past the budget to detect, without a second query,
		// whether this mailbox still holds messages beyond this slice.
		const page = await messageService.listByMailbox(mailbox.mailboxId, {
			limit: budget + 1,
		});

		const messages = page.items.slice(0, budget);
		const mailboxHasMore = page.items.length > budget;

		for (const message of messages) {
			messageIds.push(message.messageId);
			entities.push({
				entityType: "Message",
				key: { messageId: message.messageId },
			});

			// The byMailboxId GSI (gsi0) and the messageData collection (gsi2) are
			// independently eventually-consistent. A stale gsi0 row can project a
			// message a prior chunk already deleted, so `describe()` (gsi2) throws
			// NotFoundError. That is "this subtree is already gone", not an account
			// failure: keep the Message primary key for an idempotent re-delete and
			// move on. Letting it bubble would short-circuit the whole drain.
			let messageData: Awaited<ReturnType<MessageService["describe"]>>;
			try {
				messageData = await messageService.describe(message.messageId);
			} catch (error) {
				if (error instanceof NotFoundError) {
					log.info(
						{ accountConfigId, accountId, messageId: message.messageId },
						"Message subtree already gone (stale GSI row) — skipping child enumeration",
					);
					continue;
				}
				throw error;
			}
			collectMessageChildEntities(entities, messageData);
		}

		budget -= messages.length;

		if (mailboxHasMore) {
			moreMessagesRemain = true;
			break;
		}
	}

	const drained = !moreMessagesRemain;

	if (drained) {
		for (const mailbox of accountDescription.mailbox) {
			entities.push({
				entityType: "Mailbox",
				key: { mailboxId: mailbox.mailboxId },
			});

			let cursor: string | undefined;
			do {
				const tmPage = await threadMessageService.listByMailbox(
					accountConfigId,
					mailbox.mailboxId,
					{ continuationToken: cursor },
				);
				for (const tm of tmPage.items) {
					entities.push({
						entityType: "ThreadMessage",
						key: { accountConfigId, threadMessageId: tm.threadMessageId },
					});
				}
				cursor = tmPage.continuationToken;
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
	}

	log.info(
		{
			accountConfigId,
			accountId,
			maxMessages,
			chunkMessageCount: messageIds.length,
			entityCount: entities.length,
			drained,
		},
		"Per-account purge chunk enumeration complete",
	);

	return { entities, messageIds, drained };
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
