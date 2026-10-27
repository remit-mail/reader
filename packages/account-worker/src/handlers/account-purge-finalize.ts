import type { Logger } from "@remit/logger";
import {
	type CascadeEntity,
	type CascadeServices,
	collectMessageChildEntities,
} from "../cascade.js";
import type { DeletionCapabilities } from "../deletion-capabilities.js";
import type { AccountDataPurgeFinalizeEvent } from "../events.js";

export interface PurgeFinalizeDeps {
	capabilities: DeletionCapabilities;
	services: CascadeServices;
}

/**
 * Destructive phase of the per-account purge. Consumes the FIFO stream the
 * fanout producer emits (#1069), one message group per account so the messages
 * arrive strictly in order: every `subtrees` batch, then exactly one
 * `container` leftover. There is NO self-re-enqueue — the producer enqueues all
 * the work; this worker only ever consumes.
 *
 * Idempotency: the cascade on a missing key is a no-op, so a redelivered batch
 * (or container) no-ops on already-gone rows.
 */
export const processAccountDataPurgeFinalize = async (
	event: AccountDataPurgeFinalizeEvent,
	log: Logger,
	deps: PurgeFinalizeDeps,
): Promise<void> => {
	if (event.kind === "subtrees") {
		await processPurgeSubtrees(event, log, deps);
		return;
	}
	await processPurgeContainer(event, log, deps);
};

/**
 * Delete a batch of message subtrees. For each `{ threadMessageId, messageId }`
 * the manifest row is deleted UNCONDITIONALLY — there are ghost ThreadMessages
 * whose Message is already gone — and the Message + its 9 child entities are
 * deleted only when `describe()` resolves. A `describe()` 404 means the subtree
 * is already gone: skip the children, still drop the manifest row.
 */
const processPurgeSubtrees = async (
	event: Extract<AccountDataPurgeFinalizeEvent, { kind: "subtrees" }>,
	log: Logger,
	deps: PurgeFinalizeDeps,
): Promise<void> => {
	const { accountId, accountConfigId, items } = event;
	const { capabilities, services } = deps;

	const entities: CascadeEntity[] = [];
	for (const { threadMessageId, messageId } of items) {
		entities.push({
			entityType: "ThreadMessage",
			key: { accountConfigId, threadMessageId },
		});
		try {
			const messageData = await services.messageService.describe(messageId);
			entities.push({ entityType: "Message", key: { messageId } });
			collectMessageChildEntities(entities, messageData);
		} catch (error) {
			if ((error as { name?: string })?.name === "NotFoundError") {
				log.info(
					{ accountConfigId, accountId, messageId },
					"Message subtree already gone — deleting manifest row only",
				);
				continue;
			}
			throw error;
		}
	}

	await capabilities.cascadeDelete(entities, log);
	log.info(
		{ accountConfigId, accountId, count: items.length },
		"Per-account purge subtree batch deleted",
	);
};

/**
 * The container leftover — processed last in the FIFO group, after every subtree
 * delete. Deletes the account-keyed container rows (mailboxes, outbox, locks),
 * the storage prefix `accounts/{cfg}/{acct}/`, and invalidates the account's
 * cached content. Ordering is invalidate-before-storage, storage-after-cascade.
 * The tenant-shared Address rows, the AccountConfig, sibling accounts, and the
 * soft-deleted account row (the purge-in-progress marker) are all kept.
 */
const processPurgeContainer = async (
	event: Extract<AccountDataPurgeFinalizeEvent, { kind: "container" }>,
	log: Logger,
	deps: PurgeFinalizeDeps,
): Promise<void> => {
	const { accountId, accountConfigId } = event;
	const { capabilities, services } = deps;

	// The account row is kept as the purge-in-progress marker. Its absence means
	// the container leftover already ran — no-op on redelivery.
	let accountDescription: Awaited<
		ReturnType<CascadeServices["accountService"]["describe"]>
	>;
	try {
		accountDescription = await services.accountService.describe(accountId);
	} catch (error) {
		if ((error as { name?: string })?.name === "NotFoundError") {
			log.info(
				{ accountConfigId, accountId },
				"Per-account purge already complete (account row gone) — no-op",
			);
			return;
		}
		throw error;
	}

	// Validate every deploy-time precondition BEFORE the first destructive step.
	// Runs after the account-existence guard so a redelivery whose account row is
	// already gone still returns cleanly without needing the config present.
	await capabilities.assertReady(log);

	// Step 1: content invalidation — first, so cached body parts cannot leak
	// after the underlying objects are gone.
	log.info(
		{ accountConfigId, accountId },
		"Invalidating cached content for purged account",
	);
	await capabilities.invalidateContent(`${accountConfigId}/${accountId}`, log);

	// Step 2: container rows — mailboxes, outbox, locks. Address is
	// tenant-shared and never deleted on a per-account purge.
	const entities: CascadeEntity[] = [];
	for (const mailbox of accountDescription.mailbox) {
		entities.push({
			entityType: "Mailbox",
			key: { mailboxId: mailbox.mailboxId },
		});
	}
	const outboxMessages =
		await services.outboxMessageService.listByAccount(accountId);
	for (const outbox of outboxMessages.items) {
		entities.push({
			entityType: "OutboxMessage",
			key: { outboxMessageId: outbox.outboxMessageId },
		});
	}
	const locks = await services.mailboxLockService.listByAccount(accountId);
	for (const lock of locks) {
		entities.push({
			entityType: "MailboxLock",
			key: { mailboxId: lock.mailboxId, eventName: lock.eventName },
		});
	}
	await capabilities.cascadeDelete(entities, log);

	// Step 3: storage prefix cleanup scoped to this account only.
	await capabilities.deleteStoragePrefix(
		`accounts/${accountConfigId}/${accountId}/`,
		log,
	);

	log.info({ accountConfigId, accountId }, "Per-account data purge complete");
};
