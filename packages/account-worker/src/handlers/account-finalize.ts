import { inspect } from "node:util";
import {
	createLogger,
	type Logger,
	withTelemetry,
} from "@remit/logger-lambda";
import type { SQSEvent, SQSHandler } from "aws-lambda";
import {
	type CascadeEntity,
	type CascadeServices,
	collectMessageChildEntities,
	enumerateCascadeEntities,
} from "../cascade.js";
import { cascadeServices as defaultCascadeServices } from "../config.js";
import {
	type DeletionCapabilities,
	getDeletionCapabilities,
} from "../deletion-capabilities.js";
import type {
	AccountDataPurgeFinalizeEvent,
	AccountDeleteFinalizeEvent,
	AccountFinalizeEvent,
} from "../events.js";

export interface ProcessFinalizeDeps {
	capabilities?: DeletionCapabilities;
	cascadeServices?: CascadeServices;
}

const resolveDeps = async (
	deps: ProcessFinalizeDeps,
): Promise<{
	capabilities: DeletionCapabilities;
	services: CascadeServices;
}> => ({
	capabilities: deps.capabilities ?? (await getDeletionCapabilities()),
	services: deps.cascadeServices ?? defaultCascadeServices,
});

/**
 * GDPR hard-delete: every row tied to the deleted AccountConfig is removed and
 * every stored object under `accounts/{accountConfigId}/` is purged. The
 * AccountConfig row itself is the LAST delete so that a mid-cascade replay still
 * sees the cascade-in-progress flag (`deletedAt` set, `isActive=false`, written
 * API-side) and re-runs cleanly. After a successful run nothing tied to the
 * AccountConfig persists.
 *
 * Step order (non-negotiable per #320):
 *   1. Content invalidation — runs FIRST so cached body parts cannot leak after
 *      the underlying objects are gone (a no-op where no CDN fronts content).
 *   2. Relational/DDB cascade delete in dependency order (children → parents).
 *   3. Storage prefix cleanup `accounts/{accountConfigId}/`.
 *   4. AccountConfig delete.
 *
 * Idempotency: every step is replay-safe. The cascade on a missing key is a
 * no-op, storage prefix delete on missing keys is a no-op, and invalidation is
 * always idempotent. No explicit "already deleted" pre-checks — they make
 * replays racier, not safer. Errors propagate so SQS retries the message;
 * eventually the DLQ alarm fires and an operator inspects the failure.
 */
export const processAccountFinalize = async (
	event: AccountDeleteFinalizeEvent,
	log: Logger,
	deps: ProcessFinalizeDeps = {},
): Promise<void> => {
	const { accountConfigId } = event;
	const { capabilities, services } = await resolveDeps(deps);

	// Validate every deploy-time precondition BEFORE the first destructive step,
	// so a missing var fails loud instead of deleting rows in the cascade and
	// only then erroring at the storage step.
	await capabilities.assertReady(log);

	// Step 1: content invalidation — first, so cached body parts cannot leak
	// after the underlying objects are gone.
	log.info(
		{ accountConfigId },
		"Invalidating cached content for erased account",
	);
	await capabilities.invalidateContent(accountConfigId, log);

	// Step 2: cascade delete (children → parents). The AccountConfig row is
	// excluded from the cascade plan and removed last, after storage.
	//
	// SQS is at-least-once: a successful cascade can be redelivered. After a
	// clean run the AccountConfig row is gone, so `describe()` throws
	// `NotFoundError` — that's the success signal, not a failure. Treat it as
	// "cascade already complete" and return cleanly. Any other error propagates
	// so SQS retries → DLQ.
	let entities: CascadeEntity[];
	try {
		const enumeration = await enumerateCascadeEntities(
			accountConfigId,
			services,
			log,
		);
		entities = enumeration.entities;
	} catch (error) {
		if ((error as { name?: string })?.name === "NotFoundError") {
			log.info(
				{ accountConfigId },
				"Cascade already complete (AccountConfig not found on replay) — no-op",
			);
			return;
		}
		throw error;
	}
	const cascadeEntities = entities.filter(
		(e) => e.entityType !== "AccountConfig",
	);
	await capabilities.cascadeDelete(cascadeEntities, log);

	// Step 3: storage prefix cleanup. Runs AFTER the cascade so a mid-cascade
	// replay always re-runs the (idempotent) storage step.
	await capabilities.deleteStoragePrefix(`accounts/${accountConfigId}/`, log);

	// Step 4: AccountConfig delete — the last write. The presence of an
	// AccountConfig row with `deletedAt` set is the cascade-in-progress flag;
	// removing the row is the only signal the cascade fully finished.
	await services.accountConfigService.delete(accountConfigId);
	log.info({ accountConfigId }, "AccountConfig deleted; cascade complete");
};

/**
 * Destructive phase of the per-account purge. Consumes the FIFO stream the
 * fanout producer emits (#1069), one message group per account so the messages
 * arrive strictly in order: every `subtrees` batch, then exactly one
 * `container` leftover. There is NO self-re-enqueue — the producer enqueues all
 * the work; this worker only ever consumes.
 *
 * Idempotency: the cascade on a missing key is a no-op, so a redelivered batch
 * (or container) no-ops on already-gone rows. Search-index cleanup is not driven
 * from here: on DynamoDB the fanout step enqueues a REMOVE per message id up
 * front; on the relational backends the cascade emits a `message.removed` outbox
 * row the search-index worker relays.
 */
export const processAccountDataPurgeFinalize = async (
	event: AccountDataPurgeFinalizeEvent,
	log: Logger,
	deps: ProcessFinalizeDeps = {},
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
	deps: ProcessFinalizeDeps,
): Promise<void> => {
	const { accountId, accountConfigId, items } = event;
	const { capabilities, services } = await resolveDeps(deps);

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
	deps: ProcessFinalizeDeps,
): Promise<void> => {
	const { accountId, accountConfigId } = event;
	const { capabilities, services } = await resolveDeps(deps);

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

// ---------- SQS handler ----------

const log = createLogger();

export const handler: SQSHandler = withTelemetry(async (event: SQSEvent) => {
	const batchItemFailures: { itemIdentifier: string }[] = [];

	for (const record of event.Records) {
		const finalizeEvent: AccountFinalizeEvent = JSON.parse(record.body);
		log.info(
			{
				eventType: finalizeEvent.type,
				accountConfigId: finalizeEvent.accountConfigId,
			},
			"Processing account finalize event",
		);

		const work =
			finalizeEvent.type === "FinalizeAccountDataPurge"
				? processAccountDataPurgeFinalize(finalizeEvent, log)
				: processAccountFinalize(finalizeEvent, log);

		const failed = await work
			.then(() => false)
			.catch((error) => {
				log.error(
					{ error: inspect(error), messageId: record.messageId },
					"Account finalize event processing failed",
				);
				return true;
			});

		if (failed) {
			batchItemFailures.push({ itemIdentifier: record.messageId });
		}
	}

	return { batchItemFailures };
});

export const finalizeHandler: SQSHandler = handler;
